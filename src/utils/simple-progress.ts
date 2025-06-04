import chalk from 'chalk';
import cliProgress from 'cli-progress';

export interface SimpleProgressMetrics {
  processed: number;
  total: number;
  errors: number;
  warnings: number;
  skipped: number;
  phase: string;
  startTime: number;
}

export class SimpleProgress {
  private bar: cliProgress.SingleBar;
  private metrics: SimpleProgressMetrics;
  private isRunning: boolean = false;

  constructor(total: number) {
    this.metrics = {
      processed: 0,
      total,
      errors: 0,
      warnings: 0,
      skipped: 0,
      phase: 'Initializing',
      startTime: Date.now(),
    };

    this.bar = new cliProgress.SingleBar({
      format: '{phase} |' + chalk.cyan('{bar}') + '| {percentage}% | {processed}/{total} | Errors: {errors} | Skipped: {skipped} | {duration}s | ETA: {eta_formatted}',
      barCompleteChar: '█',
      barIncompleteChar: '░',
      hideCursor: true,
    });
  }

  start(): void {
    if (!this.isRunning) {
      this.bar.start(this.metrics.total, 0, this.getPayload());
      this.isRunning = true;
    }
  }

  stop(): void {
    if (this.isRunning) {
      this.bar.stop();
      this.isRunning = false;
    }
  }

  setPhase(phase: string): void {
    this.metrics.phase = phase;
    this.update();
  }

  increment(type: 'processed' | 'errors' | 'warnings' | 'skipped' = 'processed'): void {
    this.metrics[type]++;
    if (type !== 'processed') {
      this.metrics.processed++;
    }
    this.update();
  }

  updateTotal(total: number): void {
    this.metrics.total = total;
    this.bar.setTotal(total);
    this.update();
  }

  private update(): void {
    if (this.isRunning) {
      this.bar.update(this.metrics.processed, this.getPayload());
    }
  }

  private getPayload(): any {
    const elapsed = Date.now() - this.metrics.startTime;
    const duration = this.formatDuration(elapsed);
    
    return {
      phase: this.metrics.phase.padEnd(15),
      processed: this.metrics.processed,
      total: this.metrics.total,
      errors: this.metrics.errors,
      warnings: this.metrics.warnings,
      skipped: this.metrics.skipped,
      duration,
    };
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  getMetrics(): SimpleProgressMetrics {
    return { ...this.metrics };
  }
}