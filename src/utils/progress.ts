import ora from 'ora';

export function createSpinner(text: string) {
  return ora({ text, isEnabled: false }).start();
}
