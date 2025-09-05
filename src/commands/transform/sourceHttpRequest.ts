export type SourceHttpRequest = {
  url: string;
  method: string;
  multiValueQueryString?: Record<string, string[]>;
  json?: Record<string, any> | Record<string, any>[];
  body?: string;
  headers?: Record<string, string>;
};

export function parseMultiValueQueryString(
  queryString: string
): Record<string, string[]> {
  try {
    return JSON.parse(queryString);
  } catch (e) {
    const replaced = queryString
      .replace(/\\'/g, '__SQUOTE__') // protect \' inside strings
      .replace(/'/g, '"') // replace remaining single quotes
      .replace(/__SQUOTE__/g, "'"); // restore \' as real single quote
    return JSON.parse(replaced);
  }
}
