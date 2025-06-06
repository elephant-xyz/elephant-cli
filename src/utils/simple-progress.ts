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

  constructor(
    initialPhaseTotal: number,
    initialPhaseName: string = 'Initializing'
  ) {
    this.metrics = {
      processed: 0,
      total: initialPhaseTotal,
      errors: 0,
      warnings: 0,
      skipped: 0,
      phase: initialPhaseName,
      startTime: Date.now(),
    };

    this.bar = new cliProgress.SingleBar({
      format:
        '{phase} |' +
        chalk.cyan('{bar}') +
        '| {percentage}% | {processed}/{total} | Errors: {errors} | Skipped: {skipped} | {duration}s | ETA: {eta_formatted}',
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

  setPhase(phase: string, phaseTotal: number): void {
    this.metrics.phase = phase;
    this.metrics.total = phaseTotal;
    this.metrics.processed = 0;
    this.metrics.startTime = Date.now();

    if (this.isRunning) {
      this.bar.setTotal(phaseTotal);
      this.bar.update(this.metrics.processed, this.getPayload());
    }
  }

  increment(
    type: 'processed' | 'errors' | 'warnings' | 'skipped' = 'processed'
  ): void {
    this.metrics[type]++;
    if (type !== 'processed') {
      this.metrics.processed++;
    }
    this.update();
  }

  increase(
    type: 'processed' | 'errors' | 'warnings' | 'skipped' = 'processed',
    amount: number = 1
  ): void {
    this.metrics[type] += amount;
    if (type !== 'processed') {
      this.metrics.processed += amount;
    }
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
