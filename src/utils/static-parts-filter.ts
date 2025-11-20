import { promises as fs } from 'fs';
import { JSDOM } from 'jsdom';

export async function parseStaticPartsCsv(csvPath: string): Promise<string[]> {
  const content = await fs.readFile(csvPath, 'utf-8');
  const lines = content.split('\n').filter((line) => line.trim());

  if (lines.length === 0) {
    return [];
  }

  // Skip header line (cssSelector)
  const selectors = lines
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      // Remove quotes if present
      if (line.startsWith('"') && line.endsWith('"')) {
        return line.slice(1, -1);
      }
      return line;
    });

  return selectors;
}

export function removeStaticParts(html: string, selectors: string[]): string {
  if (selectors.length === 0) {
    return html;
  }

  const dom = new JSDOM(html);
  const { document } = dom.window;

  for (const selector of selectors) {
    try {
      const elements = document.querySelectorAll(selector);
      elements.forEach((el) => {
        if (el.parentNode) {
          el.parentNode.removeChild(el);
        }
      });
    } catch (error) {
      // Skip invalid selectors
      console.warn(`Warning: Invalid CSS selector skipped: ${selector}`);
    }
  }

  return dom.serialize();
}
