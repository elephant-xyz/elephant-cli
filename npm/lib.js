// The library entry of @elephant-xyz/cli: the same functions 1.x exported
// from '@elephant-xyz/cli/lib', each one a call to the native binary with
// --json. Results keep the 1.x shapes; they never throw (prepare excepted,
// as before) and report failure as `{ success: false, error }`.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { binary } from './native.js';

/** Run the binary with --json; resolves with its exit code, parsed stdout and stderr. */
function run(args, cwd) {
  return new Promise((done) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(binary(), ['--json', ...args], { cwd: cwd || process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      done({ code: 2, json: { error: error.message }, stderr: '' });
      return;
    }
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => done({ code: 2, json: { error: error.message }, stderr }));
    child.on('close', (code) => {
      let json = {};
      try {
        json = JSON.parse(stdout);
      } catch {
        json = { error: stderr.trim() || stdout.trim() || `elephant-cli exited with ${code}` };
      }
      done({ code: code ?? 2, json, stderr });
    });
  });
}

/** `--flag value` for every option that is set. */
function flags(pairs) {
  return Object.entries(pairs).flatMap(([flag, value]) => {
    if (value === undefined || value === null || value === false) return [];
    return value === true ? [flag] : [flag, String(value)];
  });
}

const where = (options, file) => resolve(options.cwd || process.cwd(), file);

export async function validate(options) {
  const outputCsv = options.outputCsv || 'submit_errors.csv';
  const { code, json } = await run(['validate', options.input, '--output-csv', outputCsv], options.cwd);
  const car = json.kind === 'county-car' ? { blocks: json.blocks, properties: json.properties, groups: json.data_groups, lookups: json.lookups, errors: json.errors } : undefined;
  const result = { success: code === 0, totalFiles: 0, errors: json.error_count ?? (code === 0 ? 0 : 1), processed: 0, skipped: 0, errorCsvPath: where(options, outputCsv), car };
  if (code !== 0) result.error = json.error || `Validation failed with ${result.errors} errors`;
  return result;
}

export async function hash(options) {
  const outputZip = options.outputZip || 'hashed-data.zip';
  const outputCsv = options.outputCsv || 'hash-results.csv';
  const args = ['hash', options.input, '--output-zip', outputZip, '--output-csv', outputCsv, ...flags({ '--output-car': options.outputCar })];
  const { code, json } = await run(args, options.cwd);
  const result = {
    success: code === 0,
    outputZipPath: where(options, outputZip),
    outputCsvPath: where(options, outputCsv),
    outputCarPath: options.outputCar ? where(options, options.outputCar) : undefined,
    carRoot: json.car?.root,
    propertyCid: json.property_cid ?? undefined,
    totalFiles: json.data_groups ?? 0,
    processed: json.data_groups ?? 0,
    errors: json.errors?.length ?? (code === 0 ? 0 : 1),
  };
  if (code !== 0) result.error = json.error || json.errors?.join('\n') || 'hash failed';
  return result;
}

export async function exportTables(options) {
  const args = [
    'export-tables',
    options.input,
    ...flags({
      '--output': options.output,
      '--part-size': options.partSize,
      '--output-json': options.outputJson,
      '--atlas-page': options.atlasPage,
      '--county': options.county,
      '--state': options.state,
      '--fips': options.fips,
    }),
  ];
  const { code, json } = await run(args, options.cwd);
  return code === 0 ? { success: true, ...json } : { success: false, error: json.error || 'export-tables failed' };
}

export async function upload(options) {
  if (options.pinataJwt) return { success: false, error: 'Uploading a ZIP to Pinata was removed in elephant-cli 2; upload a county CAR or a tables directory instead' };
  const args = ['upload', options.input, ...flags({ '--api': options.api, '--token': options.token, '--gateway': options.gateway, '--timeout': options.timeout, '--output-json': options.outputJson })];
  const { code, json } = await run(args, options.cwd);
  return code === 0 ? { success: true, cid: json.root, ...json } : { success: false, error: json.error || 'upload failed' };
}

export async function transform(options) {
  const outputZip = options.outputZip || 'transformed-data.zip';
  if (options.legacyMode) return { success: false, outputPath: where(options, outputZip), error: 'Legacy mode was removed in elephant-cli 2' };
  const args = [
    'transform',
    ...flags({
      '--input-zip': options.inputZip,
      '--output-zip': outputZip,
      '--scripts-zip': options.scriptsZip,
      '--transform-zip': options.transformZip,
      '--transform-version': options.transformVersion,
      '--data-group': options.dataGroup,
    }),
  ];
  const { code, json } = await run(args, options.cwd);
  const result = { success: code === 0, outputPath: where(options, outputZip) };
  if (code !== 0) {
    // "Transform failed: <message>\n--- stderr (tail) ---\n<what the script printed>"
    const text = String(json.error || 'transform failed').replace(/^Transform failed: /, '');
    const [message, ...rest] = text.split('\n--- ');
    const tail = (name) => rest.find((part) => part.startsWith(name))?.split(' ---\n').slice(1).join(' ---\n');
    result.error = message;
    result.scriptFailure = { message, stdout: tail('stdout'), stderr: tail('stderr') };
  }
  return result;
}

/** Resolves when the output ZIP is written; throws with the reason otherwise, as 1.x did. */
export async function prepare(inputZip, outputZip, options = {}) {
  const args = [
    'prepare',
    ...(inputZip ? [inputZip] : []),
    ...flags({
      '--output-zip': outputZip,
      '--input-csv': options.inputCsv,
      '--multi-request-flow-file': options.multiRequestFlowFile,
      '--browser-flow-file': options.browserFlowFile,
      '--browser-flow-template': options.browserFlowTemplate,
      '--browser-flow-parameters': options.browserFlowParameters,
      '--browser-flow-zip': options.browserFlowZip,
      '--browser-flow-version': options.browserFlowVersion,
      '--use-browser': options.useBrowser,
      '--no-continue': options.useBrowser && !options.clickContinue,
      '--continue-button': options.continueButtonSelector,
      '--ignore-captcha': options.ignoreCaptcha,
      '--proxy': options.proxy,
    }),
  ];
  const { code, json } = await run(args, options.cwd);
  if (code !== 0) throw new Error(String(json.error || 'prepare failed').replace(/^Prepare failed: /, ''));
}

const removed = (name) => async () => {
  throw new Error(`${name} was removed in elephant-cli 2; pin @elephant-xyz/cli@1 if you still need it`);
};
export const generateTransform = removed('generateTransform');
export const submitToContract = removed('submitToContract');
export const checkGasPrice = removed('checkGasPrice');
export const checkTransactionStatus = removed('checkTransactionStatus');
