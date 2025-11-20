import { JSDOM } from 'jsdom';
import { createHash } from 'crypto';

const VOLATILE_ATTRS = new Set([
  'style',
  'tabindex',
  'contenteditable',
  'aria-selected',
  'aria-expanded',
  'aria-hidden',
  'aria-controls',
  'aria-labelledby',
  'aria-label',
  'role',
  'onclick',
  'onmouseover',
  'onmouseout',
  'onchange',
  'oninput',
  'onfocus',
  'onblur',
  'onkeydown',
  'onkeyup',
  'onkeypress',
]);

const CONTAINER_TAGS = new Set([
  'DIV',
  'NAV',
  'HEADER',
  'FOOTER',
  'SECTION',
  'ASIDE',
  'MAIN',
  'ARTICLE',
  'UL',
  'OL',
]);

export class StaticPartsIdentifierService {
  private sha1(str: string): string {
    return createHash('sha1').update(str).digest('hex');
  }

  private cssEscape(str: string): string {
    return str.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
  }

  private stripComments(node: Document | Element): void {
    const doc = (node as Element).ownerDocument || (node as Document);
    const win = doc.defaultView;
    if (!win) return;

    const root = doc.documentElement || (node as Element);
    const walker = doc.createTreeWalker(root, win.NodeFilter.SHOW_COMMENT);

    const comments: Node[] = [];
    while (walker.nextNode()) {
      comments.push(walker.currentNode);
    }

    comments.forEach((c) => {
      if (c.parentNode) {
        c.parentNode.removeChild(c);
      }
    });
  }

  private removeScriptsAndStyles(dom: JSDOM): void {
    const elements = dom.window.document.querySelectorAll(
      "script, style, link[rel='stylesheet']"
    );
    elements.forEach((el: Element) => el.remove());
  }

  private canonicalizeElement(el: Element): string {
    const clone = el.cloneNode(true) as Element;

    this.stripComments(clone);

    if (clone.querySelectorAll) {
      const toRemove = clone.querySelectorAll(
        "script, style, link[rel='stylesheet']"
      );
      toRemove.forEach((n) => n.remove());
    }

    const all = [
      clone,
      ...(clone.querySelectorAll
        ? Array.from(clone.querySelectorAll('*'))
        : []),
    ];

    for (const node of all) {
      if (!node.attributes) continue;

      for (const attr of Array.from(node.attributes)) {
        const name = attr.name.toLowerCase();
        if (VOLATILE_ATTRS.has(name) || name.startsWith('data-')) {
          node.removeAttribute(attr.name);
        }
      }

      if (node.attributes.length > 1) {
        const attrs = Array.from(node.attributes).map((a) => [a.name, a.value]);
        attrs.sort((a, b) => a[0].localeCompare(b[0]));

        for (const a of Array.from(node.attributes)) {
          node.removeAttribute(a.name);
        }

        for (const [name, value] of attrs) {
          try {
            node.setAttribute(name, value);
          } catch {
            // Skip invalid attribute names
          }
        }
      }

      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3) {
          if (child.nodeValue) {
            child.nodeValue = child.nodeValue.replace(/\s+/g, ' ').trim();
          }
        }
      }
    }

    return (clone.outerHTML || '')
      .replace(/\s+>/g, '>')
      .replace(/>\s+</g, '><')
      .trim();
  }

  private isCandidate(el: Element): boolean {
    const win = el.ownerDocument.defaultView;
    if (!win) return false;

    if (!(el instanceof win.HTMLElement)) return false;

    const tag = el.tagName;
    const hasId = !!el.getAttribute('id');

    if (tag === 'TABLE') return false;

    if (!CONTAINER_TAGS.has(tag) && !hasId) return false;

    const closestTable = el.closest('table');
    if (closestTable) return false;

    const textLen = (el.textContent || '').replace(/\s+/g, ' ').trim().length;
    const childCount = el.children ? el.children.length : 0;

    if (!hasId && textLen < 10 && childCount < 1) return false;

    return true;
  }

  private buildRobustSelector(el: Element): string {
    const doc = el.ownerDocument;

    const id = el.getAttribute('id');
    if (id) {
      const hits = doc.querySelectorAll(`#${this.cssEscape(id)}`);
      if (hits.length === 1) return `#${this.cssEscape(id)}`;
    }

    const parts: string[] = [];
    let node: Element | null = el;

    while (node && node.nodeType === 1 && node !== doc.documentElement) {
      let part = node.tagName.toLowerCase();

      if (node.classList && node.classList.length > 0) {
        const picked = Array.from(node.classList).find((c) =>
          /^[a-zA-Z_-][\w-]{1,20}$/.test(c)
        );
        if (picked) part += `.${this.cssEscape(picked)}`;
      }

      const parent = node.parentElement;
      if (parent) {
        const sameTagSiblings = Array.from(parent.children).filter(
          (ch) => ch.tagName === node!.tagName
        );
        if (sameTagSiblings.length > 1) {
          const index = sameTagSiblings.indexOf(node) + 1;
          part += `:nth-of-type(${index})`;
        }
      }

      parts.unshift(part);

      if (node.getAttribute && node.getAttribute('id')) break;

      node = node.parentElement;
    }

    const sel = parts.join(' > ');
    const hits = doc.querySelectorAll(sel);
    if (hits.length === 1) return sel;

    const bodyPath: string[] = [];
    node = el;

    while (
      node &&
      node.nodeType === 1 &&
      node !== doc.body &&
      node !== doc.documentElement
    ) {
      let piece = node.tagName.toLowerCase();
      const parent = node.parentElement;

      if (parent) {
        const same = Array.from(parent.children).filter(
          (ch) => ch.tagName === node!.tagName
        );
        const idx = same.indexOf(node) + 1;
        piece += `:nth-of-type(${idx})`;
      }

      bodyPath.unshift(piece);
      node = node.parentElement;
    }

    return 'body > ' + bodyPath.join(' > ');
  }

  private selectorsAreNested(a: string, b: string): boolean {
    if (a === b) return true;
    if (b.startsWith(a + ' >')) return true;
    return false;
  }

  private minimizeSelectors(selectors: string[]): string[] {
    const out: string[] = [];

    for (let i = 0; i < selectors.length; i++) {
      const s = selectors[i];
      let covered = false;

      for (let j = 0; j < selectors.length; j++) {
        if (i === j) continue;
        if (this.selectorsAreNested(selectors[j], s)) {
          covered = true;
          break;
        }
      }

      if (!covered) out.push(s);
    }

    return Array.from(new Set(out));
  }

  async identifyStaticParts(htmlContents: string[]): Promise<string[]> {
    if (htmlContents.length < 2) {
      throw new Error(
        'At least 2 HTML files are required to identify static parts'
      );
    }

    const doms: JSDOM[] = [];
    const perFileHashToNodes: Map<string, Element>[] = [];

    for (const html of htmlContents) {
      const dom = new JSDOM(html);
      const { document } = dom.window;

      this.removeScriptsAndStyles(dom);
      this.stripComments(document);

      doms.push(dom);

      const hashToNode = new Map<string, Element>();

      const allEls = Array.from(document.querySelectorAll('*')).filter(
        (el): el is Element => this.isCandidate(el as Element)
      );

      for (const el of allEls) {
        const canon = this.canonicalizeElement(el);
        if (!canon) continue;

        const h = this.sha1(canon);
        if (!hashToNode.has(h)) {
          hashToNode.set(h, el);
        }
      }

      perFileHashToNodes.push(hashToNode);
    }

    const hashCounts = new Map<string, number>();
    for (const map of perFileHashToNodes) {
      for (const h of map.keys()) {
        hashCounts.set(h, (hashCounts.get(h) || 0) + 1);
      }
    }

    const repeatedHashes = Array.from(hashCounts.entries())
      .filter(([, count]) => count === htmlContents.length)
      .map(([h]) => h);

    const candidateSelectors: string[] = [];

    for (const h of repeatedHashes) {
      const firstNode = perFileHashToNodes[0].get(h);
      if (!firstNode) continue;

      const selector = this.buildRobustSelector(firstNode);
      if (!selector) continue;

      const canon0 = this.canonicalizeElement(firstNode);
      let ok = true;

      for (let i = 0; i < doms.length; i++) {
        const doc = doms[i].window.document;
        const hits = doc.querySelectorAll(selector);

        if (hits.length !== 1) {
          ok = false;
          break;
        }

        const c = this.canonicalizeElement(hits[0]);
        if (c !== canon0) {
          ok = false;
          break;
        }
      }

      if (ok) candidateSelectors.push(selector);
    }

    return this.minimizeSelectors(candidateSelectors);
  }
}
