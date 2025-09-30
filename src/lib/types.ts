export type PrepareOptions = {
  clickContinue?: boolean;
  continueButtonSelector?: string;
  fast?: boolean;
  useBrowser?: boolean;
  headless?: boolean;
  errorPatterns?: string[];
  browserFlowTemplate?: string;
  browserFlowParameters?: string;
  ignoreCaptcha?: boolean;
};

export type Prepared = {
  content: string;
  type: 'json' | 'html';
  finalUrl?: string; // The final URL after browser navigation
};

export type Request = {
  url: string;
  method: 'GET' | 'POST';
  multiValueQueryString: Record<string, string[]>;
  headers?: Record<string, string>;
  json?: unknown;
  body?: string;
};
