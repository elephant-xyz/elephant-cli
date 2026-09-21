import { promises as fsPromises } from 'fs';
import path from 'path';

/** True when `input` names a CAR file (case-insensitive `.car` extension). */
export function isCarInput(input: string): boolean {
  return input.toLowerCase().endsWith('.car');
}

/** True when `input` is a directory holding a `tables.car` written by `export-tables`. */
export async function isTablesInput(input: string): Promise<boolean> {
  const [dir, car] = await Promise.all(
    [input, path.join(input, 'tables.car')].map((item) =>
      fsPromises.stat(item).catch(() => undefined)
    )
  );
  return (dir?.isDirectory() && car?.isFile()) ?? false;
}
