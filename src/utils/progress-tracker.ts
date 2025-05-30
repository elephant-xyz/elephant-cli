import { EventEmitter } from 'events';
import * as cliProgress from 'cli-progress';
import chalk from 'chalk'; // For coloring the progress bar components

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
  DOWNLOADING = 'downloading', // Added new phase
  SUBMITTING = 'submitting',
  COMPLETED = 'completed',
  ERROR = 'error',
}

const phaseLabels: Record<ProcessingPhase, string> = {
  [ProcessingPhase.INITIALIZATION]: chalk.bold.cyan('🚀 Initializing'),
  [ProcessingPhase.SCANNING]: chalk.bold.blue('📁 Scanning'),
  [ProcessingPhase.VALIDATION]: chalk.bold.yellow('🔍 Validating'),
  [ProcessingPhase.PROCESSING]: chalk.bold.magenta('⚙️ Processing'),
  [ProcessingPhase.UPLOADING]: chalk.bold.cyan('☁️ Uploading'),
  [ProcessingPhase.DOWNLOADING]: chalk.bold.blue('⬇️ Downloading'),
  [ProcessingPhase.SUBMITTING]: chalk.bold.green('⛓️ Submitting'),
  [ProcessingPhase.COMPLETED]: chalk.bold.green('✅ Completed'),
  [ProcessingPhase.ERROR]: chalk.bold.red('❌ Error'),
};

export class ProgressTracker extends EventEmitter {
  private startTime: Date;
  private phaseStartTime: Date;
  private lastUpdateTime: Date;

  private metrics: ProgressMetrics;
  private updateInterval: NodeJS.Timeout | null = null;
  private progressBar: cliProgress.SingleBar | null = null;

  private history: {
    timestamp: number;
    processedFiles: number;
    uploadedFiles: number;
    validFiles: number;
  }[] = [];

  private readonly historySize = 60;
  private readonly updateFrequency: number;
  private readonly enableProgressBar: boolean;

  constructor(
    totalFiles: number,
    updateFrequency = 1000,
    enableProgressBar = true
  ) {
    super();

    this.startTime = new Date();
    this.phaseStartTime = new Date();
    this.lastUpdateTime = new Date();
    this.updateFrequency = updateFrequency;
    this.enableProgressBar = enableProgressBar;

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
      estimatedCompletion: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      currentPhase: ProcessingPhase.INITIALIZATION,
      phaseProgress: 0,
      validationQueueSize: 0,
      uploadQueueSize: 0,
      transactionQueueSize: 0,
      memoryUsage: 0,
      cpuUsage: 0,
    };
  }

  start(): void {
    this.startTime = new Date();
    this.phaseStartTime = new Date();
    this.lastUpdateTime = new Date();

    if (this.enableProgressBar && !this.progressBar && process.stdout.isTTY) {
      // Only show bar in TTY
      this.progressBar = new cliProgress.SingleBar(
        {
          format: `${chalk.cyan('{bar}')} {phaseLabel} {percentage}% | {value}/{total} files | ⚠️ {warningCount} | ❌ {errorCount} | ETA: {eta_formatted} | {speed} files/s`,
          barCompleteChar: '\u2588',
          barIncompleteChar: '\u2591',
          hideCursor: true,
          etaBuffer: 100,
        },
        cliProgress.Presets.shades_classic
      );
      this.progressBar.start(this.metrics.totalFiles, 0, {
        phaseLabel: phaseLabels[this.metrics.currentPhase],
        speed: 'N/A',
        warningCount: this.metrics.warningCount,
        errorCount: this.metrics.errorCount,
      });
    }

    this.updateInterval = setInterval(() => {
      this.update();
    }, this.updateFrequency);

    this.emit('start', this.getMetrics());
  }

  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.update();
    if (this.progressBar) {
      this.progressBar.stop();
      this.progressBar = null;
    }
    this.emit('stop', this.getMetrics());
  }

  private update(): void {
    const now = Date.now();
    const elapsedTime = now - this.startTime.getTime();
    this.metrics.elapsedTime = elapsedTime;

    this.history.push({
      timestamp: now,
      processedFiles: this.metrics.processedFiles,
      uploadedFiles: this.metrics.uploadedFiles,
      validFiles: this.metrics.validFiles,
    });
    if (this.history.length > this.historySize) {
      this.history.shift();
    }

    this.calculateRates();
    this.updateResourceUsage();
    this.calculateEstimates();

    if (this.progressBar) {
      this.progressBar.update(this.metrics.processedFiles, {
        phaseLabel: phaseLabels[this.metrics.currentPhase],
        speed: this.metrics.filesPerSecond.toFixed(1),
        warningCount: this.metrics.warningCount,
        errorCount: this.metrics.errorCount,
      });
    }

    this.emit('update', this.getMetrics());
    this.lastUpdateTime = new Date();
  }

  private calculateRates(): void {
    if (this.history.length < 2) {
      this.metrics.filesPerSecond = 0;
      this.metrics.uploadsPerSecond = 0;
      this.metrics.validationRate = 0;
      return;
    }

    const currentTime = Date.now();
    let sampleFromApprox5SecAgo = this.history.find(
      (s) => s.timestamp <= currentTime - 5000
    );
    if (!sampleFromApprox5SecAgo) {
      sampleFromApprox5SecAgo = this.history[0];
    }

    const currentSample = this.history[this.history.length - 1];
    const effectiveOldSample =
      currentSample.timestamp > sampleFromApprox5SecAgo.timestamp
        ? sampleFromApprox5SecAgo
        : this.history.length > 1
          ? this.history[0]
          : currentSample;
    const timeDiffSeconds =
      (currentSample.timestamp - effectiveOldSample.timestamp) / 1000;

    if (timeDiffSeconds > 0) {
      this.metrics.filesPerSecond =
        (currentSample.processedFiles - effectiveOldSample.processedFiles) /
        timeDiffSeconds;
      this.metrics.uploadsPerSecond =
        (currentSample.uploadedFiles - effectiveOldSample.uploadedFiles) /
        timeDiffSeconds;
      this.metrics.validationRate =
        (currentSample.validFiles - effectiveOldSample.validFiles) /
        timeDiffSeconds;
    } else {
      const elapsedTimeSeconds =
        (currentTime - this.startTime.getTime()) / 1000;
      if (elapsedTimeSeconds > 0) {
        this.metrics.filesPerSecond =
          this.metrics.processedFiles / elapsedTimeSeconds;
        this.metrics.uploadsPerSecond =
          this.metrics.uploadedFiles / elapsedTimeSeconds;
        this.metrics.validationRate =
          this.metrics.validFiles / elapsedTimeSeconds;
      } else {
        this.metrics.filesPerSecond = 0;
        this.metrics.uploadsPerSecond = 0;
        this.metrics.validationRate = 0;
      }
    }
  }

  private calculateEstimates(): void {
    const remainingFiles =
      this.metrics.totalFiles - this.metrics.processedFiles;
    if (this.metrics.filesPerSecond > 0 && remainingFiles > 0) {
      this.metrics.estimatedTimeRemaining =
        (remainingFiles / this.metrics.filesPerSecond) * 1000;
      this.metrics.estimatedCompletion = new Date(
        Date.now() + this.metrics.estimatedTimeRemaining
      );
    } else if (remainingFiles === 0 && this.metrics.totalFiles > 0) {
      this.metrics.estimatedTimeRemaining = 0;
      this.metrics.estimatedCompletion = new Date();
      if (this.metrics.currentPhase !== ProcessingPhase.COMPLETED) {
        // Do not call setPhase from here to avoid loops, let the command logic do it.
        // this.setPhase(ProcessingPhase.COMPLETED);
      }
    } else {
      this.metrics.estimatedTimeRemaining = Infinity;
      this.metrics.estimatedCompletion = new Date(
        Date.now() + 365 * 24 * 60 * 60 * 1000
      );
    }
  }

  private updateResourceUsage(): void {
    const used = process.memoryUsage();
    this.metrics.memoryUsage = Math.round(used.heapUsed / 1024 / 1024);
    this.metrics.cpuUsage = 0;
  }

  setPhase(phase: ProcessingPhase, progress = 0): void {
    if (this.metrics.currentPhase !== phase) {
      this.phaseStartTime = new Date();
      this.emit('phase-change', { from: this.metrics.currentPhase, to: phase });
    }
    this.metrics.currentPhase = phase;
    this.metrics.phaseProgress = Math.min(100, Math.max(0, progress));
    this.update();
  }

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

  updateQueues(validation: number, upload: number, transaction: number): void {
    this.metrics.validationQueueSize = validation;
    this.metrics.uploadQueueSize = upload;
    this.metrics.transactionQueueSize = transaction;
  }

  getMetrics(): Readonly<ProgressMetrics> {
    return { ...this.metrics };
  }

  formatTime(milliseconds: number): string {
    if (!isFinite(milliseconds) || milliseconds < 0) {
      return 'Unknown';
    }
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  getProgressPercentage(): number {
    if (this.metrics.totalFiles === 0) return 100;
    return Math.min(
      100,
      Math.round((this.metrics.processedFiles / this.metrics.totalFiles) * 100)
    );
  }

  getSummary(): string {
    const percentage = this.getProgressPercentage();
    const elapsed = this.formatTime(this.metrics.elapsedTime);
    const remaining = this.formatTime(this.metrics.estimatedTimeRemaining);
    const rate = this.metrics.filesPerSecond.toFixed(1);
    return `Progress: ${percentage}% (${this.metrics.processedFiles}/${this.metrics.totalFiles}) | Rate: ${rate} files/s | Elapsed: ${elapsed} | Remaining: ${remaining} | Errors: ${this.metrics.errorCount} | Warnings: ${this.metrics.warningCount}`;
  }

  reset(totalFiles: number): void {
    this.stop();
    this.startTime = new Date();
    this.phaseStartTime = new Date();
    this.lastUpdateTime = new Date();
    this.history = [];
    this.metrics = {
      ...this.metrics,
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
      estimatedTimeRemaining: Infinity,
      estimatedCompletion: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      currentPhase: ProcessingPhase.INITIALIZATION,
      phaseProgress: 0,
    };
    this.emit('reset', this.getMetrics());
  }
}
