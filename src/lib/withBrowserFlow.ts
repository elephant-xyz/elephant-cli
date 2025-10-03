import dot from 'dot';
import { logger } from '../utils/logger.js';
import { Prepared, ProxyOptions } from './types.js';
import { Frame, KeyInput, Page } from 'puppeteer';
import { cleanHtml, createBrowserPage } from './common.js';

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
  iframe_selector?: Selector;
}

interface ClickInput {
  selector: Selector;
  iframe_selector?: Selector;
}

interface TypeInput {
  selector: Selector;
  value: string;
  delay?: number;
  iframe_selector?: Selector;
  clear?: boolean;
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

type CaptureConfig = { type: 'page' } | { type: 'iframe'; selector: Selector };

export type Workflow = {
  starts_at: keyof States;
  states: States;
  capture?: CaptureConfig;
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
  const maxRetries = 3;
  const retryDelay = 500;

  for (const attempt of Array(maxRetries).keys()) {
    const attemptNumber = attempt + 1;

    if (attempt > 0) {
      logger.info(`Retry attempt ${attemptNumber} to get frame: ${selector}`);
      await new Promise((resolve) => setTimeout(resolve, retryDelay * attempt));
    }

    await page.waitForSelector(selector, { timeout });

    const frameElement = await page.$(selector);
    if (!frameElement) {
      if (attemptNumber === maxRetries) {
        throw new Error(
          `Frame element not found after ${maxRetries} attempts: ${selector}`
        );
      }
      continue;
    }

    const frame = await frameElement.contentFrame();
    if (!frame) {
      if (attemptNumber === maxRetries) {
        throw new Error(
          `Could not access frame content after ${maxRetries} attempts: ${selector}`
        );
      }
      continue;
    }

    return frame;
  }

  throw new Error(
    `Failed to get frame after ${maxRetries} attempts: ${selector}`
  );
}

export async function withBrowserFlow(
  workflow: Workflow,
  headless: boolean,
  requestId: string,
  proxy?: ProxyOptions,
  url?: string
): Promise<Prepared> {
  const startMs = Date.now();
  await using page = await createBrowserPage(headless, proxy);
  const executionState: ExecutionState = {
    request_identifier: requestId,
    ...(url && { url }),
  };
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
        const maxRetries = 3;
        const retryDelay = 1000;

        for (const attempt of Array(maxRetries).keys()) {
          const isLastAttempt = attempt === maxRetries - 1;
          const attemptNumber = attempt + 1;

          if (attempt > 0) {
            logger.info(
              `Retry attempt ${attemptNumber} for navigation to ${url}`
            );
            await new Promise((resolve) =>
              setTimeout(resolve, retryDelay * attempt)
            );
          }

          const navigationPromise = page
            .goto(url, {
              waitUntil: wait_until ?? 'domcontentloaded',
              timeout: timeout ?? 30000,
            })
            .catch((error) => {
              const isFrameDetached =
                error.message.includes('frame') &&
                (error.message.includes('detached') ||
                  error.message.includes('disposed'));

              if (isFrameDetached && !isLastAttempt) {
                logger.info(
                  `Frame detachment during navigation (attempt ${attemptNumber}), will retry`
                );
                return null;
              }

              throw error;
            });

          const response = await navigationPromise;

          if (response !== null) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            break;
          }

          if (isLastAttempt) {
            throw new Error(`Failed to navigate after ${maxRetries} attempts`);
          }
        }
        break;
      }
      case 'wait_for_selector': {
        const { selector, timeout, visible, iframe_selector } = input;
        if (iframe_selector) {
          const frame = await getFrameBySelector(page, iframe_selector);
          await frame.waitForSelector(selector, {
            visible,
            timeout,
          });
        }
        if (!iframe_selector) {
          await page.waitForSelector(selector, {
            visible,
            timeout,
          });
        }
        stepResult = selector;
        break;
      }
      case 'click': {
        const { selector, iframe_selector } = input;
        if (iframe_selector) {
          const frame = await getFrameBySelector(page, iframe_selector);
          await frame.click(selector);
        }
        if (!iframe_selector) {
          await page.click(selector);
        }
        break;
      }
      case 'type': {
        const { selector, value, delay, iframe_selector, clear } = input;
        if (iframe_selector) {
          const frame = await getFrameBySelector(page, iframe_selector);
          // Use JavaScript to set the value directly in frames
          await frame.evaluate(
            (sel, val) => {
              const element = document.querySelector(sel) as HTMLInputElement;
              if (element) {
                element.value = val;
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
              }
            },
            selector,
            value
          );
        } else {
          if (clear) {
            // Clear the field first using JavaScript
            await page.evaluate((sel) => {
              const element = document.querySelector(sel) as HTMLInputElement;
              if (element) {
                element.value = '';
              }
            }, selector);
          }
          await page.type(selector, value, { delay });
        }
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

  const capture = workflow.capture ?? { type: 'page' };
  let rawContent: string;
  if (capture.type === 'iframe') {
    const frame = await getFrameBySelector(page, capture.selector);
    rawContent = await frame.content();
  } else {
    rawContent = await page.content();
  }
  const content = await cleanHtml(rawContent);
  const result = {
    content,
    type: 'html' as const,
    finalUrl,
  };
  return result;
}
