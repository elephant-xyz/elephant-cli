import { promises as fs } from 'fs';
import path from 'path';
import { createTempDir, unzipTo, zipDirectory } from './io/zipio.js';
import {
  defaultGenerateTransformConfig,
  type GenerateTransformConfig,
} from './config.js';
import { type AgentState, type ChatModel } from './agent/state.js';
import { runThreeNodeGraph } from './agent/graph.js';
import { fetchSchemas } from '../../utils/schema-fetcher.js';
import { buildFilename } from './config/filenames.js';
import chalk from 'chalk';

export type DiscoverResult = {
  address: string;
  parcel: string;
  input: string;
  priorScriptsDir?: string;
  priorErrorsPath?: string;
};

export async function discoverRequiredFiles(
  root: string
): Promise<DiscoverResult> {
  const list = await fs.readdir(root, { withFileTypes: true });
  const files = list.filter((d) => d.isFile()).map((d) => d.name);
  const address = files.find((f) => f.toLowerCase() === 'address.json');
  const parcel = files.find((f) => f.toLowerCase() === 'parcel.json');
  const input =
    files.find((f) => /\.html?$/i.test(f)) ||
    files.find(
      (f) =>
        f.toLowerCase().endsWith('.json') &&
        f !== 'address.json' &&
        f !== 'parcel.json'
    );
  if (!address || !parcel || !input) {
    console.error(
      chalk.red(
        'Input should contain address.json, parcel.json, and an HTML/JSON file'
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
    address: path.join(root, address),
    parcel: path.join(root, parcel),
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
  inputZip: string,
  chat: ChatModel,
  dataDictionary: string = '',
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
  report({ kind: 'phase', phase: 'unzipping' });
  unzipTo(inputZip, tempRoot);

  report({ kind: 'phase', phase: 'discovering' });
  const { address, parcel, input, priorScriptsDir, priorErrorsPath } =
    await discoverRequiredFiles(tempRoot);

  // Ensure JSON inputs are available at stable paths in temp root (keep originals intact)
  const addressTarget = path.join(tempRoot, 'address.json');
  if (address !== addressTarget) {
    try {
      await fs.copyFile(address, addressTarget);
    } catch {
      const buf = await fs.readFile(address);
      await fs.writeFile(addressTarget, buf);
    }
  }
  const parcelTarget = path.join(tempRoot, 'parcel.json');
  if (parcel !== parcelTarget) {
    try {
      await fs.copyFile(parcel, parcelTarget);
    } catch {
      const buf = await fs.readFile(parcel);
      await fs.writeFile(parcelTarget, buf);
    }
  }
  const filenames = buildFilename(input);

  let dataDictionaryContent;
  if (dataDictionary) {
    dataDictionaryContent = await fs.readFile(
      path.resolve(dataDictionary),
      'utf-8'
    );
  }

  const state: AgentState = {
    tempDir: tempRoot,
    inputPaths: {
      address: addressTarget,
      parcel: parcelTarget,
      input: input,
      priorScriptsDir,
      priorErrorsPath,
    },
    filenames: filenames,
    generatedScripts: [],
    attempts: 0,
    logs: [],
    schemas: await fetchSchemas(),
    dataDictionaryContent: dataDictionaryContent,
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
    }
  );

  report({ kind: 'phase', phase: 'bundling' });
  await bundleOutput(tempRoot, path.resolve(options.outputZip), cfg.modelName);
  report({ kind: 'phase', phase: 'completed' });
  return path.resolve(options.outputZip);
}
