import { EventEmitter } from 'events';

export interface ProgressMetrics {
  // Counts
  totalFiles: number;
  processedFiles: number;
  validFiles: number;
  invalidFiles: number;
  uploadedFiles: number;
  skippedFiles: number;
  errorCount: number;
  warningCount: number;
  
  // Rates (per second)
  filesPerSecond: number;
  uploadsPerSecond: number;
  validationRate: number;
  
  // Time estimates
  elapsedTime: number; // milliseconds
  estimatedTimeRemaining: number; // milliseconds
  estimatedCompletion: Date;
  
  // Current phase
  currentPhase: ProcessingPhase;
  phaseProgress: number; // 0-100
  
  // Queue metrics
  validationQueueSize: number;
  uploadQueueSize: number;
  transactionQueueSize: number;
  
  // Resource usage
  memoryUsage: number; // MB
  cpuUsage: number; // percentage
}

export enum ProcessingPhase {
  INITIALIZATION = 'initialization',
  SCANNING = 'scanning',
  VALIDATION = 'validation',
  PROCESSING = 'processing',
  UPLOADING = 'uploading',
  SUBMITTING = 'submitting',
  COMPLETED = 'completed',
  ERROR = 'error'
}

export class ProgressTracker extends EventEmitter {
  private startTime: Date;
  private phaseStartTime: Date;
  private lastUpdateTime: Date;
  
  private metrics: ProgressMetrics;
  private updateInterval: NodeJS.Timeout | null = null;
  
  // Historical data for rate calculation
  private history: {
    timestamp: number;
    processedFiles: number;
    uploadedFiles: number;
    validFiles: number;
  }[] = [];
  
  private readonly historySize = 60; // Keep last 60 samples
  private readonly updateFrequency: number; // milliseconds

  constructor(totalFiles: number, updateFrequency = 1000) {
    super();
    
    this.startTime = new Date();
    this.phaseStartTime = new Date();
    this.lastUpdateTime = new Date();
    this.updateFrequency = updateFrequency;
    
    this.metrics = {
      totalFiles,
      processedFiles: 0,
      validFiles: 0,
      invalidFiles: 0,
      uploadedFiles: 0,
      skippedFiles: 0,
      errorCount: 0,
      warningCount: 0,
      
      filesPerSecond: 0,
      uploadsPerSecond: 0,
      validationRate: 0,
      
      elapsedTime: 0,
      estimatedTimeRemaining: 0,
      estimatedCompletion: new Date(),
      
      currentPhase: ProcessingPhase.INITIALIZATION,
      phaseProgress: 0,
      
      validationQueueSize: 0,
      uploadQueueSize: 0,
      transactionQueueSize: 0,
      
      memoryUsage: 0,
      cpuUsage: 0
    };
  }

  /**
   * Start the progress tracker
   */
  start(): void {
    this.startTime = new Date();
    this.phaseStartTime = new Date();
    this.lastUpdateTime = new Date();
    
    // Start periodic updates
    this.updateInterval = setInterval(() => {
      this.update();
    }, this.updateFrequency);
    
    this.emit('start', this.getMetrics());
  }

  /**
   * Stop the progress tracker
   */
  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    this.update();
    this.emit('stop', this.getMetrics());
  }

  /**
   * Update progress metrics
   */
  private update(): void {
    const now = Date.now();
    const elapsedTime = now - this.startTime.getTime();
    
    // Update elapsed time
    this.metrics.elapsedTime = elapsedTime;
    
    // Add to history
    this.history.push({
      timestamp: now,
      processedFiles: this.metrics.processedFiles,
      uploadedFiles: this.metrics.uploadedFiles,
      validFiles: this.metrics.validFiles
    });
    
    // Keep history size limited
    if (this.history.length > this.historySize) {
      this.history.shift();
    }
    
    // Calculate rates
    this.calculateRates();
    
    // Update resource usage
    this.updateResourceUsage();
    
    // Calculate estimates
    this.calculateEstimates();
    
    // Emit update event
    this.emit('update', this.getMetrics());
    
    this.lastUpdateTime = new Date();
  }

  /**
   * Calculate processing rates
   */
  private calculateRates(): void {
    if (this.history.length < 2) {
      return;
    }
    
    // Get samples from 5 seconds ago (or oldest available)
    const targetTime = Date.now() - 5000;
    let oldSample = this.history[0];
    
    for (const sample of this.history) {
      if (sample.timestamp >= targetTime) {
        break;
      }
      oldSample = sample;
    }
    
    const currentSample = this.history[this.history.length - 1];
    const timeDiff = (currentSample.timestamp - oldSample.timestamp) / 1000; // seconds
    
    if (timeDiff > 0) {
      this.metrics.filesPerSecond = (currentSample.processedFiles - oldSample.processedFiles) / timeDiff;
      this.metrics.uploadsPerSecond = (currentSample.uploadedFiles - oldSample.uploadedFiles) / timeDiff;
      this.metrics.validationRate = (currentSample.validFiles - oldSample.validFiles) / timeDiff;
    }
  }

  /**
   * Calculate time estimates
   */
  private calculateEstimates(): void {
    const remainingFiles = this.metrics.totalFiles - this.metrics.processedFiles;
    
    if (this.metrics.filesPerSecond > 0 && remainingFiles > 0) {
      this.metrics.estimatedTimeRemaining = (remainingFiles / this.metrics.filesPerSecond) * 1000;
      this.metrics.estimatedCompletion = new Date(Date.now() + this.metrics.estimatedTimeRemaining);
    } else if (remainingFiles === 0) {
      this.metrics.estimatedTimeRemaining = 0;
      this.metrics.estimatedCompletion = new Date();
    } else {
      // Can't estimate
      this.metrics.estimatedTimeRemaining = Infinity;
      this.metrics.estimatedCompletion = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year
    }
  }

  /**
   * Update resource usage metrics
   */
  private updateResourceUsage(): void {
    const used = process.memoryUsage();
    this.metrics.memoryUsage = Math.round(used.heapUsed / 1024 / 1024); // MB
    
    // CPU usage would require more complex calculation
    // For now, set to 0 (can be implemented with additional dependencies)
    this.metrics.cpuUsage = 0;
  }

  /**
   * Set the current processing phase
   */
  setPhase(phase: ProcessingPhase, progress = 0): void {
    if (this.metrics.currentPhase !== phase) {
      this.phaseStartTime = new Date();
      this.emit('phase-change', { from: this.metrics.currentPhase, to: phase });
    }
    
    this.metrics.currentPhase = phase;
    this.metrics.phaseProgress = Math.min(100, Math.max(0, progress));
    
    this.update();
  }

  /**
   * Increment counters
   */
  incrementProcessed(count = 1): void {
    this.metrics.processedFiles += count;
  }

  incrementValid(count = 1): void {
    this.metrics.validFiles += count;
  }

  incrementInvalid(count = 1): void {
    this.metrics.invalidFiles += count;
  }

  incrementUploaded(count = 1): void {
    this.metrics.uploadedFiles += count;
  }

  incrementSkipped(count = 1): void {
    this.metrics.skippedFiles += count;
  }

  incrementErrors(count = 1): void {
    this.metrics.errorCount += count;
  }

  incrementWarnings(count = 1): void {
    this.metrics.warningCount += count;
  }

  /**
   * Update queue sizes
   */
  updateQueues(validation: number, upload: number, transaction: number): void {
    this.metrics.validationQueueSize = validation;
    this.metrics.uploadQueueSize = upload;
    this.metrics.transactionQueueSize = transaction;
  }

  /**
   * Get current metrics
   */
  getMetrics(): Readonly<ProgressMetrics> {
    return { ...this.metrics };
  }

  /**
   * Get formatted time string
   */
  formatTime(milliseconds: number): string {
    if (!isFinite(milliseconds)) {
      return 'Unknown';
    }
    
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Get progress percentage
   */
  getProgressPercentage(): number {
    if (this.metrics.totalFiles === 0) {
      return 100;
    }
    
    return Math.round((this.metrics.processedFiles / this.metrics.totalFiles) * 100);
  }

  /**
   * Get a summary string
   */
  getSummary(): string {
    const percentage = this.getProgressPercentage();
    const elapsed = this.formatTime(this.metrics.elapsedTime);
    const remaining = this.formatTime(this.metrics.estimatedTimeRemaining);
    const rate = this.metrics.filesPerSecond.toFixed(1);
    
    return `Progress: ${percentage}% (${this.metrics.processedFiles}/${this.metrics.totalFiles}) | ` +
           `Rate: ${rate} files/s | Elapsed: ${elapsed} | Remaining: ${remaining} | ` +
           `Errors: ${this.metrics.errorCount} | Warnings: ${this.metrics.warningCount}`;
  }

  /**
   * Reset the tracker
   */
  reset(totalFiles: number): void {
    this.stop();
    
    this.startTime = new Date();
    this.phaseStartTime = new Date();
    this.lastUpdateTime = new Date();
    this.history = [];
    
    this.metrics.totalFiles = totalFiles;
    this.metrics.processedFiles = 0;
    this.metrics.validFiles = 0;
    this.metrics.invalidFiles = 0;
    this.metrics.uploadedFiles = 0;
    this.metrics.skippedFiles = 0;
    this.metrics.errorCount = 0;
    this.metrics.warningCount = 0;
    this.metrics.filesPerSecond = 0;
    this.metrics.uploadsPerSecond = 0;
    this.metrics.validationRate = 0;
    this.metrics.currentPhase = ProcessingPhase.INITIALIZATION;
    this.metrics.phaseProgress = 0;
    
    this.emit('reset', this.getMetrics());
  }
}