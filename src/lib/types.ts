type Ipv4Address = `${number}.${number}.${number}.${number}`;
type Username = string;
type Password = string;
export type ProxyUrl = `${Username}:${Password}@${Ipv4Address}:${number}`;

export type ProxyOptions = {
  username: string;
  password: string;
  ip: string;
  port: number;
};

export type PrepareOptions = {
  clickContinue?: boolean;
  continueButtonSelector?: string;
  useBrowser?: boolean;
  headless?: boolean;
  errorPatterns?: string[];
  browserFlowTemplate?: string;
  browserFlowParameters?: string;
  browserFlowFile?: string;
  ignoreCaptcha?: boolean;
  proxy?: ProxyUrl;
  multiRequestFlowFile?: string;
  inputCsv?: string;
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
