import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ProgressTracker,
  ProcessingPhase,
} from '../../../src/utils/progress-tracker';

describe('ProgressTracker', () => {
  let tracker: ProgressTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    tracker = new ProgressTracker(1000, 100);
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
      expect(startHandler).toHaveBeenCalledWith(
        expect.objectContaining({ totalFiles: 1000 })
      );
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
      vi.advanceTimersByTime(100);
      expect(updateHandler).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(200);
      expect(updateHandler).toHaveBeenCalledTimes(3); // 1 + 2 more
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
      tracker.incrementErrors(3);
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
        to: ProcessingPhase.SCANNING,
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
      vi.advanceTimersByTime(100); // Initial update, history[0] has pF=0
      tracker.incrementProcessed(100); // pF becomes 100
      tracker.incrementValid(80);
      tracker.incrementUploaded(50);
      // Advance time by 5 seconds. History will fill.
      // Oldest samples will have pF=0, newer will have pF=100.
      vi.advanceTimersByTime(5000);
      // @ts-ignore
      tracker.update(); // Force update to calculate rates with full history.
      const metrics = tracker.getMetrics();
      // 100 files processed over ~5s. Rate ~20.
      expect(metrics.filesPerSecond).toBeCloseTo(20, 0);
      expect(metrics.validationRate).toBeCloseTo(16, 0); // 80 valid / 5s
      expect(metrics.uploadsPerSecond).toBeCloseTo(10, 0); // 50 uploaded / 5s
    });

    it('should handle zero rates if no progress', () => {
      tracker.start();
      vi.advanceTimersByTime(1000);
      // @ts-ignore
      tracker.update();
      const metrics = tracker.getMetrics();
      expect(metrics.filesPerSecond).toBe(0);
    });
  });

  describe('time estimates', () => {
    it('should calculate estimated time remaining', () => {
      tracker.start();
      vi.advanceTimersByTime(3000);
      tracker.incrementProcessed(100);
      vi.advanceTimersByTime(3000);
      // @ts-ignore access private method
      tracker.update();
      const metrics = tracker.getMetrics();

      // NOTE: If this fails with filesPerSecond being ~10 instead of ~20,
      // it might indicate a change in how ProgressTracker calculates rates,
      // possibly using a wider time window than the intended ~5 seconds from history.
      expect(metrics.filesPerSecond).toBeCloseTo(20, 1); // Allow a bit of leeway, original was 0 decimal places

      expect(metrics.estimatedTimeRemaining).toBeGreaterThan(0);
      expect(metrics.estimatedTimeRemaining).not.toBe(Infinity);
      expect(metrics.estimatedTimeRemaining).toBeCloseTo(45000, -3);
    });

    it('should handle completed processing', () => {
      tracker.start();
      tracker.incrementProcessed(1000);
      // @ts-ignore access private method
      tracker.update();
      const metrics = tracker.getMetrics();
      expect(metrics.estimatedTimeRemaining).toBe(0);
    });

    it('should handle zero processing rate for ETR', () => {
      tracker.start();
      vi.advanceTimersByTime(1000);
      // @ts-ignore access private method
      tracker.update();
      const metrics = tracker.getMetrics();
      expect(metrics.estimatedTimeRemaining).toBe(Infinity);
    });
  });

  describe('progress percentage', () => {
    it('should calculate correct percentage', () => {
      expect(tracker.getProgressPercentage()).toBe(0);
      tracker.incrementProcessed(250);
      expect(tracker.getProgressPercentage()).toBe(25);
      tracker.incrementProcessed(750);
      expect(tracker.getProgressPercentage()).toBe(100);
    });

    it('should handle zero total files', () => {
      const emptyTracker = new ProgressTracker(0);
      expect(emptyTracker.getProgressPercentage()).toBe(100); // Or 0, depending on desired behavior
    });
  });

  describe('formatTime', () => {
    it('should format time correctly', () => {
      expect(tracker.formatTime(500)).toBe('0s');
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
      tracker.incrementErrors(1);
      tracker.incrementWarnings(2);
      vi.advanceTimersByTime(10000); // 10s
      // @ts-ignore
      tracker.update();
      const summary = tracker.getSummary();
      expect(summary).toContain('Progress: 10%');
      expect(summary).toContain('Errors: 1');
      expect(summary).toContain('Warnings: 2');
    });
  });

  describe('resource usage', () => {
    it('should track memory usage', () => {
      const metrics = tracker.getMetrics();
      expect(metrics.memoryUsage).toBeGreaterThanOrEqual(0);
    });
  });

  describe('reset', () => {
    it('should reset all metrics', () => {
      tracker.start();
      tracker.incrementProcessed(500);
      tracker.reset(2000);
      const metrics = tracker.getMetrics();
      expect(metrics.totalFiles).toBe(2000);
      expect(metrics.processedFiles).toBe(0);
    });

    it('should emit reset event', () => {
      const resetHandler = vi.fn();
      tracker.on('reset', resetHandler);
      tracker.reset(500);
      expect(resetHandler).toHaveBeenCalled();
    });
  });

  describe('elapsed time', () => {
    it('should track elapsed time', () => {
      tracker.start();
      vi.advanceTimersByTime(5000);
      // @ts-ignore
      tracker.update(); // Trigger update to refresh elapsed time
      expect(tracker.getMetrics().elapsedTime).toBeGreaterThanOrEqual(5000);
    });
  });

  describe('history management', () => {
    it('should maintain limited history size and calculate rates', () => {
      tracker.start();
      for (let i = 0; i < 100; i++) {
        // More updates than historySize
        tracker.incrementProcessed(1);
        vi.advanceTimersByTime(100); // This also triggers an update
      }
      const metrics = tracker.getMetrics();
      // Check if rate is still sensible, implying history management works
      expect(metrics.filesPerSecond).toBeGreaterThan(0);
    });
  });
});
