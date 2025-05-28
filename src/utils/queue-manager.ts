import { EventEmitter } from 'events';

export interface QueueOptions {
  concurrency?: number;
  timeout?: number;
  autoStart?: boolean;
}

export interface QueueTask<T = unknown> {
  id: string;
  data: T;
  priority?: number;
  retries?: number;
  maxRetries?: number;
}

export interface QueueResult<R = unknown> {
  id: string;
  result?: R;
  error?: Error;
  duration: number;
}

type TaskProcessor<T, R> = (data: T) => Promise<R>;

export class QueueManager<T = unknown, R = unknown> extends EventEmitter {
  private queue: QueueTask<T>[] = [];
  private activeCount = 0;
  private concurrency: number;
  private timeout: number;
  private autoStart: boolean;
  private processor?: TaskProcessor<T, R>;
  private isRunning = false;
  private isPaused = false;

  constructor(options: QueueOptions = {}) {
    super();
    this.concurrency = options.concurrency || 10;
    this.timeout = options.timeout || 30000;
    this.autoStart = options.autoStart ?? true; // Ensure autoStart defaults to true if undefined
  }

  /**
   * Set the task processor function
   */
  setProcessor(processor: TaskProcessor<T, R>): void {
    this.processor = processor;
    if (this.autoStart && this.queue.length > 0) {
      this.start();
    }
  }

  /**
   * Add a task to the queue
   */
  push(data: T, options: Partial<QueueTask<T>> = {}): string {
    const task: QueueTask<T> = {
      id: options.id || Math.random().toString(36).substr(2, 9),
      data,
      priority: options.priority || 0,
      retries: options.retries || 0,
      maxRetries: options.maxRetries || 3,
    };

    // Insert based on priority (higher priority first)
    const insertIndex = this.queue.findIndex(
      (item) => item.priority! < task.priority!
    );
    if (insertIndex === -1) {
      this.queue.push(task);
    } else {
      this.queue.splice(insertIndex, 0, task);
    }

    this.emit('task-added', task);

    if (this.autoStart && this.processor && !this.isPaused) {
      if (!this.isRunning) {
        this.start(); // This will set isRunning and call processNext for existing tasks
      } else {
        // If already running, new task was added, processNext might be needed if concurrency allows
        this.processNext();
      }
    }

    return task.id;
  }

  /**
   * Add multiple tasks to the queue
   */
  pushBatch(dataArray: T[], options: Partial<QueueTask<T>> = {}): string[] {
    return dataArray.map((data) => this.push(data, options));
  }

  /**
   * Start processing the queue
   */
  start(): void {
    if (!this.processor) {
      throw new Error('No processor function set. Call setProcessor() first.');
    }

    this.isRunning = true;
    this.isPaused = false;
    this.emit('start');

    // Process up to concurrency limit
    const processCount = Math.min(
      this.concurrency - this.activeCount,
      this.queue.length
    );
    for (let i = 0; i < processCount; i++) {
      this.processNext();
    }
  }

  /**
   * Pause queue processing
   */
  pause(): void {
    this.isPaused = true;
    this.emit('pause');
  }

  /**
   * Resume queue processing
   */
  resume(): void {
    this.isPaused = false;
    this.emit('resume');

    // Process any pending tasks
    const processCount = Math.min(
      this.concurrency - this.activeCount,
      this.queue.length
    );
    for (let i = 0; i < processCount; i++) {
      this.processNext();
    }
  }

  /**
   * Process the next task in the queue
   */
  private async processNext(): Promise<void> {
    if (
      !this.processor ||
      this.isPaused ||
      !this.isRunning ||
      this.activeCount >= this.concurrency ||
      this.queue.length === 0
    ) {
      return;
    }

    const task = this.queue.shift()!;
    this.activeCount++;

    const startTime = Date.now();
    let timeoutId: NodeJS.Timeout | undefined;

    try {
      // Set up timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(`Task ${task.id} timed out after ${this.timeout}ms`)
          );
        }, this.timeout);
      });

      // Process the task
      const result = await Promise.race([
        this.processor!(task.data),
        timeoutPromise,
      ]);

      if (timeoutId) clearTimeout(timeoutId);

      const queueResult: QueueResult<R> = {
        id: task.id,
        result,
        duration: Date.now() - startTime,
      };

      this.emit('task-complete', queueResult);
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);

      const errorObj =
        error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      if (task.retries! < task.maxRetries!) {
        task.retries!++;
        this.queue.unshift(task); // Put back at front of queue
        this.emit('task-retry', {
          id: task.id,
          error: errorObj,
          retries: task.retries,
        });
      } else {
        const queueResult: QueueResult<R> = {
          id: task.id,
          error: errorObj,
          duration: Date.now() - startTime,
        };

        this.emit('task-error', queueResult);
      }
    } finally {
      this.activeCount--;

      // Process next task if available
      if (this.queue.length > 0 && !this.isPaused) {
        this.processNext();
      } else if (this.activeCount === 0 && this.queue.length === 0) {
        this.emit('drain');
      }
    }
  }

  /**
   * Wait for all tasks to complete
   */
  async drain(): Promise<void> {
    if (this.queue.length === 0 && this.activeCount === 0) {
      return;
    }

    return new Promise((resolve) => {
      this.once('drain', resolve);
    });
  }

  /**
   * Clear all pending tasks
   */
  clear(): void {
    const clearedTasks = [...this.queue];
    this.queue = [];
    this.emit('clear', clearedTasks);
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    pending: number;
    active: number;
    total: number;
    concurrency: number;
    isPaused: boolean;
    isRunning: boolean;
  } {
    return {
      pending: this.queue.length,
      active: this.activeCount,
      total: this.queue.length + this.activeCount,
      concurrency: this.concurrency,
      isPaused: this.isPaused,
      isRunning: this.isRunning,
    };
  }

  /**
   * Get a specific task by ID
   */
  getTask(id: string): QueueTask<T> | undefined {
    return this.queue.find((task) => task.id === id);
  }

  /**
   * Remove a specific task by ID
   */
  removeTask(id: string): boolean {
    const index = this.queue.findIndex((task) => task.id === id);
    if (index !== -1) {
      this.queue.splice(index, 1);
      this.emit('task-removed', id);
      return true;
    }
    return false;
  }

  /**
   * Update concurrency limit
   */
  setConcurrency(concurrency: number): void {
    const oldConcurrency = this.concurrency;
    this.concurrency = concurrency;

    // If concurrency increased and we have pending tasks, process more
    if (
      concurrency > oldConcurrency &&
      this.queue.length > 0 &&
      !this.isPaused
    ) {
      const additionalTasks = concurrency - oldConcurrency;
      for (
        let i = 0;
        i < additionalTasks && this.activeCount < this.concurrency;
        i++
      ) {
        this.processNext();
      }
    }
  }
}
