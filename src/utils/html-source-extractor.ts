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

  // Recursively process all text nodes
  function processNode(node: AnyNode) {
    if (node.type === 'text') {
      const textNode = node as Text;
      const text = textNode.data.trim();

      if (text.length > 2) {
        const parent = textNode.parent;
        if (parent && parent.type === 'tag') {
          const parentElement = parent as Element;
          const selector = generateCssSelector(parentElement, $);

          sourceMap.push({
            text,
            source: selector,
            lineIndex,
          });
          lineIndex++;
        }
      }
    } else if (node.type === 'tag') {
      const element = node as Element;
      const children = element.children || [];
      children.forEach((child: AnyNode) => processNode(child));
    }
  }

  // Start from body, or root if no body
  const body = $('body')[0];
  if (body && body.type === 'tag') {
    const children = (body as Element).children || [];
    children.forEach((child: AnyNode) => processNode(child));
  } else {
    const root = $.root()[0];
    if (root) {
      const children = (root as any).children || [];
      children.forEach((child: AnyNode) => processNode(child));
    }
  }

  // Format text with newlines
  const formattedText = sourceMap.map((item) => item.text).join('\n');

  return {
    formattedText,
    sourceMap,
  };
}
