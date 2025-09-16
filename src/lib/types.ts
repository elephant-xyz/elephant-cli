export type PrepareOptions = {
  clickContinue?: boolean;
  fast?: boolean;
  useBrowser?: boolean;
  headless?: boolean;
};

export type Prepared = { content: string; type: 'json' | 'html' };

export type Request = {
  url: string;
  method: 'GET' | 'POST';
  multiValueQueryString: Record<string, string[]>;
  headers?: Record<string, string>;
  json?: unknown;
  body?: string;
};
