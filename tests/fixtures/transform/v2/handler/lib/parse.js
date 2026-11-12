// Local helper bundled in the package; no npm dependencies are available to v2 handlers.
export function textById(html, id) {
  const match = html.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`));
  return match ? match[1].trim() : null;
}
