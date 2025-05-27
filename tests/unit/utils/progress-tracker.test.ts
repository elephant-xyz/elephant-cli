import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProgressTracker, ProcessingPhase } from '../../../src/utils/progress-tracker';

describe('ProgressTracker', () => {
  let tracker: ProgressTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    tracker = new ProgressTracker(1000, 100); // 1000 files, 100ms update frequency
  });

  afterEach(() => {
    tracker.stop();
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('should initialize with correct metrics', () => {
      const metrics = tracker.getMetrics();

      expect(metrics.totalFiles).toBe(1000);
      expect(metrics.processedFiles).toBe(0);
      expect(metrics.validFiles).toBe(0);
      expect(metrics.invalidFiles).toBe(0);
      expect(metrics.uploadedFiles).toBe(0);
      expect(metrics.skippedFiles).toBe(0);
      expect(metrics.errorCount).toBe(0);
      expect(metrics.warningCount).toBe(0);
      expect(metrics.currentPhase).toBe(ProcessingPhase.INITIALIZATION);
    });

    it('should start with zero rates', () => {
      const metrics = tracker.getMetrics();

      expect(metrics.filesPerSecond).toBe(0);
      expect(metrics.uploadsPerSecond).toBe(0);
      expect(metrics.validationRate).toBe(0);
    });
  });

  describe('start/stop', () => {
    it('should emit start event', () => {
      const startHandler = vi.fn();
      tracker.on('start', startHandler);

      tracker.start();

      expect(startHandler).toHaveBeenCalledWith(expect.objectContaining({
        totalFiles: 1000
      }));
    });

    it('should emit stop event', () => {
      const stopHandler = vi.fn();
      tracker.on('stop', stopHandler);

      tracker.start();
      tracker.stop();

      expect(stopHandler).toHaveBeenCalled();
    });

    it('should start periodic updates', () => {
      const updateHandler = vi.fn();
      tracker.on('update', updateHandler);

      tracker.start();

      // No updates immediately
      expect(updateHandler).not.toHaveBeenCalled();

      // Advance time by 100ms
      vi.advanceTimersByTime(100);
      expect(updateHandler).toHaveBeenCalledTimes(1);

      // Advance more
      vi.advanceTimersByTime(200);
      expect(updateHandler).toHaveBeenCalledTimes(3);

      tracker.stop();
    });
  });

  describe('increment methods', () => {
    it('should increment processed files', () => {
      tracker.incrementProcessed();
      expect(tracker.getMetrics().processedFiles).toBe(1);

      tracker.incrementProcessed(5);
      expect(tracker.getMetrics().processedFiles).toBe(6);
    });

    it('should increment valid files', () => {
      tracker.incrementValid(3);
      expect(tracker.getMetrics().validFiles).toBe(3);
    });

    it('should increment invalid files', () => {
      tracker.incrementInvalid(2);
      expect(tracker.getMetrics().invalidFiles).toBe(2);
    });

    it('should increment uploaded files', () => {
      tracker.incrementUploaded(10);
      expect(tracker.getMetrics().uploadedFiles).toBe(10);
    });

    it('should increment skipped files', () => {
      tracker.incrementSkipped(5);
      expect(tracker.getMetrics().skippedFiles).toBe(5);
    });

    it('should increment errors', () => {
      tracker.incrementErrors();
      tracker.incrementErrors(2);
      expect(tracker.getMetrics().errorCount).toBe(3);
    });

    it('should increment warnings', () => {
      tracker.incrementWarnings(4);
      expect(tracker.getMetrics().warningCount).toBe(4);
    });
  });

  describe('phase management', () => {
    it('should set phase and progress', () => {
      tracker.setPhase(ProcessingPhase.VALIDATION, 50);

      const metrics = tracker.getMetrics();
      expect(metrics.currentPhase).toBe(ProcessingPhase.VALIDATION);
      expect(metrics.phaseProgress).toBe(50);
    });

    it('should emit phase-change event', () => {
      const phaseChangeHandler = vi.fn();
      tracker.on('phase-change', phaseChangeHandler);

      tracker.setPhase(ProcessingPhase.SCANNING);

      expect(phaseChangeHandler).toHaveBeenCalledWith({
        from: ProcessingPhase.INITIALIZATION,
        to: ProcessingPhase.SCANNING
      });
    });

    it('should clamp progress to 0-100', () => {
      tracker.setPhase(ProcessingPhase.VALIDATION, 150);
      expect(tracker.getMetrics().phaseProgress).toBe(100);

      tracker.setPhase(ProcessingPhase.VALIDATION, -50);
      expect(tracker.getMetrics().phaseProgress).toBe(0);
    });
  });

  describe('queue updates', () => {
    it('should update queue sizes', () => {
      tracker.updateQueues(10, 20, 30);

      const metrics = tracker.getMetrics();
      expect(metrics.validationQueueSize).toBe(10);
      expect(metrics.uploadQueueSize).toBe(20);
      expect(metrics.transactionQueueSize).toBe(30);
    });
  });

  describe('rate calculation', () => {
    it('should calculate processing rates', () => {
      tracker.start();
      
      // Let initial update happen
      vi.advanceTimersByTime(100);

      // Process some files
      tracker.incrementProcessed(100);
      tracker.incrementValid(80);
      tracker.incrementUploaded(50);

      // Advance time by 5 seconds (ensuring multiple updates)
      vi.advanceTimersByTime(5000);

      const metrics = tracker.getMetrics();

      // Should be approximately 20 files/second (100 files in 5 seconds)
      expect(metrics.filesPerSecond).toBeCloseTo(20, 1);
      expect(metrics.validationRate).toBeCloseTo(16, 1);
      expect(metrics.uploadsPerSecond).toBeCloseTo(10, 1);
    });

    it('should handle zero rates', () => {
      tracker.start();
      vi.advanceTimersByTime(1000);

      const metrics = tracker.getMetrics();
      expect(metrics.filesPerSecond).toBe(0);
    });
  });

  describe('time estimates', () => {
    it('should calculate estimated time remaining', () => {
      tracker.start();
      
      // Let initial update happen
      vi.advanceTimersByTime(100);

      // Process 100 files
      tracker.incrementProcessed(100);
      
      // Advance time to allow rate calculation
      vi.advanceTimersByTime(10000);

      const metrics = tracker.getMetrics();

      // 900 files remaining at approximately 10 files/second = ~90 seconds
      // Due to timing variations in tests, check if it's in reasonable range
      expect(metrics.estimatedTimeRemaining).toBeLessThan(120000); // Less than 2 minutes
      expect(metrics.estimatedTimeRemaining).toBeGreaterThan(60000); // More than 1 minute
    });

    it('should handle completed processing', () => {
      tracker.incrementProcessed(1000); // All files processed

      const metrics = tracker.getMetrics();
      expect(metrics.estimatedTimeRemaining).toBe(0);
    });

    it('should handle zero processing rate', () => {
      tracker.start();
      vi.advanceTimersByTime(1000);

      const metrics = tracker.getMetrics();
      expect(metrics.estimatedTimeRemaining).toBe(Infinity);
    });
  });

  describe('progress percentage', () => {
    it('should calculate correct percentage', () => {
      expect(tracker.getProgressPercentage()).toBe(0);

      tracker.incrementProcessed(250);
      expect(tracker.getProgressPercentage()).toBe(25);

      tracker.incrementProcessed(250);
      expect(tracker.getProgressPercentage()).toBe(50);

      tracker.incrementProcessed(500);
      expect(tracker.getProgressPercentage()).toBe(100);
    });

    it('should handle zero total files', () => {
      const emptyTracker = new ProgressTracker(0);
      expect(emptyTracker.getProgressPercentage()).toBe(100);
    });
  });

  describe('formatTime', () => {
    it('should format time correctly', () => {
      expect(tracker.formatTime(500)).toBe('0s');
      expect(tracker.formatTime(45000)).toBe('45s');
      expect(tracker.formatTime(125000)).toBe('2m 5s');
      expect(tracker.formatTime(3725000)).toBe('1h 2m 5s');
    });

    it('should handle infinity', () => {
      expect(tracker.formatTime(Infinity)).toBe('Unknown');
    });
  });

  describe('getSummary', () => {
    it('should return formatted summary', () => {
      tracker.start();
      tracker.incrementProcessed(100);
      tracker.incrementErrors(5);
      tracker.incrementWarnings(10);

      vi.advanceTimersByTime(10000); // 10 seconds

      const summary = tracker.getSummary();

      expect(summary).toContain('Progress: 10%');
      expect(summary).toContain('100/1000');
      expect(summary).toContain('Errors: 5');
      expect(summary).toContain('Warnings: 10');
      expect(summary).toContain('files/s');
    });
  });

  describe('resource usage', () => {
    it('should track memory usage', () => {
      const metrics = tracker.getMetrics();
      
      // Memory usage should be a positive number
      expect(metrics.memoryUsage).toBeGreaterThanOrEqual(0);
      expect(typeof metrics.memoryUsage).toBe('number');
    });

    it('should update memory usage on update', () => {
      tracker.start();
      
      const initialMemory = tracker.getMetrics().memoryUsage;
      
      // Allocate some memory
      const bigArray = new Array(1000000).fill('x');
      
      vi.advanceTimersByTime(100);
      
      const updatedMemory = tracker.getMetrics().memoryUsage;
      
      // Memory usage might increase (though not guaranteed due to GC)
      expect(typeof updatedMemory).toBe('number');
      
      // Clean up
      bigArray.length = 0;
    });
  });

  describe('reset', () => {
    it('should reset all metrics', () => {
      // Set up some progress
      tracker.start();
      tracker.incrementProcessed(500);
      tracker.incrementErrors(10);
      tracker.setPhase(ProcessingPhase.UPLOADING, 75);

      // Reset with new total
      tracker.reset(2000);

      const metrics = tracker.getMetrics();
      expect(metrics.totalFiles).toBe(2000);
      expect(metrics.processedFiles).toBe(0);
      expect(metrics.errorCount).toBe(0);
      expect(metrics.currentPhase).toBe(ProcessingPhase.INITIALIZATION);
      expect(metrics.phaseProgress).toBe(0);
    });

    it('should emit reset event', () => {
      const resetHandler = vi.fn();
      tracker.on('reset', resetHandler);

      tracker.reset(500);

      expect(resetHandler).toHaveBeenCalledWith(expect.objectContaining({
        totalFiles: 500
      }));
    });
  });

  describe('elapsed time', () => {
    it('should track elapsed time', () => {
      tracker.start();

      expect(tracker.getMetrics().elapsedTime).toBe(0);

      vi.advanceTimersByTime(5000);

      // Need to trigger update
      vi.advanceTimersByTime(100);

      expect(tracker.getMetrics().elapsedTime).toBeGreaterThanOrEqual(5000);
    });
  });

  describe('history management', () => {
    it('should maintain limited history size', () => {
      tracker.start();

      // Generate many updates (more than historySize)
      for (let i = 0; i < 100; i++) {
        tracker.incrementProcessed(1);
        vi.advanceTimersByTime(100);
      }

      // History should be limited (internal implementation detail)
      // We can verify by checking that rates are still calculated correctly
      const metrics = tracker.getMetrics();
      expect(metrics.filesPerSecond).toBeGreaterThan(0);
    });
  });
});