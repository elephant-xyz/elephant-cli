import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueueManager, QueueOptions } from '../../../src/utils/queue-manager'; // Adjust path as needed

// Helper to create a promise that can be resolved/rejected externally
const createDeferredPromise = <T>() => {
  let resolveFn: (value: T | PromiseLike<T>) => void;
  let rejectFn: (reason?: any) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  // @ts-ignore
  return { promise, resolve: resolveFn, reject: rejectFn };
};

describe('QueueManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks(); // Restores original timers
  });

  describe('initialization', () => {
    it('should create queue with default options', () => {
      const q = new QueueManager();
      expect(q.getStats().concurrency).toBe(1);
      // @ts-ignore
      expect(q.options.autoStart).toBe(true);
      // @ts-ignore
      expect(q.options.retries).toBe(3);
    });

    it('should create queue with custom options', () => {
      const opts: QueueOptions<any, any> = {
        concurrency: 5,
        autoStart: false,
        retries: 1,
        timeout: 1000,
        delayBetweenTasks: 50,
      };
      const q = new QueueManager(opts);
      expect(q.getStats().concurrency).toBe(5);
      // @ts-ignore
      expect(q.options.autoStart).toBe(false);
      // @ts-ignore
      expect(q.options.retries).toBe(1);
    });

    it('should throw error if start called with no processor set', () => {
      const q = new QueueManager({ autoStart: false });
      expect(() => q.start()).toThrow('Processor function not set.');
    });
  });

  describe('push', () => {
    it('should add task to queue', () => {
      const q = new QueueManager({ autoStart: false });
      q.setProcessor(vi.fn());
      q.push({ id: 1 });
      expect(q.getStats().pending).toBe(1);
    });

    it('should return a promise that resolves with task result', async () => {
      const q = new QueueManager<any, string>({ autoStart: false });
      q.setProcessor(vi.fn().mockResolvedValue('done'));
      const taskPromise = q.push({ id: 1 });
      q.start();
      await vi.runAllTimersAsync(); // Ensure setTimeout(processNext, 0) runs
      const result = await taskPromise;
      expect(result.result).toBe('done');
    });

    it('should auto-start if enabled', async () => {
      const processor = vi.fn().mockResolvedValue('processed');
      const q = new QueueManager({ autoStart: true, concurrency: 1 });
      q.setProcessor(processor);
      const taskPromise = q.push({ id: 1 });
      await vi.runAllTimersAsync(); // Allow microtasks and setTimeout(0) to run
      await taskPromise; // Wait for the pushed task to complete
      expect(processor).toHaveBeenCalledWith({ id: 1 });
    });

    it('should assign unique task IDs', () => {
      const q = new QueueManager({ autoStart: false });
      q.setProcessor(vi.fn());
      const p1 = q.push({ data: 'a' });
      const p2 = q.push({ data: 'b' });
      // @ts-ignore
      const internalTasks = Array.from(q.taskMap.values());
      expect(internalTasks[0].id).not.toBe(internalTasks[1].id);
    });
  });

  describe('pushBatch', () => {
    it('should add multiple tasks and return array of promises', async () => {
      const q = new QueueManager<any, string>({ autoStart: false });
      q.setProcessor(vi.fn((task) => Promise.resolve(`processed: ${task.id}`)));
      const items = [{ id: 1 }, { id: 2 }];
      const promises = q.pushBatch(items);
      expect(q.getStats().pending).toBe(2);
      expect(promises).toHaveLength(2);
      q.start();
      await vi.runAllTimersAsync();
      const results = await Promise.all(promises);
      expect(results.map(r => r.result)).toEqual(['processed: 1', 'processed: 2']);
    });

    it('should handle empty batch', () => {
      const q = new QueueManager();
      const promises = q.pushBatch([]);
      expect(promises).toEqual([]);
      expect(q.getStats().pending).toBe(0);
    });
  });

  describe('processing', () => {
    it('should process tasks according to concurrency', async () => {
      const processor = vi.fn(() => new Promise(resolve => setTimeout(() => resolve('done'), 10)));
      const q = new QueueManager({ concurrency: 2, autoStart: false });
      q.setProcessor(processor);

      q.pushBatch([{id:1},{id:2},{id:3}]);
      q.start();

      expect(q.getStats().active).toBe(0); // Initially 0, start defers with setTimeout
      await vi.advanceTimersByTimeAsync(0); // Process initial batch
      expect(q.getStats().active).toBe(2);
      expect(q.getStats().pending).toBe(1);

      await vi.advanceTimersByTimeAsync(10); // Finish first 2 tasks
      expect(q.getStats().active).toBe(1); // 3rd task starts
      expect(q.getStats().pending).toBe(0);

      await vi.advanceTimersByTimeAsync(10); // Finish 3rd task
      expect(q.getStats().active).toBe(0);
    });

    it('should emit task_completed on success', async () => {
      const taskCompletedHandler = vi.fn();
      const q = new QueueManager<any, string>();
      q.setProcessor(vi.fn().mockResolvedValue('success'));
      q.on('task_completed', taskCompletedHandler);
      const taskPromise = q.push({ id: 'test' });
      await vi.runAllTimersAsync();
      await taskPromise;
      expect(taskCompletedHandler).toHaveBeenCalledWith(expect.objectContaining({ result: 'success', task: { id: 'test' } }));
    });

    it('should emit task_failed on error', async () => {
      const taskFailedHandler = vi.fn();
      const q = new QueueManager();
      q.setProcessor(vi.fn().mockRejectedValue(new Error('fail')));
      q.on('task_failed', taskFailedHandler);
      const taskPromise = q.push({ id: 'test' }).catch(() => {}); // Catch to prevent unhandled rejection
      await vi.runAllTimersAsync();
      await taskPromise;
      expect(taskFailedHandler).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(Error), task: { id: 'test' } }));
    });
  });

  describe('timeout', () => {
    it('should timeout task if it exceeds timeout duration', async () => {
      const taskFailedHandler = vi.fn();
      const q = new QueueManager({ timeout: 50, retries: 0 }); // No retries for this test
      q.setProcessor(() => new Promise(resolve => setTimeout(resolve, 100))); // Task takes 100ms
      q.on('task_failed', taskFailedHandler);
      
      const taskPromise = q.push({ id: 'timeout_test' }).catch(() => {});
      await vi.advanceTimersByTimeAsync(50); // Advance to timeout
      
      await taskPromise;
      expect(taskFailedHandler).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({ message: expect.stringContaining('timed out') }),
        task: { id: 'timeout_test' }
      }));
    });
  });

  describe('retry', () => {
    it('should retry failed task up to retry limit', async () => {
      let attempts = 0;
      const processor = vi.fn(async (task) => {
        attempts++;
        if (attempts < 2) throw new Error('fail');
        return 'success';
      });
      const q = new QueueManager({ retries: 1 }); // 1 retry means 2 total attempts
      q.setProcessor(processor);
      
      const result = await q.push({ id: 'retry_test' });
      await vi.runAllTimersAsync();

      expect(attempts).toBe(2);
      expect(result.result).toBe('success');
    });

    it('should fail permanently after max retries', async () => {
      let attempts = 0;
      const processor = vi.fn(async () => {
        attempts++;
        throw new Error(`Attempt ${attempts} failed`);
      });
      const taskError = vi.fn();
      const q = new QueueManager({ retries: 1 }); // Test expects 1 initial + 1 retry = 2 attempts
      q.setProcessor(processor);
      q.on('task_failed', taskError);

      await expect(q.push({ id: 'perm_fail' })).rejects.toThrow('Attempt 2 failed');
      await vi.runAllTimersAsync();
      
      expect(attempts).toBe(2);  // 1 initial + 1 retry
      expect(taskError).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) })
      );
    });
  });

  describe('pause/resume', () => {
    it('should pause and resume processing', async () => {
      const processor = vi.fn().mockResolvedValue('done');
      const q = new QueueManager({ concurrency: 1, autoStart: false });
      q.setProcessor(processor);
      q.pushBatch([{id:1},{id:2}]);
      q.start();
      await vi.advanceTimersByTimeAsync(0); // Let one task start
      
      q.pause();
      expect(q.getStats().active).toBe(1); // First task is active
      expect(processor).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(100); // Let active task finish, but queue is paused
      expect(q.getStats().active).toBe(0);
      expect(q.getStats().completed).toBe(1);
      expect(processor).toHaveBeenCalledTimes(1); // No new task started

      q.resume();
      await vi.advanceTimersByTimeAsync(0); // Let next task start
      expect(q.getStats().active).toBe(1);
      
      await vi.advanceTimersByTimeAsync(100); // Let it finish
      expect(processor).toHaveBeenCalledTimes(2);
      expect(q.getStats().completed).toBe(2);
    });
  });

  describe('clear', () => {
    it('should clear pending tasks from queue', () => {
      const q = new QueueManager({ autoStart: false });
      q.setProcessor(vi.fn());
      q.push({ id: 1 });
      q.push({ id: 2 });
      q.clear();
      expect(q.getStats().pending).toBe(0);
    });
  });

  describe('removeTask', () => {
    it('should remove a specific task by ID if pending', async () => {
      const q = new QueueManager<any, string>({ autoStart: false });
      q.setProcessor(vi.fn().mockResolvedValue('done'));
      const promise1 = q.push({ id: 'task1' });
      const promise2 = q.push({ id: 'task2' });
      // @ts-ignore
      const internalTask1 = Array.from(q.taskMap.values()).find(t => t.originalTask.id === 'task1');
      
      expect(q.getStats().pending).toBe(2);
      // @ts-ignore
      const removed = q.removeTask(internalTask1.id);
      expect(removed).toBe(true);
      expect(q.getStats().pending).toBe(1);

      q.start();
      await vi.runAllTimersAsync();
      
      await expect(promise1).rejects.toThrow('Task removed before processing');
      await expect(promise2).resolves.toEqual(expect.objectContaining({ result: 'done' }));
    });

    it('should not remove an active or completed task', async () => {
      const deferred = createDeferredPromise<string>();
      const q = new QueueManager<any, string>({ concurrency: 1, autoStart: false });
      q.setProcessor(() => deferred.promise);
      
      const taskPromise = q.push({ id: 'active_task' });
      q.start();
      await vi.advanceTimersByTimeAsync(0); // Ensure task becomes active
      
      // @ts-ignore
      const internalTask = Array.from(q.taskMap.values())[0];
      // @ts-ignore
      const removed = q.removeTask(internalTask.id);
      expect(removed).toBe(false);
      expect(q.getStats().active).toBe(1);

      deferred.resolve('completed');
      await taskPromise;
      await vi.runAllTimersAsync();
      // @ts-ignore
      const removedAfterComplete = q.removeTask(internalTask.id);
      expect(removedAfterComplete).toBe(false);

    });
  });
  
  describe('setConcurrency', () => {
    it('should change concurrency and process more tasks if available', async () => {
      const processor = vi.fn(() => new Promise(resolve => setTimeout(() => resolve('done'), 10)));
      const q = new QueueManager({ concurrency: 1, autoStart: false });
      q.setProcessor(processor);
      q.pushBatch([{id:1},{id:2},{id:3}]);
      q.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(q.getStats().active).toBe(1);

      q.setConcurrency(3);
      await vi.advanceTimersByTimeAsync(0); // Allow new tasks to start
      expect(q.getStats().active).toBe(3);
    });
  });

  describe('events', () => {
    it('should emit "drain" event when queue is empty', async () => {
      const drainHandler = vi.fn();
      const q = new QueueManager();
      q.setProcessor(vi.fn().mockResolvedValue('done'));
      q.on('drain', drainHandler);
      q.push({ id: 1 });
      await vi.runAllTimersAsync(); // Process the task
      await q.drain(); // Wait for drain
      expect(drainHandler).toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics throughout lifecycle', async () => {
      const processor = vi.fn().mockResolvedValue('done');
      const queue = new QueueManager({ concurrency: 1, autoStart: false });
      queue.setProcessor(processor);

      expect(queue.getStats()).toEqual({ pending: 0, active: 0, completed: 0, failed: 0, retries: 0, concurrency: 1, isPaused: false });
      
      const taskPromise = queue.push({ id: 1 });
      expect(queue.getStats().pending).toBe(1);

      queue.start();
      await vi.advanceTimersByTimeAsync(0); // Task becomes active
      expect(queue.getStats().active).toBe(1);
      expect(queue.getStats().pending).toBe(0);
      
      await taskPromise; // Wait for task to complete
      await vi.runAllTimersAsync(); // Ensure all microtasks/timers related to completion are done
      
      const finalStats  = queue.getStats();
      expect(finalStats.completed).toBe(1);
      expect(finalStats.active).toBe(0);
      expect(finalStats.pending).toBe(0);
    });
  });
});
