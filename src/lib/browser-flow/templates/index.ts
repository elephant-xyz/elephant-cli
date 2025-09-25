import { BrowserFlowTemplate } from '../types.js';
import { SEARCH_BY_PARCEL_ID } from './search-by-parcel-id.js';

export const TEMPLATES: Record<string, BrowserFlowTemplate> = {
  SEARCH_BY_PARCEL_ID,
};

export function getTemplate(id: string): BrowserFlowTemplate | undefined {
  return TEMPLATES[id];
}

export function listTemplates(): string[] {
  return Object.keys(TEMPLATES);
}
