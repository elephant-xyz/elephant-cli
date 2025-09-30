import dot from 'dot';
import { logger } from '../utils/logger.js';
import { createBrowser } from './common.js';
import { Prepared } from './types.js';
import { Frame, KeyInput, Page } from 'puppeteer';
import { cleanHtml } from './common.js';

type WaitUntil = 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';

type Selector = string;

interface OpenPageInput {
  url: string;
  timeout?: number;
  wait_until?: WaitUntil;
}

interface WaitForSelectorInput {
  selector: Selector;
  timeout?: number;
  visible?: boolean;
}

interface ClickInput {
  selector: Selector;
}

interface TypeInput {
  selector: Selector;
  value: string;
  delay?: number;
}

interface KeyboardPressInput {
  key: KeyInput;
}

type Node = {
  next?: string;
  result?: string;
  end?: boolean;
};

type OpenPageNode = {
  type: 'open_page';
  input: OpenPageInput;
} & Node;

type WaitForSelectorNode = {
  type: 'wait_for_selector';
  input: WaitForSelectorInput;
} & Node;
type ClickNode = {
  type: 'click';
  input: ClickInput;
} & Node;
type TypeNode = {
  type: 'type';
  input: TypeInput;
} & Node;
type KeyboardPressNode = {
  type: 'keyboard_press';
  input: KeyboardPressInput;
} & Node;

type StepNode =
  | OpenPageNode
  | WaitForSelectorNode
  | ClickNode
  | TypeNode
  | KeyboardPressNode;

type States = Record<string, StepNode>;

export type Workflow = {
  starts_at: keyof States;
  states: States;
};

type ExecutionState = {
  request_identifier: string;
  [key: string]: string | number | boolean;
};

async function getFrameBySelector(
  page: Page,
  selector: string,
  timeout: number = 5000
): Promise<Frame> {
  await page.waitForSelector(selector, { timeout });

  const frameElement = await page.$(selector);
  if (!frameElement) {
    throw new Error(`Frame element not found: ${selector}`);
  }

  const frame = await frameElement.contentFrame();
  if (!frame) {
    throw new Error(`Could not access frame content: ${selector}`);
  }

  return frame;
}

export async function withBrowserFlow(
  workflow: Workflow,
  headless: boolean,
  requestId: string
): Promise<Prepared> {
  const startMs = Date.now();
  const browser = await createBrowser(headless);
  try {
    const page = await browser.newPage();
    // await page.setRequestInterception(true);
    // page.on('request', (req) => {
    //   const type = req.resourceType();
    //   const blocked = ['image', 'stylesheet', 'font', 'media', 'websocket'];
    //   if (blocked.includes(type)) req.abort();
    //   else req.continue();
    // });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    await page.setUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      // Accept: 'text/html,application/xhtml+xml',
    });
    const executionState: ExecutionState = { request_identifier: requestId };
    let currentStep = workflow.starts_at;
    let end = false;
    while (!end) {
      const state = workflow.states[currentStep];
      const { type, input, next, result } = state;
      for (const [key, value] of Object.entries(input)) {
        if (typeof value === 'string' && value.includes('=it.')) {
          (input as Record<string, any>)[key] =
            dot.template(value)(executionState);
        }
      }
      logger.info(`Executing state ${currentStep}...`);
      let stepResult: string | number | boolean | undefined;
      switch (type) {
        case 'open_page': {
          const { url, timeout, wait_until } = input;
          await page.goto(url, {
            waitUntil: wait_until ?? 'networkidle2',
            timeout: timeout ?? 30000,
          });
          break;
        }
        case 'wait_for_selector': {
          const { selector, timeout, visible } = input;
          const frame = await getFrameBySelector(
            page,
            'iframe#recordSearchContent_1_iframe'
          );
          await frame.waitForSelector(selector, {
            visible,
            timeout,
          });
          stepResult = selector;
          break;
        }
        case 'click': {
          const { selector } = input;
          const frame = await getFrameBySelector(
            page,
            'iframe#recordSearchContent_1_iframe'
          );
          await frame.click(selector);
          break;
        }
        case 'type': {
          const { selector, value, delay } = input;
          const frame = await getFrameBySelector(
            page,
            'iframe#recordSearchContent_1_iframe'
          );
          await frame.type(selector, value, { delay });
          break;
        }
        case 'keyboard_press': {
          const { key } = input;
          await page.keyboard.press(key);
          break;
        }
        default:
          throw new Error(`Unknown type: ${type}`);
      }
      if (result && stepResult) {
        executionState[result] = stepResult;
      }
      if (result && !stepResult) {
        throw new Error(`Missing result at step ${currentStep}`);
      }
      if (next) {
        currentStep = next;
      }
      end = state.end ?? false;
    }
    const elapsedMs = Date.now() - startMs;
    logger.info(`Captured page HTML in ${elapsedMs}ms`);

    // Capture the final URL after navigation
    const finalUrl = page.url();
    logger.info(`Final URL after browser flow: ${finalUrl}`);

    const frame = await getFrameBySelector(
      page,
      'iframe#recordSearchContent_1_iframe'
    );
    const result = {
      content: await cleanHtml(await frame.content()),
      type: 'html' as const,
      finalUrl,
    };
    return result;
  } finally {
    await browser.close();
  }
}
