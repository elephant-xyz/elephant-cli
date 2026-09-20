/** True when `input` names a CAR file (case-insensitive `.car` extension). */
export function isCarInput(input: string): boolean {
  return input.toLowerCase().endsWith('.car');
}
