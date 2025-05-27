import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueueManager } from '../../../src/utils/queue-manager';

describe('QueueManager', () => {
  let queue: QueueManager<number, number>;

  beforeEach(() => {
    vi.clearAllMocks();
    queue = new QueueManager({
      concurrency: 2,
      timeout: 1000,
      autoStart: false
    });
  });

  describe('initialization', () => {
    it('should create queue with default options', () => {
      const defaultQueue = new QueueManager();
      const stats = defaultQueue.getStats();

      expect(stats.pending).toBe(0);
      expect(stats.active).toBe(0);
      expect(stats.concurrency).toBe(10);
      expect(stats.isPaused).toBe(false);
      expect(stats.isRunning).toBe(false);
    });

    it('should create queue with custom options', () => {
      const stats = queue.getStats();

      expect(stats.concurrency).toBe(2);
      expect(stats.pending).toBe(0);
      expect(stats.active).toBe(0);
    });
  });

  describe('push', () => {
    it('should add task to queue', () => {
      const taskId = queue.push(42);

      expect(taskId).toBeDefined();
      expect(queue.getStats().pending).toBe(1);
      
      const task = queue.getTask(taskId);
      expect(task).toBeDefined();
      expect(task!.data).toBe(42);
    });

    it('should add task with custom options', () => {
      const taskId = queue.push(42, {
        id: 'custom-id',
        priority: 5,
        maxRetries: 5
      });

      expect(taskId).toBe('custom-id');
      
      const task = queue.getTask('custom-id');
      expect(task!.priority).toBe(5);
      expect(task!.maxRetries).toBe(5);
    });

    it('should sort tasks by priority', () => {
      queue.push(1, { priority: 1 });
      queue.push(2, { priority: 3 });
      queue.push(3, { priority: 2 });

      // Set processor to check order
      const processedOrder: number[] = [];
      queue.setProcessor(async (data) => {
        processedOrder.push(data);
        return data;
      });

      queue.start();

      return new Promise<void>((resolve) => {
        queue.on('drain', () => {
          expect(processedOrder).toEqual([2, 3, 1]); // Highest priority first
          resolve();
        });
      });
    });

    it('should auto-start if enabled', async () => {
      const autoQueue = new QueueManager({ autoStart: true, concurrency: 1 });
      
      let processed = false;
      autoQueue.setProcessor(async () => {
        processed = true;
        return true;
      });

      autoQueue.push(1);

      // Wait for processing to complete
      await autoQueue.drain();
      expect(processed).toBe(true);
    });
  });

  describe('pushBatch', () => {
    it('should add multiple tasks', () => {
      const ids = queue.pushBatch([1, 2, 3, 4, 5]);

      expect(ids).toHaveLength(5);
      expect(queue.getStats().pending).toBe(5);
    });

    it('should apply same options to all tasks', () => {
      const ids = queue.pushBatch([1, 2, 3], { priority: 10 });

      ids.forEach(id => {
        const task = queue.getTask(id);
        expect(task!.priority).toBe(10);
      });
    });
  });

  describe('processing', () => {
    beforeEach(() => {
      queue.setProcessor(async (data: number) => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return data * 2;
      });
    });

    it('should process tasks with processor function', async () => {
      const results: any[] = [];
      
      queue.on('task-complete', (result) => {
        results.push(result);
      });

      queue.push(5);
      queue.push(10);
      
      queue.start();
      await queue.drain();

      expect(results).toHaveLength(2);
      expect(results[0].result).toBe(10); // 5 * 2
      expect(results[1].result).toBe(20); // 10 * 2
    });

    it('should respect concurrency limit', async () => {
      let maxActive = 0;
      
      queue.setProcessor(async (data: number) => {
        const currentActive = queue.getStats().active;
        maxActive = Math.max(maxActive, currentActive);
        await new Promise(resolve => setTimeout(resolve, 100));
        return data;
      });

      // Add more tasks than concurrency
      queue.pushBatch([1, 2, 3, 4, 5]);
      
      queue.start();
      await queue.drain();

      expect(maxActive).toBe(2); // Should not exceed concurrency
    });

    it('should handle processor errors', async () => {
      const errors: any[] = [];
      
      queue.on('task-error', (result) => {
        errors.push(result);
      });

      queue.setProcessor(async (data: number) => {
        if (data === 2) {
          throw new Error('Processing failed');
        }
        return data;
      });

      queue.pushBatch([1, 2, 3]);
      
      queue.start();
      await queue.drain();

      expect(errors).toHaveLength(1);
      expect(errors[0].error.message).toBe('Processing failed');
    });

    it('should throw error if no processor set', () => {
      // Don't set a processor
      queue.push(1);
      expect(() => queue.start()).toThrow('No processor function set');
    });
  });

  describe('timeout', () => {
    it('should timeout long-running tasks', async () => {
      const errors: any[] = [];
      
      queue.on('task-error', (result) => {
        errors.push(result);
      });

      queue.setProcessor(async () => {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Longer than timeout
        return 42;
      });

      queue.push(1);
      queue.start();
      
      await queue.drain();

      expect(errors).toHaveLength(1);
      expect(errors[0].error.message).toContain('timed out');
    });
  });

  describe('retry', () => {
    it('should retry failed tasks', async () => {
      let attempts = 0;
      const retries: any[] = [];
      
      queue.on('task-retry', (info) => {
        retries.push(info);
      });

      queue.setProcessor(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Temporary failure');
        }
        return 'success';
      });

      queue.push(1, { maxRetries: 3 });
      queue.start();
      
      await queue.drain();

      expect(retries).toHaveLength(2); // 2 retries before success
      expect(attempts).toBe(3);
    });

    it('should fail after max retries', async () => {
      let attempts = 0;
      const errors: any[] = [];
      
      queue.on('task-error', (result) => {
        errors.push(result);
      });

      queue.setProcessor(async () => {
        attempts++;
        throw new Error('Permanent failure');
      });

      queue.push(1, { maxRetries: 2 });
      queue.start();
      
      await queue.drain();

      expect(attempts).toBe(3); // Initial + 2 retries
      expect(errors).toHaveLength(1);
      expect(errors[0].error.message).toBe('Permanent failure');
    });
  });

  describe('pause/resume', () => {
    it('should pause and resume processing', async () => {
      const processed: number[] = [];
      
      queue.setProcessor(async (data: number) => {
        processed.push(data);
        await new Promise(resolve => setTimeout(resolve, 50));
        return data;
      });

      queue.pushBatch([1, 2, 3, 4, 5]);
      queue.start();
      
      // Let some tasks start
      await new Promise(resolve => setTimeout(resolve, 75));
      
      queue.pause();
      const statsWhenPaused = queue.getStats();
      const processedWhenPaused = processed.length;
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Should not process more tasks while paused
      expect(processed.length).toBe(processedWhenPaused);
      expect(statsWhenPaused.isPaused).toBe(true);
      
      queue.resume();
      await queue.drain();
      
      expect(processed).toHaveLength(5);
    });
  });

  describe('clear', () => {
    it('should clear pending tasks', () => {
      const clearedTasks: any[] = [];
      
      queue.on('clear', (tasks) => {
        clearedTasks.push(...tasks);
      });

      queue.pushBatch([1, 2, 3, 4, 5]);
      expect(queue.getStats().pending).toBe(5);
      
      queue.clear();
      
      expect(queue.getStats().pending).toBe(0);
      expect(clearedTasks).toHaveLength(5);
    });
  });

  describe('removeTask', () => {
    it('should remove specific task', () => {
      const id1 = queue.push(1);
      const id2 = queue.push(2);
      const id3 = queue.push(3);
      
      expect(queue.getStats().pending).toBe(3);
      
      const removed = queue.removeTask(id2);
      
      expect(removed).toBe(true);
      expect(queue.getStats().pending).toBe(2);
      expect(queue.getTask(id2)).toBeUndefined();
      expect(queue.getTask(id1)).toBeDefined();
      expect(queue.getTask(id3)).toBeDefined();
    });

    it('should return false for non-existent task', () => {
      const removed = queue.removeTask('non-existent');
      expect(removed).toBe(false);
    });
  });

  describe('setConcurrency', () => {
    it('should update concurrency limit', () => {
      expect(queue.getStats().concurrency).toBe(2);
      
      queue.setConcurrency(5);
      
      expect(queue.getStats().concurrency).toBe(5);
    });

    it('should process more tasks when concurrency increased', async () => {
      let activeCount = 0;
      
      queue.setProcessor(async (data: number) => {
        const stats = queue.getStats();
        activeCount = Math.max(activeCount, stats.active);
        await new Promise(resolve => setTimeout(resolve, 100));
        return data;
      });

      // Add tasks
      queue.pushBatch([1, 2, 3, 4, 5]);
      queue.start();
      
      // Wait for initial tasks to start
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Increase concurrency
      queue.setConcurrency(4);
      
      await queue.drain();
      
      expect(activeCount).toBeGreaterThan(2);
    });
  });

  describe('events', () => {
    it('should emit lifecycle events', async () => {
      const events: string[] = [];
      
      queue.on('start', () => events.push('start'));
      queue.on('pause', () => events.push('pause'));
      queue.on('resume', () => events.push('resume'));
      queue.on('drain', () => events.push('drain'));
      queue.on('task-added', () => events.push('task-added'));
      queue.on('task-complete', () => events.push('task-complete'));
      
      queue.setProcessor(async (data) => data);
      
      queue.push(1);
      queue.start();
      queue.pause();
      queue.resume();
      
      await queue.drain();
      
      expect(events).toContain('start');
      expect(events).toContain('pause');
      expect(events).toContain('resume');
      expect(events).toContain('drain');
      expect(events).toContain('task-added');
      expect(events).toContain('task-complete');
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics', async () => {
      queue.setProcessor(async (data) => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return data;
      });

      queue.pushBatch([1, 2, 3, 4, 5]);
      
      const initialStats = queue.getStats();
      expect(initialStats.pending).toBe(5);
      expect(initialStats.active).toBe(0);
      expect(initialStats.total).toBe(5);
      
      queue.start();
      
      // Wait for some tasks to start
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const activeStats = queue.getStats();
      expect(activeStats.active).toBe(2); // Concurrency limit
      expect(activeStats.pending).toBe(3);
      expect(activeStats.total).toBe(5);
      expect(activeStats.isRunning).toBe(true);
      
      await queue.drain();
      
      const finalStats = queue.getStats();
      expect(finalStats.pending).toBe(0);
      expect(finalStats.active).toBe(0);
      expect(finalStats.total).toBe(0);
    });
  });
});