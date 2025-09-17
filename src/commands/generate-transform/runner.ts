import { promises as fs } from 'fs';
import path from 'path';
import { createTempDir, unzipTo, zipDirectory } from './io/zipio.js';
import {
  defaultGenerateTransformConfig,
  type GenerateTransformConfig,
} from './config.js';
import { type AgentState, type ChatModel } from './agent/state.js';
import { runThreeNodeGraph } from './agent/graph.js';
import { fetchSchemas, fetchFromIpfs } from '../../utils/schema-fetcher.js';
import { buildFilename } from './config/filenames.js';
import chalk from 'chalk';

export type DiscoverResult = {
  unnormalized: string;
  seed: string;
  input: string;
  priorScriptsDir?: string;
  priorErrorsPath?: string;
};

export async function discoverRequiredFiles(
  root: string
): Promise<DiscoverResult> {
  const list = await fs.readdir(root, { withFileTypes: true });
  const files = list.filter((d) => d.isFile()).map((d) => d.name);
  const unnormalized = files.find(
    (f) => f.toLowerCase() === 'unnormalized_address.json'
  );
  const seed = files.find((f) => f.toLowerCase() === 'property_seed.json');
  const input =
    files.find((f) => /\.html?$/i.test(f)) ||
    files.find(
      (f) =>
        f.toLowerCase().endsWith('.json') &&
        f !== 'unnormalized_address.json' &&
        f !== 'property_seed.json'
    );
  if (!unnormalized || !seed || !input) {
    console.error(
      chalk.red(
        'Input should contain unnormalized_address.json, property_seed.json, and an HTML/JSON file'
      )
    );
    throw new Error('E_INPUT_MISSING');
  }
  let inputFileName = undefined;
  if (input.endsWith('.html')) {
    inputFileName = 'input.html';
  } else {
    // file can be only be json as this is validated when finding the `input` file
    inputFileName = 'input.json';
  }
  await fs.rename(path.join(root, input), path.join(root, inputFileName));
  let priorScriptsDir: string | undefined;
  try {
    const scriptsCandidate = path.join(root, 'scripts');
    const st = await fs.stat(scriptsCandidate);
    if (st.isDirectory()) priorScriptsDir = scriptsCandidate;
  } catch {
    // Directory doesn't exist, that's ok
  }
  const errorCsv =
    files.find((f) => /(?:validation|submit).*errors.*\.csv$/i.test(f)) ||
    files.find((f) => /errors\.csv$/i.test(f));
  return {
    unnormalized: path.join(root, unnormalized),
    seed: path.join(root, seed),
    input: inputFileName,
    priorScriptsDir,
    priorErrorsPath: errorCsv ? path.join(root, errorCsv) : undefined,
  };
}

export async function bundleOutput(
  scriptsDir: string,
  outZip: string,
  modelName: string
): Promise<void> {
  const manifest = {
    model: modelName,
    generatedAt: new Date().toISOString(),
    files: [] as Array<{ path: string; bytes: number }>,
  };
  const tempBundle = path.join(path.dirname(scriptsDir), '__bundle');
  await fs.rm(tempBundle, { recursive: true, force: true });
  await fs.mkdir(tempBundle, { recursive: true });
  const relFiles: string[] = [];
  const walk = async (dir: string, rel = ''): Promise<void> => {
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const it of items) {
      const abs = path.join(dir, it.name);
      const rp = path.join(rel, it.name);
      if (it.isDirectory()) await walk(abs, rp);
      else if (it.name.endsWith('.js')) {
        const dest = path.join(tempBundle, rp);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        const buf = await fs.readFile(abs);
        await fs.writeFile(dest, buf);
        relFiles.push(rp.replace(/\\/g, '/'));
        manifest.files.push({
          path: rp.replace(/\\/g, '/'),
          bytes: buf.length,
        });
      }
    }
  };
  await walk(scriptsDir);
  await fs.writeFile(
    path.join(tempBundle, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  await zipDirectory(tempBundle, outZip);
}

export type GenerateTransformOptions = {
  outputZip: string;
  dataGroupCid?: string;
  dataGroupOnly?: boolean;
  config?: Partial<GenerateTransformConfig>;
};

export type TransformProgressPhase =
  | 'initializing'
  | 'unzipping'
  | 'discovering'
  | 'preparing'
  | 'running_graph'
  | 'bundling'
  | 'completed';

export type TransformNodeName =
  | 'ownerAnalysis'
  | 'structureExtraction'
  | 'extraction';

export type TransformProgressEvent =
  | { kind: 'phase'; phase: TransformProgressPhase; message?: string }
  | { kind: 'node'; stage: 'start' | 'end'; name: TransformNodeName }
  | { kind: 'message'; message: string };

export type TransformProgressCallback = (event: TransformProgressEvent) => void;

export type GenerateTransformOptionsWithProgress = GenerateTransformOptions & {
  onProgress?: TransformProgressCallback;
};

export async function generateTransform(
  input: string,
  chat: ChatModel,
  options: GenerateTransformOptionsWithProgress
): Promise<string> {
  const report = (e: TransformProgressEvent): void => {
    options.onProgress?.(e);
  };

  const cfg: GenerateTransformConfig = {
    ...defaultGenerateTransformConfig,
    ...(options.config || {}),
  };

  report({ kind: 'phase', phase: 'initializing' });
  const tempRoot = await createTempDir('elephant-gentrans');
  const workDir = path.join(tempRoot, 'work');
  const scriptsDir = path.join(tempRoot, 'scripts');
  const ownersDir = path.join(tempRoot, 'owners');
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(scriptsDir, { recursive: true });
  await fs.mkdir(ownersDir, { recursive: true });
  // Accept either a ZIP (preferred) or a single HTML file
  let isZip = /\.zip$/i.test(input);
  if (isZip) {
    report({ kind: 'phase', phase: 'unzipping' });
    unzipTo(input, tempRoot);
  } else {
    // Single HTML path; copy it into workdir with expected name
    report({ kind: 'phase', phase: 'preparing', message: 'Copying HTML input...' });
    const htmlBuf = await fs.readFile(input);
    await fs.writeFile(path.join(tempRoot, 'input.html'), htmlBuf);
  }

  report({ kind: 'phase', phase: 'discovering' });
  let unnormalized: string | undefined;
  let seed: string | undefined;
  let discoveredInput = 'input.html';
  let priorScriptsDir: string | undefined;
  let priorErrorsPath: string | undefined;
  if (isZip) {
    const d = await discoverRequiredFiles(tempRoot);
    unnormalized = d.unnormalized;
    seed = d.seed;
    discoveredInput = d.input;
    priorScriptsDir = d.priorScriptsDir;
    priorErrorsPath = d.priorErrorsPath;
  } else {
    // HTML-only mode
    unnormalized = path.join(tempRoot, 'unnormalized_address.json');
    seed = path.join(tempRoot, 'property_seed.json');
    // Create minimal placeholders so downstream validators don’t break
    await fs.writeFile(unnormalized, JSON.stringify({}), 'utf-8');
    await fs.writeFile(
      seed,
      JSON.stringify({ request_identifier: 'HTML_ONLY', source_http_request: { url: '', method: 'GET', multiValueQueryString: {} } }),
      'utf-8'
    );
  }

  // Ensure JSON inputs are available at stable paths in temp root (keep originals intact)
  const unnormalizedTarget = path.join(tempRoot, 'unnormalized_address.json');
  if (unnormalized && unnormalized !== unnormalizedTarget) {
    try {
      await fs.copyFile(unnormalized, unnormalizedTarget);
    } catch {
      const buf = await fs.readFile(unnormalized);
      await fs.writeFile(unnormalizedTarget, buf);
    }
  }
  const seedTarget = path.join(tempRoot, 'property_seed.json');
  if (seed && seed !== seedTarget) {
    try {
      await fs.copyFile(seed, seedTarget);
    } catch {
      const buf = await fs.readFile(seed);
      await fs.writeFile(seedTarget, buf);
    }
  }
  const filenames = buildFilename(discoveredInput);

  const state: AgentState = {
    tempDir: tempRoot,
    inputPaths: {
      unnormalized: unnormalizedTarget,
      seed: seedTarget,
      input: discoveredInput,
      priorScriptsDir,
      priorErrorsPath,
    },
    filenames: filenames,
    generatedScripts: [],
    attempts: 0,
    logs: [],
    schemas: await buildSchemas(options.dataGroupCid, options.dataGroupOnly === true),
  };

  report({ kind: 'phase', phase: 'running_graph' });
  await runThreeNodeGraph(
    state,
    chat,
    {
      maxAttempts: cfg.retryMaxAttempts,
    },
    (evt) => {
      if (evt.type === 'node_start') {
        report({ kind: 'node', stage: 'start', name: evt.name });
      }
      if (evt.type === 'node_end') {
        report({ kind: 'node', stage: 'end', name: evt.name });
      }
    },
    // If dataGroupOnly, skip owner and structure
    options.dataGroupOnly === true
      ? { owner: false, structure: false, dataGroupOnly: true }
      : undefined
  );

  // If running in data-group-only mode, emit a deterministic extractor script
  if (options.dataGroupOnly === true && options.dataGroupCid) {
    const dgCid = options.dataGroupCid;
    let dgRaw: string | undefined;
    try {
      dgRaw = await fetchFromIpfs(dgCid);
    } catch {
      dgRaw = state.schemas[dgCid];
    }
    if (dgRaw) {
      let dgTitle = 'Data Group';
      const relMap: Record<string, string> = {};
      const classSet = new Set<string>();
      try {
        const dgObj = JSON.parse(dgRaw) as Record<string, unknown>;
        dgTitle = typeof dgObj?.title === 'string' ? String(dgObj.title) : dgTitle;
        const relProps = (dgObj?.properties as Record<string, unknown>)?.['relationships'] as Record<string, unknown>;
        const relDefs = (relProps?.properties as Record<string, { items?: { cid?: string } }>) || {};
        for (const [k, v] of Object.entries(relDefs)) {
          const rcid = v?.items?.cid;
          if (typeof rcid === 'string') relMap[k] = rcid;
        }
      } catch {}

      for (const rcid of Object.values(relMap)) {
        let rRaw: string | undefined = state.schemas[rcid];
        if (!rRaw) {
          try { rRaw = await fetchFromIpfs(rcid); } catch {}
        }
        if (!rRaw) continue;
        try {
          const rObj = JSON.parse(rRaw) as Record<string, any>;
          const fromCid = rObj?.properties?.from?.cid;
          const toCid = rObj?.properties?.to?.cid;
          if (typeof fromCid === 'string') classSet.add(fromCid);
          if (typeof toCid === 'string') classSet.add(toCid);
        } catch {}
      }

      const relPairs = Object.entries(relMap)
        .map(([k, cid]) => `    "${k}": ["${cid}"]`)
        .join(',\n');
      const classList = Array.from(classSet);

      const script = `const fs = require('fs');\nconst path = require('path');\n\nconst outDir = path.join(process.cwd(), 'data');\nfs.mkdirSync(outDir, { recursive: true });\n\n// Write data group file named by CID\nconst dg = {\n  label: ${JSON.stringify(dgTitle)},\n  relationships: {\n${relPairs}\n  }\n};\nfs.writeFileSync(path.join(outDir, '${dgCid}.json'), JSON.stringify(dg, null, 2), 'utf8');\n\n// Write minimal class files for referenced from/to CIDs\n${classList.map((c)=>`try { fs.writeFileSync(path.join(outDir, '${c}.json'), JSON.stringify({}, null, 2), 'utf8'); } catch {}`).join('\n')}\nconsole.log('WROTE datagroup and', ${String(classList.length)}, 'classes');\n`;

      const outPath = path.join(scriptsDir, 'data_extractor.js');
      await fs.writeFile(outPath, script, 'utf-8');
    }
  }

  report({ kind: 'phase', phase: 'bundling' });
  await bundleOutput(tempRoot, path.resolve(options.outputZip), cfg.modelName);
  report({ kind: 'phase', phase: 'completed' });
  return path.resolve(options.outputZip);
}

async function buildSchemas(dataGroupCid?: string, only = false): Promise<Record<string, string>> {
  const base = only ? {} : await fetchSchemas();
  if (!dataGroupCid) return base;
  // Fetch the data group and pull in referenced schema CIDs
  const dgRaw = await fetchFromIpfs(dataGroupCid);
  let extras: Record<string, string> = {};
  try {
    const parsed = JSON.parse(dgRaw) as Record<string, unknown>;
    const rel = (parsed['relationships'] as Record<string, unknown>) || {};
    const collectCids = (val: unknown): string[] => {
      if (Array.isArray(val))
        return val
          .map((x) => (typeof x === 'object' && x && 'cid' in x ? String((x as any).cid) : undefined))
          .filter((x): x is string => typeof x === 'string');
      return [];
    };
    const cids: string[] = [];
    for (const v of Object.values(rel)) cids.push(...collectCids(v));
    for (const cid of cids) {
      try {
        const schemaText = await fetchFromIpfs(cid);
        extras[cid] = schemaText;
      } catch (e) {
        // ignore individual failures; continue with what we have
      }
    }
  } catch {
    // ignore parse issues; return base only
  }
  // Merge extras keyed by CID, but also attempt to extract $id/name as keys if present
  const merged: Record<string, string> = { ...base };
  for (const [cid, text] of Object.entries(extras)) {
    merged[cid] = text;
    try {
      const obj = JSON.parse(text);
      const name = typeof obj?.title === 'string' ? String(obj.title) : obj?.$id ? String(obj.$id) : undefined;
      if (name && !merged[name]) merged[name] = text;
    } catch {}
  }

  // Explicitly pull class schemas referenced by relationship schemas (properties.from.cid / properties.to.cid)
  const classCids: string[] = [];
  for (const text of Object.values(extras)) {
    try {
      const relObj = JSON.parse(text);
      const fromCid = relObj?.properties?.from?.cid;
      const toCid = relObj?.properties?.to?.cid;
      if (typeof fromCid === 'string') classCids.push(fromCid);
      if (typeof toCid === 'string') classCids.push(toCid);
    } catch {}
  }
  for (const c of classCids) {
    if (merged[c]) continue;
    try {
      const s = await fetchFromIpfs(c);
      merged[c] = s;
      try {
        const obj = JSON.parse(s);
        const name = typeof obj?.title === 'string' ? String(obj.title) : obj?.$id ? String(obj.$id) : undefined;
        if (name && !merged[name]) merged[name] = s;
      } catch {}
    } catch {}
  }

  // Recursively fetch any additional CIDs referenced inside fetched schemas (e.g., class schemas)
  const CID_RE = /\bbafk[\w]+\b/gi;
  const seen = new Set<string>(Object.keys(merged));
  const queue: string[] = [];
  for (const txt of Object.values(extras)) {
    try {
      const obj = JSON.parse(txt);
      const jsonStr = JSON.stringify(obj);
      const matches = jsonStr.match(CID_RE) || [];
      for (const m of matches) if (!seen.has(m)) queue.push(m);
    } catch {}
  }

  let depth = 0;
  const MAX_DEPTH = 2;
  while (queue.length && depth <= MAX_DEPTH) {
    const nextCid = queue.shift()!;
    if (seen.has(nextCid)) continue;
    seen.add(nextCid);
    try {
      const text = await fetchFromIpfs(nextCid);
      merged[nextCid] = text;
      try {
        const obj = JSON.parse(text);
        const name = typeof obj?.title === 'string' ? String(obj.title) : obj?.$id ? String(obj.$id) : undefined;
        if (name && !merged[name]) merged[name] = text;
        const inner = JSON.stringify(obj).match(CID_RE) || [];
        for (const m of inner) if (!seen.has(m)) queue.push(m);
      } catch {}
    } catch {}
    depth++;
  }
  return merged;
}
