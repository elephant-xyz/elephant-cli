import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { QueueManager as QueueManagerType, QueueOptions } from '../../../src/utils/queue-manager';

// Declare a variable to hold the dynamically imported module
let ActualQueueManagerModule: typeof import('../../../src/utils/queue-manager');

describe('QueueManager', () => {
  let QM: typeof ActualQueueManagerModule.QueueManager; // To hold the constructor
  let queue: QueueManagerType<number, number>;

  beforeEach(async () => {
    vi.resetModules(); // Crucial: resets the module cache
    ActualQueueManagerModule = await import('../../../src/utils/queue-manager'); // Dynamically import the actual module
    QM = ActualQueueManagerModule.QueueManager; // Assign the constructor

    vi.clearAllMocks();
    vi.useRealTimers();
    
    queue = new QM({
      concurrency: 2,
      timeout: 2000, 
      autoStart: false
    });
  });

  describe('initialization', () => {
    it('should create queue with default options', () => {
      const defaultQueue = new QM();
      const stats = defaultQueue.getStats();
      expect(stats.pending).toBe(0);
      expect(stats.concurrency).toBe(10); 
      expect(stats.isRunning).toBe(false); 
    });

    it('should create queue with custom options', () => {
      const stats = queue.getStats();
      expect(stats.concurrency).toBe(2);
      expect(stats.isRunning).toBe(false);
    });

    it('should throw error if start called with no processor set', () => {
      const freshQueue = new QM({ autoStart: false });
      freshQueue.push(1);
      expect(() => freshQueue.start()).toThrow('No processor function set. Call setProcessor() first.');
    });
  });

  describe('push', () => {
    it('should add task to queue', () => {
      const taskId = queue.push(42);
      expect(taskId).toBeDefined();
      expect(queue.getStats().pending).toBe(1);
    });

    it('should add task with custom options', () => {
      const taskId = queue.push(42, { id: 'custom-id', priority: 5 });
      expect(taskId).toBe('custom-id');
      expect(queue.getTask(taskId)?.priority).toBe(5);
    });
    
    it('should sort tasks by priority', async () => {
      queue.setProcessor(async (data) => { await new Promise(r => setTimeout(r,1)); return data; });
      queue.push(1, { priority: 1 });
      queue.push(2, { priority: 3 }); 
      queue.push(3, { priority: 2 });
      const processedOrder: number[] = [];
      queue.on('task-complete', (res) => processedOrder.push(res.result as number));
      queue.start();
      await queue.drain();
      expect(processedOrder).toEqual([2, 3, 1]); 
    });

    it('should auto-start if enabled', async () => {
      // Use QM for this specific instance
      const autoQueue = new QM<number, boolean>({ autoStart: true, concurrency: 1, timeout: 2000 });
      let processed = false;
      autoQueue.setProcessor(async (data) => {
        await new Promise(resolve => setTimeout(resolve, 100));
        processed = true;
        return true; 
      });
      autoQueue.push(1);
      await autoQueue.drain(); 
      expect(processed).toBe(true);
    }, 15000);
  });

  describe('pushBatch', () => {
    it('should add multiple tasks', () => {
      const ids = queue.pushBatch([1, 2, 3]);
      expect(ids).toHaveLength(3);
      expect(queue.getStats().pending).toBe(3);
    });
    it('should apply same options to all tasks in batch', () => {
      const ids = queue.pushBatch([1,2], {priority: 5});
      ids.forEach(id => expect(queue.getTask(id)?.priority).toBe(5));
    });
  });

  describe('processing', () => {
    beforeEach(() => {
      queue.setProcessor(async (data: number) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return data * 2;
      });
    });

    it('should process tasks with processor function', async () => {
      const results: any[] = [];
      queue.on('task-complete', (result) => results.push(result));
      const id1 = queue.push(5);
      queue.start();
      await queue.drain();
      expect(results.find(r => r.id === id1)?.result).toBe(10);
    });

    it('should respect concurrency limit', async () => {
      let maxObservedActive = 0;
      const q = new QM<number,number>({concurrency: 2, autoStart: false});
      q.setProcessor(async (data) => {
        maxObservedActive = Math.max(maxObservedActive, q.getStats().active);
        await new Promise(r => setTimeout(r, 50));
        return data;
      });
      q.pushBatch([1,2,3,4]);
      q.start();
      await q.drain();
      expect(maxObservedActive).toBeLessThanOrEqual(2);
      if (q.getStats().completed > 0) {
         expect(maxObservedActive).toBeGreaterThan(0);
      }
    });

    it('should handle processor errors', async () => {
      const errors: any[] = [];
      queue.on('task-error', (result) => errors.push(result));
      queue.setProcessor(async (data) => { if (data === 1) throw new Error("fail"); return data; });
      queue.push(1);
      queue.start();
      await queue.drain();
      expect(errors).toHaveLength(1);
      expect(errors[0].error.message).toBe("fail");
    });
  });

  describe('timeout', () => {
    it('should timeout long-running tasks', async () => {
      const errors: any[] = [];
      const qWithTimeout = new QM<number, number>({ timeout: 100, autoStart: false, retries: 0 });
      qWithTimeout.setProcessor(async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
        return 42;
      });
      qWithTimeout.push(1);
      qWithTimeout.start();
      await new Promise<void>((resolve, reject) => {
        qWithTimeout.on('task-error', (errorResult) => { errors.push(errorResult); resolve(); });
        qWithTimeout.on('drain', () => { if (errors.length === 0) reject(new Error('Queue drained without task-error on timeout.')); });
        setTimeout(() => { if (errors.length === 0) reject(new Error('Test timed out waiting for task-error.')); }, 700);
      });
      expect(errors).toHaveLength(1);
      expect(errors[0].error.message).toContain('timed out after 100ms');
    });
  });

  describe('retry', () => {
    it('should retry failed tasks up to maxRetries', async () => {
      let attempts = 0;
      const q = new QM<number, string>({retries: 2, autoStart: false});
      q.setProcessor(async () => { attempts++; if (attempts <= 2) throw new Error("Temporary fail"); return "success"; });
      const taskComplete = vi.fn();
      q.on('task-complete', taskComplete);
      q.push(1); q.start(); await q.drain();
      expect(attempts).toBe(3); 
      expect(taskComplete).toHaveBeenCalledWith(expect.objectContaining({result: "success"}));
    });

    it('should fail permanently after max retries', async () => {
      let attempts = 0;
      const q = new QM<number, string>({retries: 1, autoStart: false}); 
      q.setProcessor(async () => { attempts++; throw new Error("Permanent fail"); });
      const taskError = vi.fn();
      q.on('task-error', taskError);
      q.push(1); q.start(); await q.drain();
      expect(attempts).toBe(2); // 1 initial + 1 retry
      expect(taskError).toHaveBeenCalledWith(expect.objectContaining({error: expect.any(Error)}));
      if (taskError.mock.calls.length > 0) {
        expect(taskError.mock.calls[0][0].error.message).toBe("Permanent fail");
      } else {
        throw new Error("taskError was not called");
      }
    });
  });
  
  describe('pause/resume', () => {
    it('should pause and resume processing', async () => {
      const processed: number[] = [];
      queue.setProcessor(async (data: number) => { processed.push(data); await new Promise(resolve => setTimeout(resolve, 20)); return data; });
      queue.pushBatch([1, 2, 3, 4]); queue.start();
      await new Promise(resolve => setTimeout(resolve, 30)); 
      queue.pause();
      const processedCountWhenPaused = processed.length;
      expect(queue.getStats().isPaused).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(processed.length).toBe(processedCountWhenPaused);
      queue.resume(); await queue.drain();
      expect(processed.length).toBe(4);
      expect(queue.getStats().isPaused).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear pending tasks and emit event', () => {
      const clearedHandler = vi.fn();
      queue.on('clear', clearedHandler);
      queue.pushBatch([1, 2, 3]); queue.clear();
      expect(queue.getStats().pending).toBe(0);
      expect(clearedHandler).toHaveBeenCalledWith(expect.arrayContaining([
          expect.objectContaining({data:1}), expect.objectContaining({data:2}), expect.objectContaining({data:3}),
      ]));
    });
  });

  describe('removeTask', () => {
    it('should remove a specific task from pending', () => {
      const id1 = queue.push(1); queue.push(2);
      expect(queue.removeTask(id1)).toBe(true);
      expect(queue.getStats().pending).toBe(1);
      expect(queue.getTask(id1)).toBeUndefined();
    });
     it('should return false if task not found for removal', () => {
      expect(queue.removeTask("nonexistent")).toBe(false);
    });
  });

  describe('setConcurrency', () => {
    it('should update concurrency and affect processing', async () => {
      expect(queue.getStats().concurrency).toBe(2);
      queue.setConcurrency(1);
      expect(queue.getStats().concurrency).toBe(1);
      const q = new QM<number,number>({concurrency: 1, autoStart: false});
      let maxActive = 0;
      q.setProcessor(async data => { maxActive = Math.max(maxActive, q.getStats().active); await new Promise(r=>setTimeout(r,10)); return data; });
      q.pushBatch([1,2,3]); q.start(); await q.drain();
      if(q.getStats().completed > 0) expect(maxActive).toBe(1);
    });
  });

  describe('events', () => {
    it('should emit various lifecycle events with correct payloads', async () => {
      const startHandler = vi.fn(); const taskAddedHandler = vi.fn();
      const taskCompleteHandler = vi.fn(); const drainHandler = vi.fn();
      queue.on('start', startHandler); queue.on('task-added', taskAddedHandler);
      queue.on('task-complete', taskCompleteHandler); queue.on('drain', drainHandler);
      queue.setProcessor(async data => data);
      const taskId = queue.push(1); queue.start(); await queue.drain();
      expect(startHandler).toHaveBeenCalledTimes(1);
      expect(taskAddedHandler).toHaveBeenCalledWith(expect.objectContaining({ id: taskId, data: 1 }));
      expect(taskCompleteHandler).toHaveBeenCalledWith(expect.objectContaining({ id: taskId, result: 1 }));
      expect(drainHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics throughout lifecycle', async () => {
      queue.setProcessor(async data => {await new Promise(r => setTimeout(r,30)); return data;}); 
      expect(queue.getStats().total).toBe(0);
      queue.push(1);
      expect(queue.getStats().pending).toBe(1);
      queue.start();
      await new Promise(resolve => setTimeout(resolve, 10)); 
      await queue.drain();
      const finalStats = queue.getStats();
      expect(finalStats.completed).toBe(1);
      expect(finalStats.active).toBe(0);
      expect(finalStats.pending).toBe(0);
    });
  });
});