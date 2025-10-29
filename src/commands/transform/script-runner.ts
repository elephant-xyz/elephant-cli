import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { logger } from '../../utils/logger.js';
import { linkNodeModulesIntoTemp } from '../../utils/node-modules.js';

type ExecResult = {
  code: number;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
  script: string;
};

export async function execNode(
  entryAbsPath: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const start = Date.now();

    // Helpful Node flags for clearer errors from child scripts
    const nodeArgs = [
      '--unhandled-rejections=strict',
      '--trace-uncaught',
      entryAbsPath,
      ...args,
    ];

    const proc = spawn(process.execPath, nodeArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'production' },
    });

    let stdout = '';
    let stderr = '';
    let exited = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;

    const onDone = (overrides?: Partial<ExecResult>) => {
      if (exited) return;
      exited = true;
      clearTimeout(timer);
      resolve({
        code: exitCode ?? -1,
        stdout,
        stderr,
        signal: exitSignal,
        timedOut: false,
        durationMs: Date.now() - start,
        script: entryAbsPath,
        ...overrides,
      });
    };

    const timer = setTimeout(() => {
      logger.warn(
        `Killing script due to timeout after ${timeoutMs}ms: ${entryAbsPath}`
      );
      try {
        proc.kill('SIGKILL');
      } catch {
        // ignore
      }
      onDone({
        code: -1,
        timedOut: true,
        // Surface a clear reason in stderr even if the child produced nothing
        stderr:
          (stderr || '').trim() +
          `\n[runner] Process timed out after ${timeoutMs}ms and was killed (SIGKILL).`,
      });
    }, timeoutMs);

    proc.stdout.on('data', (d: Buffer) => {
      const s = d.toString();
      stdout += s;
      // Optional: live debug streaming (kept terse)
      // logger.debug(`[${path.basename(entryAbsPath)}] ${s}`.trimEnd());
    });

    proc.stderr.on('data', (d: Buffer) => {
      const s = d.toString();
      stderr += s;
      // Optional: live error streaming
      // logger.error(`[${path.basename(entryAbsPath)}] ${s}`.trimEnd());
    });

    // Capture signal explicitly
    proc.on('exit', (code, signal) => {
      exitCode = code === null ? -1 : code;
      exitSignal = signal;
    });

    // 'close' fires after stdio streams are flushed
    proc.on('close', () => onDone());

    // If spawn fails synchronously, emulate a completed result with stderr
    proc.on('error', (err) => {
      onDone({
        code: -1,
        stderr:
          (stderr || '').trim() +
          `\n[runner] Failed to spawn child process: ${err?.message ?? err}`,
      });
    });
  });
}

function tailLines(s: string, maxLines: number): string {
  const lines = s.split(/\r?\n/);
  return lines.slice(-maxLines).join('\n');
}

function summarizeFailure(name: string, r: ExecResult): string {
  const parts = [
    `script=${name}`,
    `code=${r.code}`,
    r.signal ? `signal=${r.signal}` : null,
    r.timedOut ? `timedOut=true` : null,
    `durationMs=${r.durationMs}`,
  ].filter(Boolean);
  const stderrTail = r.stderr?.trim() ? tailLines(r.stderr, 60) : '';
  const stdoutTail =
    !stderrTail && r.stdout?.trim() ? tailLines(r.stdout, 60) : '';
  const detail = stderrTail
    ? `\n--- stderr (tail) ---\n${stderrTail}`
    : stdoutTail
      ? `\n--- stdout (tail) ---\n${stdoutTail}`
      : `\n(no output captured)`;
  return `Script failed (${parts.join(' ')}).${detail}`;
}

export async function runScriptsPipeline(
  scriptsDir: string,
  workDir: string,
  scriptNames?: string[]
): Promise<void> {
  // Resolve script paths by name; scripts may be placed anywhere in scriptsDir
  const resolveScript = async (name: string): Promise<string> => {
    const found = await findFileRecursive(scriptsDir, name);
    if (!found) throw new Error(`Required script not found: ${name}`);
    return found;
  };

  linkNodeModulesIntoTemp(workDir);

  // Use custom script names if provided, otherwise use default County scripts
  const names = scriptNames || [
    'ownerMapping.js',
    'structureMapping.js',
    'layoutMapping.js',
    'utilityMapping.js',
  ];

  const scripts = await Promise.all(names.map((n) => resolveScript(n)));

  const timeoutMs = 120000; // 2 minutes default per script

  // Run scripts in parallel
  const results = await Promise.all(
    scripts.map((script) => execNode(script, [], workDir, timeoutMs))
  );

  // Check for any failures
  for (let i = 0; i < results.length; i++) {
    const res = results[i];
    if (res.code !== 0) {
      const msg = summarizeFailure(names[i], res);
      logger.error(msg);
      throw new Error(msg);
    }
  }

  // For County scripts, also run the final data extractor
  if (!scriptNames) {
    const extractionName = 'data_extractor.js';
    const extraction = await resolveScript(extractionName);
    const finalRes = await execNode(extraction, [], workDir, timeoutMs);
    if (finalRes.code !== 0) {
      const msg = summarizeFailure(extractionName, finalRes);
      logger.error(msg);
      throw new Error(msg);
    }
  }

  // Scripts executed successfully
}

async function findFileRecursive(
  root: string,
  fileName: string
): Promise<string | null> {
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const it of items) {
      const abs = path.join(dir, it.name);
      if (it.isDirectory()) stack.push(abs);
      else if (it.isFile() && it.name === fileName) return abs;
    }
  }
  return null;
}
