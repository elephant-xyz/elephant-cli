import { describe, it, expect, vi } from 'vitest';
import { validate } from '../../../src/lib/commands.js';
import { runBatchInput } from '../../../src/utils/batch-input.js';

vi.mock('../../../src/utils/batch-input.js', () => ({
  isBatchInput: vi.fn(async () => true),
  runBatchInput: vi.fn(async () => {}),
  sharedServices: vi.fn((overrides: unknown) => overrides),
}));

describe('library batch input', () => {
  it('validate() routes a directory through the batch runner', async () => {
    const result = await validate({
      input: '/county',
      outputCsv: 'errors.csv',
    });
    expect(result.success).toBe(true);
    expect(vi.mocked(runBatchInput).mock.calls[0][0]).toMatchObject({
      input: '/county',
      silent: true,
    });
  });
});
