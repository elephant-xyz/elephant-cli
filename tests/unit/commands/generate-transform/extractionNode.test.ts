import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { tmpdir } from 'os';
import { promises as fs } from 'fs';

// Mocks must be declared before importing the module under test
vi.mock(
  '../../../../src/commands/generate-transform/agent/helpers/langchain-tools.js',
  () => ({
    createMinimalFsTools: vi.fn(() => []),
  })
);

vi.mock(
  '../../../../src/commands/generate-transform/prompts/langchain-registry.js',
  () => ({
    promptRegistry: {
      clearCache: vi.fn(),
      getPromptTemplate: vi.fn().mockResolvedValue({
        // Minimal shape used by formatPrompt mock
        inputVariables: [],
        template: '',
      }),
    },
  })
);

vi.mock('../../../../src/commands/generate-transform/agent/utils.js', () => ({
  MAX_ITERATIONS: 3,
  formatPrompt: vi.fn(async () => 'system'),
  ensureBaseChatModel: vi.fn((c: unknown) => c as any),
  buildAgent: vi.fn(async () => ({})),
  invokeAgent: vi.fn(),
  extractFeedback: vi.fn((s: string) => s),
}));

import { extractionNode } from '../../../../src/commands/generate-transform/agent/nodes/extractionNode.js';
import { invokeAgent } from '../../../../src/commands/generate-transform/agent/utils.js';
import { logger } from '../../../../src/utils/logger.js';
import { FilenameKey } from '../../../../src/commands/generate-transform/config/filenames.js';

describe('extractionNode', () => {
  let tempDir: string;
  const filenames = {
    INPUT_FILE: 'input.html',
    UNNORMALIZED_ADDRESS: 'unnormalized_address.json',
    PROPERTY_SEED: 'property_seed.json',
    UTILITIES_DATA: 'utilities.json',
    LAYOUT_DATA: 'layout.json',
    DATA_EXTRACTOR_SCRIPT: 'scripts/data_extractor.js',
    DATA_DIR: 'data',
    OWNER_DATA: 'owner_data.json',
    STRUCTURE_DATA: 'structure.json',
  } as const as Record<FilenameKey, string>;

  const baseState = {
    tempDir: '',
    inputPaths: {
      unnormalized: '',
      seed: '',
      html: '',
    },
    filenames: filenames,
    generatedScripts: [],
    attempts: 0,
    logs: [],
    schemas: {},
  };

  const chat = { invoke: vi.fn(async () => ({ content: 'ok' })) } as any;

  beforeEach(async () => {
    const base = path.join(tmpdir(), 'elephant-cli-extraction-');
    tempDir = await fs.mkdtemp(base);

    // Required files
    await fs.writeFile(
      path.join(tempDir, filenames.INPUT_FILE),
      '<html>hi</html>'
    );
    await fs.writeFile(
      path.join(tempDir, filenames.UNNORMALIZED_ADDRESS),
      '{"street":"123 Main St"}'
    );
    await fs.writeFile(
      path.join(tempDir, filenames.PROPERTY_SEED),
      '{"apn":"000-000-000"}'
    );

    // Ensure data directory exists to avoid unrelated warnings
    await fs.mkdir(path.join(tempDir, filenames.DATA_DIR), { recursive: true });

    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up temp dir
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('handles missing optional data files without throwing and warns appropriately', async () => {
    // Do not create optional files to simulate missing cases

    const warnSpy = vi.spyOn(logger, 'warn');

    // First call: generator; Second call: evaluator accepted
    vi.mocked(invokeAgent).mockResolvedValueOnce('GENERATOR_DONE');
    vi.mocked(invokeAgent).mockResolvedValueOnce('STATUS: ACCEPTED');

    const result = await extractionNode({ ...baseState, tempDir }, chat);

    // Validate generator message content
    const firstCall = vi.mocked(invokeAgent).mock.calls[0];
    expect(firstCall).toBeDefined();
    const generatorMsg = firstCall[1] as string;
    expect(generatorMsg).toContain('<input_file>');
    expect(generatorMsg).toContain('<unnormalized_address>');
    expect(generatorMsg).toContain('<property_seed>');
    // Optional blocks should be omitted when not present
    expect(generatorMsg).not.toContain('<utilities_data>');
    expect(generatorMsg).not.toContain('<layout_data>');
    expect(generatorMsg).not.toContain('<structure_data>');
    // Owner block is always present; shows placeholder when missing
    expect(generatorMsg).toContain('<owner_data>');
    expect(generatorMsg).toContain('File not available');

    // Should warn for each missing optional file
    // - utilities, layout, owner, structure
    expect(warnSpy).toHaveBeenCalledTimes(4);

    // Should accept in first iteration and increment attempts
    expect(result.attempts).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(result.logs)).toBe(true);
  });

  it('includes optional data blocks in initial message when files exist', async () => {
    // Create optional files
    await fs.writeFile(
      path.join(tempDir, filenames.UTILITIES_DATA),
      '{"hasGas":true}'
    );
    await fs.writeFile(
      path.join(tempDir, filenames.LAYOUT_DATA),
      '{"rooms":3}'
    );
    await fs.writeFile(
      path.join(tempDir, filenames.OWNER_DATA),
      '{"owners":[{"name":"Alice"}]}'
    );
    await fs.writeFile(
      path.join(tempDir, filenames.STRUCTURE_DATA),
      '{"stories":2}'
    );

    const warnSpy = vi.spyOn(logger, 'warn');

    vi.mocked(invokeAgent).mockResolvedValueOnce('GENERATOR_DONE');
    vi.mocked(invokeAgent).mockResolvedValueOnce('STATUS: ACCEPTED');

    await extractionNode({ ...baseState, tempDir }, chat);

    const firstCall = vi.mocked(invokeAgent).mock.calls[0];
    const generatorMsg = firstCall[1] as string;

    expect(generatorMsg).toContain('<utilities_data>');
    expect(generatorMsg).toContain('<layout_data>');
    expect(generatorMsg).toContain('<owner_data>');
    expect(generatorMsg).toContain('<structure_data>');
    expect(generatorMsg).not.toContain('File not available');

    // No warnings expected for optional files now present
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('re-invokes generator with feedback when evaluator rejects initially', async () => {
    // Accept on second evaluator run
    vi.mocked(invokeAgent)
      // first: generator
      .mockResolvedValueOnce('GENERATOR_DONE')
      // second: evaluator rejects
      .mockResolvedValueOnce('STATUS: REJECTED\nACTION PLAN: fix X')
      // third: generator with feedback
      .mockResolvedValueOnce('GENERATOR_FIX_APPLIED')
      // fourth: evaluator accepts
      .mockResolvedValueOnce('STATUS: ACCEPTED');

    const result = await extractionNode({ ...baseState, tempDir }, chat);

    // Expect at least 4 calls as per the sequence above
    expect(vi.mocked(invokeAgent).mock.calls.length).toBeGreaterThanOrEqual(4);

    // The third call (index 2) should be the generator invoked with feedback
    const thirdCallMsg = vi.mocked(invokeAgent).mock.calls[2][1] as string;
    expect(thirdCallMsg).toMatch(/fix/i);

    // Attempts should reflect at least 2 iterations
    expect(result.attempts).toBeGreaterThanOrEqual(2);
  });
});
