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
import { FILENAMES } from './config/filenames.js';
import chalk from 'chalk';

export type DiscoverResult = {
  unnormalized: string;
  seed: string;
  html: string;
  priorScriptsDir?: string;
  priorErrorsPath?: string;
};

export async function discoverRequiredFiles(
  root: string
): Promise<DiscoverResult> {
  const list = await fs.readdir(root, { withFileTypes: true });
  console.log(`list: ${list.map((d) => d.name)}`);
  const files = list.filter((d) => d.isFile()).map((d) => d.name);
  console.log(`files: ${files}`);
  const unnormalized = files.find(
    (f) => f.toLowerCase() === 'unnormalized_address.json'
  );
  const seed = files.find((f) => f.toLowerCase() === 'property_seed.json');
  const html =
    files.find((f) => /\.html?$/i.test(f)) ||
    files.find(
      (f) =>
        f.toLowerCase().endsWith('.json') &&
        f !== 'unnormalized_address.json' &&
        f !== 'property_seed.json'
    );
  if (!unnormalized || !seed || !html) {
    console.error(
      chalk.red(
        'Input should contain unnormalized_address.json, property_seed.json, and an HTML/JSON file'
      )
    );
    throw new Error('E_INPUT_MISSING');
  }
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
    html: path.join(root, html),
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

export async function generateTransform(
  inputZip: string,
  chat: ChatModel,
  options: GenerateTransformOptions
): Promise<string> {
  const cfg: GenerateTransformConfig = {
    ...defaultGenerateTransformConfig,
    ...(options.config || {}),
  };

  const tempRoot = await createTempDir('elephant-gentrans');
  const workDir = path.join(tempRoot, 'work');
  const scriptsDir = path.join(tempRoot, 'scripts');
  const ownersDir = path.join(tempRoot, 'owners');
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(scriptsDir, { recursive: true });
  await fs.mkdir(ownersDir, { recursive: true });
  unzipTo(inputZip, tempRoot);

  const { unnormalized, seed, html, priorScriptsDir, priorErrorsPath } =
    await discoverRequiredFiles(tempRoot);

  // Normalize discovered HTML path to tempRoot/input.html for downstream scripts
  const inputHtmlPath = path.join(tempRoot, 'input.html');
  const isHtml = /\.html?$/i.test(html);
  if (isHtml && html !== inputHtmlPath) {
    try {
      await fs.copyFile(html, inputHtmlPath);
    } catch {
      const buf = await fs.readFile(html);
      await fs.writeFile(inputHtmlPath, buf);
    }
  }

  // Ensure JSON inputs are available at stable paths in temp root (keep originals intact)
  const unnormalizedTarget = path.join(tempRoot, 'unnormalized_address.json');
  if (unnormalized !== unnormalizedTarget) {
    try {
      await fs.copyFile(unnormalized, unnormalizedTarget);
    } catch {
      const buf = await fs.readFile(unnormalized);
      await fs.writeFile(unnormalizedTarget, buf);
    }
  }
  const seedTarget = path.join(tempRoot, 'property_seed.json');
  if (seed !== seedTarget) {
    try {
      await fs.copyFile(seed, seedTarget);
    } catch {
      const buf = await fs.readFile(seed);
      await fs.writeFile(seedTarget, buf);
    }
  }

  const state: AgentState = {
    tempDir: tempRoot,
    inputPaths: {
      unnormalized: unnormalizedTarget,
      seed: seedTarget,
      html: isHtml ? inputHtmlPath : html,
      priorScriptsDir,
      priorErrorsPath,
    },
    filenames: FILENAMES,
    generatedScripts: [],
    attempts: 0,
    logs: [],
    schemas: await fetchSchemas(),
  };

  await runThreeNodeGraph(state, chat, {
    maxAttempts: cfg.retryMaxAttempts,
  });

  await bundleOutput(tempRoot, path.resolve(options.outputZip), cfg.modelName);
  return path.resolve(options.outputZip);
}
