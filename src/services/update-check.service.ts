import os from 'os';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import { logger } from '../utils/logger.js';

type UpdateCache = {
  lastChecked: number;
  latest: string;
};

const THIRTY_MINUTES_MS = 30 * 60 * 1000;

function getCacheDir(): string {
  const isEphemeral = Boolean(
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.AIRFLOW_HOME ||
      process.env.AIRFLOW__CORE__DAGS_FOLDER ||
      process.env.AIRFLOW__CORE__EXECUTOR
  );
  return isEphemeral
    ? path.join('/tmp', 'elephant-cli', 'update-cache')
    : path.join(os.homedir(), '.elephant-cli', 'update-cache');
}

function parseSemver(v: string): [number, number, number] {
  const core = v.split(/[+-]/)[0];
  const parts = core.split('.');
  const major = Number.parseInt(parts[0] || '0', 10);
  const minor = Number.parseInt(parts[1] || '0', 10);
  const patch = Number.parseInt(parts[2] || '0', 10);
  return [
    Number.isFinite(major) ? major : 0,
    Number.isFinite(minor) ? minor : 0,
    Number.isFinite(patch) ? patch : 0,
  ];
}

function isOutdated(current: string, latest: string): boolean {
  const [cMaj, cMin, cPat] = parseSemver(current);
  const [lMaj, lMin, lPat] = parseSemver(latest);
  if (cMaj !== lMaj) return cMaj < lMaj;
  if (cMin !== lMin) return cMin < lMin;
  return cPat < lPat;
}

async function readCache(cacheFile: string): Promise<UpdateCache | undefined> {
  try {
    const txt = await fs.promises.readFile(cacheFile, 'utf-8');
    return JSON.parse(txt) as UpdateCache;
  } catch {
    return undefined;
  }
}

async function writeCache(cacheFile: string, data: UpdateCache): Promise<void> {
  try {
    await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.promises.writeFile(cacheFile, JSON.stringify(data), 'utf-8');
  } catch {
    // ignore cache write errors
  }
}

async function fetchLatestTag(pkgName: string): Promise<string | undefined> {
  try {
    const encoded = encodeURIComponent(pkgName);
    const url = `https://registry.npmjs.org/-/package/${encoded}/dist-tags`;
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const json = (await res.json()) as { latest?: string };
    return typeof json.latest === 'string' ? json.latest : undefined;
  } catch {
    return undefined;
  }
}

function warnToUpdate(current: string, latest: string): void {
  const msg = [
    `elephant-cli update required: ${current} → ${latest}`,
    `Please update @elephant-xyz/cli, then re-run this command.`,
    `Use your package manager:`,
    `  npm:  npm i -g @elephant-xyz/cli`,
    `  pnpm: pnpm add -g @elephant-xyz/cli`,
    `  yarn: yarn global add @elephant-xyz/cli`,
    `  bun:  bun add -g @elephant-xyz/cli`,
    `  npx:  npx @elephant-xyz/cli@latest`,
  ].join('\n');
  // Print both to logger and stdout with yellow color for better visibility
  logger.warn(msg);
  // eslint-disable-next-line no-console
  console.warn(chalk.yellow(msg));
}

export async function checkCliUpdate(
  pkgName: string,
  current: string
): Promise<void> {
  if (process.env.ELEPHANT_SKIP_UPDATE_CHECK === '1') return;
  if (process.env.CI === '1') return;

  const cacheDir = getCacheDir();
  const cacheFile = path.join(cacheDir, 'update.json');

  const cache = await readCache(cacheFile);
  const now = Date.now();
  let latestVersion: string | undefined;
  if (
    cache &&
    Number.isFinite(cache.lastChecked) &&
    typeof cache.latest === 'string' &&
    now - cache.lastChecked < THIRTY_MINUTES_MS
  ) {
    logger.debug(`Cache hit for ${pkgName}`);
    latestVersion = cache.latest;
  } else {
    logger.debug(`Cache miss for ${pkgName}`);
    latestVersion = await fetchLatestTag(pkgName);
    if (!latestVersion) return;
    await writeCache(cacheFile, { lastChecked: now, latest: latestVersion });
  }

  if (latestVersion && isOutdated(current, latestVersion)) {
    logger.debug(`elephant-cli update required: ${current} → ${latestVersion}`);
    warnToUpdate(current, latestVersion);
    process.exit(1);
  }
}
