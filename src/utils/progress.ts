import ora, { Ora } from 'ora';

/**
 * Creates and starts a new ora spinner with the given text.
 * @param text The spinner text to display.
 * @returns The ora spinner instance.
 */
export function createSpinner(text: string): Ora {
  const spinner = ora({ text }).start();
  return spinner;
}
