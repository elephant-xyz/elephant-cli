import * as cheerio from 'cheerio';
import type { Element, AnyNode, Text } from 'domhandler';

export interface TextWithSource {
  text: string;
  source: string;
  lineIndex: number;
}

function generateCssSelector(element: Element, $: cheerio.CheerioAPI): string {
  // If element has an ID, use it (most specific)
  if (element.attribs?.id) {
    return `#${element.attribs.id}`;
  }

  // If element has data attributes, prefer them
  const dataAttrs = Object.keys(element.attribs || {}).filter((attr) =>
    attr.startsWith('data-')
  );
  if (dataAttrs.length > 0) {
    const dataAttr = dataAttrs[0];
    const value = element.attribs[dataAttr];
    return `${element.name}[${dataAttr}="${value}"]`;
  }

  // Build path from root
  const path: string[] = [];
  let current = element;

  while (current && current.type === 'tag') {
    let selector = current.name;

    // Add class if available
    if (current.attribs?.class) {
      const classes = current.attribs.class.trim().split(/\s+/);
      selector += `.${classes[0]}`;
    }

    // Add nth-child if there are siblings with same tag
    const parent = current.parent;
    if (parent && parent.type === 'tag') {
      const siblings = $(parent).children(current.name);
      if (siblings.length > 1) {
        const index = siblings.toArray().indexOf(current) + 1;
        selector += `:nth-child(${index})`;
      }
    }

    path.unshift(selector);
    current = current.parent as Element;

    // Stop at body or after 5 levels to keep selectors manageable
    if (current?.name === 'body' || path.length >= 5) {
      break;
    }
  }

  return path.join(' > ');
}

function extractTextFromElement(element: Element): string {
  const texts: string[] = [];

  function collectText(node: AnyNode) {
    if (node.type === 'text') {
      const text = (node as Text).data.trim();
      if (text.length > 0) {
        texts.push(text);
      }
    } else if (node.type === 'tag') {
      const children = (node as Element).children || [];
      children.forEach((child: AnyNode) => collectText(child));
    }
  }

  collectText(element);
  return texts.join(' ').replace(/\s+/g, ' ').trim();
}

export function extractTextWithSources(html: string): {
  formattedText: string;
  sourceMap: TextWithSource[];
} {
  const $ = cheerio.load(html, {
    xmlMode: false,
  });

  const sourceMap: TextWithSource[] = [];
  let lineIndex = 0;

  // Remove script, style, and noscript tags
  $('script, style, noscript').remove();

  // Find all elements with text content
  function processElement(element: Element) {
    const text = extractTextFromElement(element);

    if (text.length > 2) {
      const selector = generateCssSelector(element, $);
      sourceMap.push({
        text,
        source: selector,
        lineIndex,
      });
      lineIndex++;
    }

    // Only process children if this element didn't have direct text
    const hasDirectText = $(element)
      .contents()
      .toArray()
      .some(
        (node) => node.type === 'text' && (node as Text).data.trim().length > 0
      );

    if (!hasDirectText) {
      $(element)
        .children()
        .each((_, child) => {
          if (child.type === 'tag') {
            processElement(child as Element);
          }
        });
    }
  }

  // Start from body, or root if no body
  const body = $('body')[0];
  if (body && body.type === 'tag') {
    $(body)
      .children()
      .each((_, child) => {
        if (child.type === 'tag') {
          processElement(child as Element);
        }
      });
  } else {
    $.root()
      .children()
      .each((_, child) => {
        if (child.type === 'tag') {
          processElement(child as Element);
        }
      });
  }

  // Format text with newlines
  const formattedText = sourceMap.map((item) => item.text).join('\n');

  return {
    formattedText,
    sourceMap,
  };
}
