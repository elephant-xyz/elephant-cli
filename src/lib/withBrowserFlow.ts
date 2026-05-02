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

interface CaptureHtmlInput {
  name: string;
  target?: CaptureConfig;
}

interface CaptureSourceUrlInput {
  target?: CaptureConfig;
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
type CaptureHtmlNode = {
  type: 'capture_html';
  input: CaptureHtmlInput;
  next?: string;
  end?: boolean;
};
type CaptureSourceUrlNode = {
  type: 'capture_source_url';
  input: CaptureSourceUrlInput;
  next?: string;
  end?: boolean;
};

type StepNode =
  | OpenPageNode
  | WaitForSelectorNode
  | WaitForSelectorRaceNode
  | ClickNode
  | TypeNode
  | KeyboardPressNode
  | CaptureHtmlNode
  | CaptureSourceUrlNode;

type States = Record<string, StepNode>;

type CaptureConfig = { type: 'page' } | { type: 'iframe'; selector: Selector };

export type Workflow = {
  version?: 1 | 2;
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
  const explicitCaptureStates = Object.values(workflow.states).filter(
    (state) => state.type === 'capture_html'
  );
  const sourceUrlStates = Object.values(workflow.states).filter(
    (state) => state.type === 'capture_source_url'
  );
  const captures: NonNullable<Prepared['captures']> = [];
  let capturedSourceUrl: string | undefined;
  let currentStep = workflow.starts_at;
  let end = false;
  while (!end) {
    const state = workflow.states[currentStep];
    try {
      const { type, input } = state;
      const result = 'result' in state ? state.result : undefined;
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
              throw new Error(
                `Failed to navigate after ${maxRetries} attempts`
              );
            }
          }
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
            const elementExists = await targetFrame.$(
              validation.check_selector
            );
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
        case 'capture_html': {
          const { name, target } = input;
          const capture = target ?? { type: 'page' };
          const rawContent = await captureHtml(page, capture);
          captures.push({
            name,
            content: await cleanHtml(rawContent),
            type: 'html',
          });
          logger.info(`Captured HTML: ${name}`);
          break;
        }
        case 'capture_source_url': {
          const { target } = input;
          capturedSourceUrl = await captureSourceUrl(
            page,
            target ?? { type: 'page' }
          );
          if (!/^https?:\/\//i.test(capturedSourceUrl)) {
            throw new Error(
              `Captured source URL is not HTTP(S): ${capturedSourceUrl}`
            );
          }
          logger.info(`Captured source URL: ${capturedSourceUrl}`);
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
    } catch (error) {
      logStateError(currentStep, error);
      throw new Error(formatStateError(currentStep, state, error), {
        cause: error,
      });
    }
  }
  const elapsedMs = Date.now() - startMs;
  logger.info(`Captured page HTML in ${elapsedMs}ms`);

  // Capture the final URL after navigation
  if (explicitCaptureStates.length > 0 && captures.length === 0) {
    throw new Error(
      'Browser flow completed without executing any capture_html states'
    );
  }
  if (sourceUrlStates.length > 0 && !capturedSourceUrl) {
    throw new Error(
      'Browser flow completed without executing capture_source_url'
    );
  }
  const finalUrl = capturedSourceUrl ?? page.url();
  logger.info(`Final URL after browser flow: ${finalUrl}`);

  if (captures.length > 0) {
    return {
      content: captures[0].content,
      type: 'html' as const,
      finalUrl,
      captures,
      captureMode: 'explicit',
    };
  }

  const capture = workflow.capture ?? { type: 'page' };
  const rawContent = await captureHtml(page, capture);
  const content = await cleanHtml(rawContent);
  const result = {
    content,
    type: 'html' as const,
    finalUrl,
    captureMode: 'default' as const,
    captures: [{ name: 'default', content, type: 'html' as const }],
  };
  return result;
}

function logStateError(stateName: string, error: unknown): void {
  if (error instanceof Error && error.stack) {
    logger.error(
      `Browser flow state "${stateName}" threw an error:\n${error.stack}`
    );
    return;
  }
  logger.error(
    `Browser flow state "${stateName}" threw an error: ${String(error)}`
  );
}

function formatStateError(
  stateName: string,
  state: StepNode,
  error: unknown
): string {
  const message = error instanceof Error ? error.message : String(error);
  switch (state.type) {
    case 'open_page':
      return `State "${stateName}" could not open page "${state.input.url}": ${message}`;
    case 'wait_for_selector':
      return state.input.iframe_selector
        ? `State "${stateName}" could not find selector "${state.input.selector}" in iframe "${state.input.iframe_selector}": ${message}`
        : `State "${stateName}" could not find selector "${state.input.selector}": ${message}`;
    case 'wait_for_selector_race':
      return `State "${stateName}" could not resolve selector race among ${state.input.selectors
        .map((selector) => `${selector.label} "${selector.selector}"`)
        .join(', ')}: ${message}`;
    case 'click':
      return state.input.iframe_selector
        ? `State "${stateName}" could not click selector "${state.input.selector}" in iframe "${state.input.iframe_selector}": ${message}`
        : `State "${stateName}" could not click selector "${state.input.selector}": ${message}`;
    case 'type':
      return state.input.iframe_selector
        ? `State "${stateName}" could not type into selector "${state.input.selector}" in iframe "${state.input.iframe_selector}": ${message}`
        : `State "${stateName}" could not type into selector "${state.input.selector}": ${message}`;
    case 'keyboard_press':
      return `State "${stateName}" could not press key "${state.input.key}": ${message}`;
    case 'capture_html': {
      const target = state.input.target ?? { type: 'page' };
      return target.type === 'iframe'
        ? `State "${stateName}" could not capture iframe HTML for "${state.input.name}" from "${target.selector}": ${message}`
        : `State "${stateName}" could not capture page HTML for "${state.input.name}": ${message}`;
    }
    case 'capture_source_url': {
      const target = state.input.target ?? { type: 'page' };
      return target.type === 'iframe'
        ? `State "${stateName}" could not capture iframe source URL from "${target.selector}": ${message}`
        : `State "${stateName}" could not capture page source URL: ${message}`;
    }
  }
}

async function captureHtml(
  page: Page,
  capture: CaptureConfig
): Promise<string> {
  if (capture.type === 'iframe') {
    const frame = await getFrameBySelector(page, capture.selector);
    return await frame.content();
  }
  return await page.content();
}

async function captureSourceUrl(
  page: Page,
  capture: CaptureConfig
): Promise<string> {
  if (capture.type === 'iframe') {
    const frame = await getFrameBySelector(page, capture.selector);
    return frame.url();
  }
  return page.url();
}
