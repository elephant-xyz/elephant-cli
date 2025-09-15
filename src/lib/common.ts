import { Request } from './types.js';

export function constructUrl(req: Request) {
  const url = new URL(req.url);
  const query = new URLSearchParams();
  for (const [key, values] of Object.entries(req.multiValueQueryString)) {
    for (const value of values) query.append(key, value);
  }
  url.search = query.toString();
  return url.toString();
}
