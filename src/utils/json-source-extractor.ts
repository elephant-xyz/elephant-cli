export interface TextWithSource {
  text: string;
  source: string;
  lineIndex: number;
}

function jsonPathToText(key: string): string {
  return key.replace(/_/g, ' ');
}

export function extractTextWithSources(
  obj: unknown,
  parentPath = '$'
): {
  formattedText: string;
  sourceMap: TextWithSource[];
} {
  const sourceMap: TextWithSource[] = [];
  let lineIndex = 0;

  function traverse(value: unknown, path: string) {
    if (typeof value !== 'object' || value === null) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        traverse(item, `${path}[${index}]`);
      });
      return;
    }

    for (const [key, val] of Object.entries(value)) {
      const currentPath = `${path}.${key}`;

      if (typeof val === 'string' && val.trim().length > 2) {
        const keyContext = jsonPathToText(key);
        const text = `${keyContext}: ${val}`;
        sourceMap.push({
          text,
          source: currentPath,
          lineIndex,
        });
        lineIndex++;
      } else if (typeof val === 'number') {
        const keyContext = jsonPathToText(key);
        const text = `${keyContext}: ${val}`;
        sourceMap.push({
          text,
          source: currentPath,
          lineIndex,
        });
        lineIndex++;
      } else if (typeof val === 'object') {
        traverse(val, currentPath);
      }
    }
  }

  traverse(obj, parentPath);

  const formattedText = sourceMap.map((item) => item.text).join('\n');

  return {
    formattedText,
    sourceMap,
  };
}
