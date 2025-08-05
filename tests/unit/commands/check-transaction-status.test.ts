import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'fs';
import { registerCheckTransactionStatusCommand } from '../../../src/commands/check-transaction-status.js';
import { TransactionStatusCheckerService } from '../../../src/services/transaction-status-checker.service.js';

vi.mock('fs');
vi.mock('../../../src/services/transaction-status-checker.service.js');
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    technical: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe('check-transaction-status command', () => {
  let program: Command;
  let mockCheckerService: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride(); // Prevent process.exit during tests
    registerCheckTransactionStatusCommand(program);

    mockCheckerService = {
      checkTransactionStatuses: vi.fn(),
    };
    vi.mocked(TransactionStatusCheckerService).mockImplementation(
      () => mockCheckerService
    );

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('should check transaction statuses from CSV', async () => {
    const csvContent = `transactionHash,batchIndex,itemCount,timestamp,status
0x123,0,10,2024-01-01T00:00:00Z,pending
0x456,1,5,2024-01-01T00:01:00Z,pending`;

    vi.mocked(readFileSync).mockReturnValue(csvContent);
    vi.mocked(writeFileSync).mockImplementation(() => {});

    mockCheckerService.checkTransactionStatuses.mockResolvedValue([
      {
        transactionHash: '0x123',
        batchIndex: 0,
        itemCount: 10,
        timestamp: '2024-01-01T00:00:00Z',
        status: 'success',
        blockNumber: 12345,
        gasUsed: '100000',
        checkTimestamp: '2024-01-02T00:00:00Z',
      },
      {
        transactionHash: '0x456',
        batchIndex: 1,
        itemCount: 5,
        timestamp: '2024-01-01T00:01:00Z',
        status: 'failed',
        checkTimestamp: '2024-01-02T00:00:00Z',
        error: 'Transaction reverted',
      },
    ]);

    await program.parseAsync([
      'node',
      'test',
      'check-transaction-status',
      'test.csv',
    ]);

    expect(readFileSync).toHaveBeenCalledWith(
      expect.stringContaining('test.csv'),
      'utf-8'
    );
    expect(mockCheckerService.checkTransactionStatuses).toHaveBeenCalled();
    expect(writeFileSync).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Summary:')
    );
  });

  it('should handle empty CSV file', async () => {
    vi.mocked(readFileSync).mockReturnValue('');

    await program.parseAsync([
      'node',
      'test',
      'check-transaction-status',
      'empty.csv',
    ]);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('No transactions found')
    );
    expect(mockCheckerService.checkTransactionStatuses).not.toHaveBeenCalled();
  });

  it('should use custom output path', async () => {
    const csvContent = `transactionHash,batchIndex,itemCount,timestamp,status
0x123,0,10,2024-01-01T00:00:00Z,pending`;

    vi.mocked(readFileSync).mockReturnValue(csvContent);
    vi.mocked(writeFileSync).mockImplementation(() => {});

    mockCheckerService.checkTransactionStatuses.mockResolvedValue([
      {
        transactionHash: '0x123',
        batchIndex: 0,
        itemCount: 10,
        timestamp: '2024-01-01T00:00:00Z',
        status: 'success',
        checkTimestamp: '2024-01-02T00:00:00Z',
      },
    ]);

    await program.parseAsync([
      'node',
      'test',
      'check-transaction-status',
      'test.csv',
      '--output-csv',
      'custom-output.csv',
    ]);

    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('custom-output.csv'),
      expect.any(String)
    );
  });

  it('should respect max concurrent option', async () => {
    const csvContent = `transactionHash,batchIndex,itemCount,timestamp,status
0x123,0,10,2024-01-01T00:00:00Z,pending`;

    vi.mocked(readFileSync).mockReturnValue(csvContent);
    vi.mocked(writeFileSync).mockImplementation(() => {});

    mockCheckerService.checkTransactionStatuses.mockResolvedValue([]);

    await program.parseAsync([
      'node',
      'test',
      'check-transaction-status',
      'test.csv',
      '--max-concurrent',
      '20',
    ]);

    expect(TransactionStatusCheckerService).toHaveBeenCalledWith(
      expect.any(String),
      20
    );
  });

  it('should handle errors gracefully', async () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error('File not found');
    });

    try {
      await program.parseAsync([
        'node',
        'test',
        'check-transaction-status',
        'missing.csv',
      ]);
    } catch (error) {
      // Expected to throw due to process.exit mock
    }

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('File not found')
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should show correct summary', async () => {
    const csvContent = `transactionHash,batchIndex,itemCount,timestamp,status
0x1,0,1,2024-01-01T00:00:00Z,pending
0x2,1,1,2024-01-01T00:00:00Z,pending
0x3,2,1,2024-01-01T00:00:00Z,pending`;

    vi.mocked(readFileSync).mockReturnValue(csvContent);
    vi.mocked(writeFileSync).mockImplementation(() => {});

    mockCheckerService.checkTransactionStatuses.mockResolvedValue([
      {
        transactionHash: '0x1',
        batchIndex: 0,
        itemCount: 1,
        timestamp: '2024-01-01T00:00:00Z',
        status: 'success',
        checkTimestamp: '2024-01-02T00:00:00Z',
      },
      {
        transactionHash: '0x2',
        batchIndex: 1,
        itemCount: 1,
        timestamp: '2024-01-01T00:00:00Z',
        status: 'failed',
        checkTimestamp: '2024-01-02T00:00:00Z',
      },
      {
        transactionHash: '0x3',
        batchIndex: 2,
        itemCount: 1,
        timestamp: '2024-01-01T00:00:00Z',
        status: 'pending',
        checkTimestamp: '2024-01-02T00:00:00Z',
      },
    ]);

    await program.parseAsync([
      'node',
      'test',
      'check-transaction-status',
      'test.csv',
    ]);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Total transactions:     3')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Successful:')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed:')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Still pending:')
    );
  });
});
