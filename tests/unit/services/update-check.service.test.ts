import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { checkCliUpdate } from '../../../src/services/update-check.service';

describe('update-check.service', () => {
  const ORIGINAL_ENV = { ...process.env };
  let tmpHome: string;
  let homedirSpy: MockInstance<[], string>;
  let exitSpy: MockInstance<[code?: string | number | null | undefined], never>;
  let dateSpy: MockInstance<[], number>;
  let warnSpy: MockInstance<unknown[], void>;
  let now: number;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    // Remove the skip flag for these tests since they specifically test update checking
    delete process.env.ELEPHANT_SKIP_UPDATE_CHECK;

    tmpHome = path.join(
      process.cwd(),
      'tmp',
      `home-${Math.random().toString(36).slice(2)}`
    );
    fs.mkdirSync(tmpHome, { recursive: true });
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(
        (_code?: string | number | null | undefined) => undefined as never
      );
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    now = 1_700_000_000_000; // fixed timestamp
    dateSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
  });

  afterEach(() => {
    homedirSpy.mockRestore();
    exitSpy.mockRestore();
    dateSpy.mockRestore();
    warnSpy.mockRestore();
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch {}
    process.env = { ...ORIGINAL_ENV };
  });

  function cacheFilePath() {
    return path.join(tmpHome, '.elephant-cli', 'update-cache', 'update.json');
  }

  it('exits when cached latest is newer within 30 minutes (no fetch)', async () => {
    const cacheDir = path.dirname(cacheFilePath());
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      cacheFilePath(),
      JSON.stringify({ lastChecked: now - 60_000, latest: '1.50.0' }),
      'utf-8'
    );

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await checkCliUpdate('@elephant-xyz/cli', '1.49.0');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledOnce();
    // message should include npx guidance
    const printed = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('npx @elephant-xyz/cli@latest');
  });

  it('does nothing (no fetch, no exit) when cached latest is not newer', async () => {
    const cacheDir = path.dirname(cacheFilePath());
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      cacheFilePath(),
      JSON.stringify({ lastChecked: now - 60_000, latest: '1.49.0' }),
      'utf-8'
    );

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await checkCliUpdate('@elephant-xyz/cli', '1.49.0');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('fetches and caches when cache is stale, then exits if newer', async () => {
    const cacheDir = path.dirname(cacheFilePath());
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      cacheFilePath(),
      JSON.stringify({
        lastChecked: now - (30 * 60 * 1000 + 1),
        latest: '1.49.0',
      }),
      'utf-8'
    );

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ latest: '1.50.0' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await checkCliUpdate('@elephant-xyz/cli', '1.49.0');

    expect(fetchMock).toHaveBeenCalledOnce();
    const cached = JSON.parse(fs.readFileSync(cacheFilePath(), 'utf-8')) as {
      latest: string;
      lastChecked: number;
    };
    expect(cached.latest).toBe('1.50.0');
    expect(cached.lastChecked).toBe(now);
    expect(exitSpy).toHaveBeenCalledOnce();
  });

  it('respects ELEPHANT_SKIP_UPDATE_CHECK and CI envs', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    process.env.ELEPHANT_SKIP_UPDATE_CHECK = '1';
    await checkCliUpdate('@elephant-xyz/cli', '0.0.0');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();

    delete process.env.ELEPHANT_SKIP_UPDATE_CHECK;
    process.env.CI = '1';
    await checkCliUpdate('@elephant-xyz/cli', '0.0.0');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
