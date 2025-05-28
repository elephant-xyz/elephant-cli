import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueueManager, QueueOptions, QueueTask, QueueResult } from '../../../src/utils/queue-manager'; // Adjust path as needed

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
      expect(q.getStats().concurrency).toBe(10); // Default concurrency is 10
      // @ts-ignore access private member for test
      expect(q.autoStart).toBe(true);
    });

    it('should create queue with custom options', () => {
      const opts: QueueOptions = {
        concurrency: 5,
        autoStart: false,
        timeout: 1000,
      };
      const q = new QueueManager(opts);
      expect(q.getStats().concurrency).toBe(5);
      // @ts-ignore access private member for test
      expect(q.autoStart).toBe(false);
      // @ts-ignore access private member for test
      expect(q.timeout).toBe(1000);
    });

    it('should throw error if start called with no processor set', () => {
      const q = new QueueManager({ autoStart: false });
      expect(() => q.start()).toThrow('No processor function set. Call setProcessor() first.');
    });
  });

  describe('push', () => {
    it('should add task to queue', () => {
      const q = new QueueManager({ autoStart: false });
      q.setProcessor(vi.fn());
      q.push({ id: 1 });
      expect(q.getStats().pending).toBe(1);
    });

    it('should resolve with task result via event', async () => {
      const q = new QueueManager<{ id: number }, string>({ autoStart: false });
      q.setProcessor(vi.fn().mockResolvedValue('done'));
      
      const taskCompletePromise = new Promise<QueueResult<string>>((resolve) => {
        q.on('task-complete', (result) => resolve(result));
      });

      const taskId = q.push({ id: 1 });
      q.start();
      await vi.runAllTimersAsync(); 
      
      const result = await taskCompletePromise;
      expect(result.id).toBe(taskId);
      expect(result.result).toBe('done');
    });

    it('should auto-start if enabled', async () => {
      const processor = vi.fn().mockResolvedValue('processed');
      const q = new QueueManager({ autoStart: true, concurrency: 1 });
      q.setProcessor(processor);
      
      const taskCompletePromise = new Promise<void>((resolve) => {
        q.on('task-complete', () => resolve());
      });

      q.push({ id: 1 });
      // Ensure processNext has a chance to be invoked if there's any microtask scheduling
      await vi.advanceTimersByTimeAsync(0); 
      await vi.runAllTimersAsync(); 
      await taskCompletePromise; 
      expect(processor).toHaveBeenCalledWith({ id: 1 });
    });

    it('should assign unique task IDs', () => {
      const q = new QueueManager({ autoStart: false });
      q.setProcessor(vi.fn());
      const id1 = q.push({ data: 'a' });
      const id2 = q.push({ data: 'b' });
      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(q.getTask(id1)).toBeDefined();
      expect(q.getTask(id2)).toBeDefined();
    });
  });

  describe('pushBatch', () => {
    it('should add multiple tasks and return array of task IDs', async () => {
      const q = new QueueManager<{ id: number }, string>({ autoStart: false });
      const taskResults: Record<string, string> = {};
      
      q.setProcessor(vi.fn(async (taskData: {id: number}) => {
        const res = `processed: ${taskData.id}`;
        await new Promise(r => setTimeout(r,1)); // Simulate async work
        return res;
      }));

      const items = [{ id: 1 }, { id: 2 }];
      const taskIds = q.pushBatch(items);
      
      expect(q.getStats().pending).toBe(2);
      expect(taskIds).toHaveLength(2);
      
      const taskCompletionPromises = taskIds.map(id => 
        new Promise<QueueResult<string>>(resolve => {
          const handler = (result: QueueResult<string>) => {
            if (result.id === id) {
              taskResults[result.id] = result.result!;
              q.off('task-complete', handler);
              resolve(result);
            }
          };
          q.on('task-complete', handler);
        })
      );
      
      q.start();
      await vi.runAllTimersAsync();
      
      const completedResults = await Promise.all(taskCompletionPromises);

      expect(taskResults[taskIds[0]]).toBe('processed: 1');
      expect(taskResults[taskIds[1]]).toBe('processed: 2');
      expect(completedResults.length).toBe(items.length);
    });

    it('should handle empty batch', () => {
      const q = new QueueManager();
      const ids = q.pushBatch([]);
      expect(ids).toEqual([]);
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

      // After start, processNext is called, and activeCount is incremented synchronously
      expect(q.getStats().active).toBe(2); // Corrected: Should be 2 active tasks immediately
      // await vi.advanceTimersByTimeAsync(0); // This line is not strictly necessary for the above assertion
      expect(q.getStats().pending).toBe(1);

      await vi.advanceTimersByTimeAsync(10); 
      expect(q.getStats().active).toBe(1); 
      expect(q.getStats().pending).toBe(0);

      await vi.advanceTimersByTimeAsync(10); 
      expect(q.getStats().active).toBe(0);
    });

    it('should emit task-complete on success', async () => {
      const taskCompletedHandler = vi.fn();
      const q = new QueueManager<{ id: string }, string>();
      q.setProcessor(vi.fn().mockResolvedValue('success'));
      q.on('task-complete', taskCompletedHandler);
      
      const taskId = q.push({ id: 'test' });
      await vi.runAllTimersAsync();
      
      expect(taskCompletedHandler).toHaveBeenCalledWith(expect.objectContaining({ id: taskId, result: 'success' }));
    });

    it('should emit task-error on error', async () => {
      const taskFailedHandler = vi.fn();
      const q = new QueueManager();
      q.setProcessor(vi.fn().mockRejectedValue(new Error('fail')));
      q.on('task-error', taskFailedHandler);
      
      const taskId = q.push({ id: 'test' });
      await vi.runAllTimersAsync();
      
      expect(taskFailedHandler).toHaveBeenCalledWith(expect.objectContaining({ id: taskId, error: expect.any(Error) }));
    });
  });

  describe('timeout', () => {
    it('should timeout task if it exceeds timeout duration', async () => {
      const taskFailedHandler = vi.fn();
      const q = new QueueManager({ timeout: 50 }); 
      q.setProcessor(() => new Promise(resolve => setTimeout(resolve, 100))); 
      q.on('task-error', taskFailedHandler);
      
      const taskId = q.push({ id: 'timeout_test' }, { maxRetries: 0 });
      await vi.advanceTimersByTimeAsync(50); 
      await vi.runAllTimersAsync(); // Ensure any subsequent event emissions are processed

      expect(taskFailedHandler).toHaveBeenCalledWith(expect.objectContaining({
        id: taskId,
        error: expect.objectContaining({ message: expect.stringContaining('timed out') }),
      }));
    });
  });

  describe('retry', () => {
    it('should retry failed task up to maxRetries', async () => {
      let attempts = 0;
      const processor = vi.fn(async (task) => {
        attempts++;
        if (attempts < 2) throw new Error('fail');
        return 'success';
      });
      const q = new QueueManager(); 
      q.setProcessor(processor);
      
      const taskCompleteHandler = vi.fn();
      q.on('task-complete', taskCompleteHandler);

      const taskId = q.push({ id: 'retry_test' }, { maxRetries: 1 }); 
      await vi.runAllTimersAsync();

      expect(attempts).toBe(2);
      expect(taskCompleteHandler).toHaveBeenCalledWith(expect.objectContaining({ id: taskId, result: 'success' }));
    });

    it('should fail permanently after max retries', async () => {
      let attempts = 0;
      const processor = vi.fn(async () => {
        attempts++;
        throw new Error(`Attempt ${attempts} failed`);
      });
      const taskErrorHandler = vi.fn();
      const q = new QueueManager(); 
      q.setProcessor(processor);
      q.on('task-error', taskErrorHandler);

      const taskId = q.push({ id: 'perm_fail' }, { maxRetries: 1 }); // 1 initial + 1 retry = 2 attempts
      await vi.runAllTimersAsync();
      
      expect(attempts).toBe(2); 
      expect(taskErrorHandler).toHaveBeenCalledTimes(1); // Ensure task-error is emitted only once for the final failure
      expect(taskErrorHandler).toHaveBeenCalledWith(
        expect.objectContaining({ id: taskId, error: expect.objectContaining({ message: 'Attempt 2 failed' }) })
      );
    });
  });

  describe('pause/resume', () => {
    it('should pause and resume processing', async () => {
      const processor = vi.fn().mockImplementation(() => new Promise(r => setTimeout(() => r('done'), 10)));
      const q = new QueueManager({ concurrency: 1, autoStart: false });
      q.setProcessor(processor);
      q.pushBatch([{id:1},{id:2}]);
      q.start();
      await vi.advanceTimersByTimeAsync(0); 
      
      q.pause();
      expect(q.getStats().active).toBe(1); 
      expect(processor).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(100); 
      expect(q.getStats().active).toBe(0);
      expect(processor).toHaveBeenCalledTimes(1); 

      q.resume();
      await vi.advanceTimersByTimeAsync(0); 
      expect(q.getStats().active).toBe(1);
      
      await vi.advanceTimersByTimeAsync(100); 
      expect(processor).toHaveBeenCalledTimes(2);
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
      
      const taskRemovedHandler = vi.fn();
      q.on('task-removed', taskRemovedHandler);

      const id1 = q.push({ id: 'task1' });
      const id2 = q.push({ id: 'task2' });
      
      expect(q.getStats().pending).toBe(2);
      const removed = q.removeTask(id1);
      expect(removed).toBe(true);
      expect(q.getStats().pending).toBe(1);
      expect(taskRemovedHandler).toHaveBeenCalledWith(id1);
      expect(q.getTask(id1)).toBeUndefined();
      expect(q.getTask(id2)).toBeDefined();

      const taskCompleteHandler = vi.fn();
      q.on('task-complete', taskCompleteHandler);
      q.start();
      await vi.runAllTimersAsync();
      expect(taskCompleteHandler).toHaveBeenCalledTimes(1);
      expect(taskCompleteHandler).toHaveBeenCalledWith(expect.objectContaining({ id: id2 }));
    });

    it('should not remove an active or completed task', async () => {
      const deferred = createDeferredPromise<string>();
      const q = new QueueManager<any, string>({ concurrency: 1, autoStart: false });
      q.setProcessor(() => deferred.promise);
      
      const taskId = q.push({ id: 'active_task' });
      q.start();
      await vi.advanceTimersByTimeAsync(0); 
      
      const removedActive = q.removeTask(taskId);
      expect(removedActive).toBe(false); 
      expect(q.getStats().active).toBe(1);

      deferred.resolve('completed');
      await vi.runAllTimersAsync(); 
      
      const removedCompleted = q.removeTask(taskId);
      expect(removedCompleted).toBe(false); 
    });
  });
  
  describe('setConcurrency', () => {
    it('should change concurrency and process more tasks if available', async () => {
      const processor = vi.fn(() => new Promise(resolve => setTimeout(() => resolve('done'), 10)));
      const q = new QueueManager({ concurrency: 1, autoStart: false });
      q.setProcessor(processor);
      q.pushBatch([{id:1},{id:2},{id:3}]); // 3 tasks pending
      q.start(); // 1 active, 2 pending
      await vi.advanceTimersByTimeAsync(0);
      expect(q.getStats().active).toBe(1);
      expect(q.getStats().pending).toBe(2);

      q.setConcurrency(3);
      await vi.advanceTimersByTimeAsync(0); 
      // Now 2 more tasks should start
      expect(q.getStats().active).toBe(3); // All 3 tasks should be active
      expect(q.getStats().pending).toBe(0);
    });
  });

  describe('events', () => {
    it('should emit "drain" event when queue is empty and no active tasks', async () => {
      const drainHandler = vi.fn();
      const q = new QueueManager({concurrency: 1}); // Ensure concurrency for predictability
      q.setProcessor(vi.fn(async () => {
        await new Promise(r => setTimeout(r, 1)); // Simulate async work
        return 'done';
      }));
      q.on('drain', drainHandler);
      
      q.push({ id: 1 });
      // Allow the task to be processed and completed
      await vi.runAllTimersAsync(); 
      // Ensure any final microtasks or zero-delay timers related to drain emission run
      await vi.advanceTimersByTimeAsync(0); 

      expect(drainHandler).toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics throughout lifecycle', async () => {
      const processor = vi.fn().mockResolvedValue('done');
      const queue = new QueueManager({ concurrency: 1, autoStart: false });
      queue.setProcessor(processor);

      expect(queue.getStats()).toEqual({ 
        pending: 0, 
        active: 0, 
        total: 0, 
        concurrency: 1, 
        isPaused: false,
        isRunning: false 
      });
      
      queue.push({ id: 1 });
      expect(queue.getStats()).toEqual(expect.objectContaining({ pending: 1, total: 1, isRunning: false, active: 0 }));

      queue.start();
      // After start() is called, and processNext() runs synchronously for the first task:
      expect(queue.getStats()).toEqual(expect.objectContaining({ pending: 0, active: 1, total: 1, isRunning: true }));

      // No need to advance timers here if checking state immediately after start and synchronous part of processNext
      // await vi.advanceTimersByTimeAsync(0); // Task becomes active (already asserted)
      // expect(queue.getStats()).toEqual(expect.objectContaining({ pending: 0, active: 1, total: 1, isRunning: true }));
      
      await vi.runAllTimersAsync(); // Ensure task completes
      
      expect(queue.getStats()).toEqual(expect.objectContaining({ 
        pending: 0, 
        active: 0, 
        total: 0, 
        isRunning: true, 
      }));
    });
  });
});
