import dot from 'dot';
import { logger } from '../utils/logger.js';
import { Prepared, ProxyOptions } from './types.js';
import { Frame, KeyInput, Page, TimeoutError } from 'puppeteer';
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

interface SelectorRaceOption {
  selector: Selector;
  label: string;
  timeout?: number;
}

interface WaitForSelectorRaceInput {
  selectors: SelectorRaceOption[];
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
  next_on_timeout?: string;
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
  continue_on_timeout?: boolean;
} & Node;
type WaitForSelectorRaceNode = {
  type: 'wait_for_selector_race';
  input: WaitForSelectorRaceInput;
  next_map: Record<string, string>;
  validate_winner?: Record<
    string,
    { check_selector: string; if_exists_goto: string }
  >;
} & Omit<Node, 'next'>;
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
  | WaitForSelectorRaceNode
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
    const { type, input, result } = state;
    const next = 'next' in state ? state.next : undefined;
    const next_on_timeout =
      'next_on_timeout' in state ? state.next_on_timeout : undefined;
    const next_map = 'next_map' in state ? state.next_map : undefined;
    const validate_winner =
      'validate_winner' in state ? state.validate_winner : undefined;
    const continueOnTimeout =
      'continue_on_timeout' in state ? state.continue_on_timeout : false;
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

        // Use networkidle2 for domcontentloaded to avoid frame detachment issues
        // networkidle2 waits for network to settle AFTER all frame replacements
        const effectiveWaitUntil =
          wait_until === 'domcontentloaded' ? 'networkidle2' : wait_until;

        logger.info(
          `Navigating to ${url} (waitUntil: ${effectiveWaitUntil ?? 'networkidle2'})...`
        );

        try {
          await page.goto(url, {
            waitUntil: effectiveWaitUntil ?? 'networkidle2',
            timeout: timeout ?? 30000,
          });
          logger.info('Navigation successful');
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);

          // Frame detachment during navigation is EXPECTED for sites that aggressively replace DOM
          if (
            errorMsg.toLowerCase().includes('frame') &&
            errorMsg.toLowerCase().includes('detach')
          ) {
            logger.info(
              'Frame detached during navigation (expected) - waiting for page to stabilize...'
            );
            // Give extra time for the new frame to fully load
            await new Promise((resolve) => setTimeout(resolve, 5000));
          } else {
            throw e;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
        break;
      }
      case 'wait_for_selector': {
        const { selector, timeout, visible, iframe_selector } = input;
        const waitPromise = iframe_selector
          ? getFrameBySelector(page, iframe_selector).then((frame) =>
              frame.waitForSelector(selector, {
                visible,
                timeout,
              })
            )
          : page.waitForSelector(selector, {
              visible,
              timeout,
            });

        let timedOut = false;
        const waitResult = await waitPromise.catch((error) => {
          if (continueOnTimeout && error instanceof TimeoutError) {
            logger.info(
              `Selector ${selector} timeout, continuing to fallback path`
            );
            timedOut = true;
            return null;
          }
          throw error;
        });

        if (waitResult !== null) {
          stepResult = selector;
        }

        if (timedOut) {
          stepResult = '__timeout__';
        }
        break;
      }
      case 'wait_for_selector_race': {
        const { selectors, visible, iframe_selector } = input;
        const targetFrame = iframe_selector
          ? await getFrameBySelector(page, iframe_selector)
          : page;

        const racePromises = selectors.map(async (option) => {
          const waitPromise = targetFrame.waitForSelector(option.selector, {
            visible,
            timeout: option.timeout ?? 30000,
          });
          return waitPromise.then(() => option.label);
        });

        stepResult = await Promise.race(racePromises).catch((error) => {
          throw error;
        });

        logger.info(`Selector race won by: ${stepResult}`);

        if (
          validate_winner &&
          typeof stepResult === 'string' &&
          validate_winner[stepResult]
        ) {
          const validation = validate_winner[stepResult];
          const elementExists = await targetFrame.$(validation.check_selector);
          if (elementExists) {
            logger.info(
              `Winner '${stepResult}' validation: found ${validation.check_selector}, redirecting to ${validation.if_exists_goto}`
            );
            stepResult = `__validate_redirect__:${validation.if_exists_goto}`;
          }
        }
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
    if (result && stepResult && stepResult !== '__timeout__') {
      executionState[result] = stepResult;
    }
    if (result && !stepResult && !continueOnTimeout) {
      throw new Error(`Missing result at step ${currentStep}`);
    }

    const isTimeout = stepResult === '__timeout__';
    const isValidateRedirect =
      typeof stepResult === 'string' &&
      stepResult.startsWith('__validate_redirect__:');

    if (isValidateRedirect && typeof stepResult === 'string') {
      const redirectTarget = stepResult.split(':')[1];
      currentStep = redirectTarget;
    } else if (isTimeout && continueOnTimeout) {
      if (!next_on_timeout) {
        throw new Error(
          `Step ${currentStep} timed out with continue_on_timeout, but no next_on_timeout is defined`
        );
      }
      currentStep = next_on_timeout;
    } else if (next_map && typeof stepResult === 'string') {
      const nextStep = next_map[stepResult];
      if (!nextStep) {
        throw new Error(
          `Step ${currentStep} result '${stepResult}' not found in next_map`
        );
      }
      currentStep = nextStep;
    } else if (next) {
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
