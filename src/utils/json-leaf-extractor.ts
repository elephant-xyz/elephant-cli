export function extractLeafValues(obj: unknown): string[] {
  const leaves: string[] = [];

  function traverse(value: unknown): void {
    if (value === null || value === undefined) {
      return;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        leaves.push(trimmed);
      }
      return;
    }

    if (typeof value === 'number') {
      leaves.push(String(value));
      return;
    }

    if (typeof value === 'boolean') {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        traverse(item);
      }
      return;
    }

    if (typeof value === 'object') {
      for (const v of Object.values(value)) {
        traverse(v);
      }
    }
  }

  traverse(obj);
  return leaves;
}
