import { ErrorEntry } from '../types/submit.types.js';

const TYPE_ERROR_PATTERN = /^must be (null|object|array)$/;

// Schema mismatch errors that indicate address doesn't match either oneOf option
const isSchemaMatchError = (msg: string) =>
  msg === 'must match a schema in anyOf' ||
  msg === 'must match exactly one schema in oneOf';

// Check if error path is related to address entity (not property)
const isAddressPath = (path: string) =>
  path.includes('property_has_address') && path.includes('/to');

/** Render a validation error's offending value for the CSV `currentValue` column. */
export function formatCurrentValue(data: unknown): string {
  if (data === undefined) {
    return '';
  }
  if (data === null) {
    return 'null';
  }
  if (typeof data === 'object') {
    return JSON.stringify(data);
  }
  return String(data);
}

/**
 * The error filter every `validate` path applies before deciding pass/fail:
 * drop bare type and anyOf/oneOf mismatch rows, consolidate address rows on
 * files whose address entity failed its oneOf into one row, then dedupe by
 * message + last path segment.
 * Apply per property so a ZIP and a CAR holding the same property agree.
 */
export function filterErrorRows(entries: ErrorEntry[]): ErrorEntry[] {
  const rows: ErrorEntry[] = [];
  const addressSchemaErrorFiles = new Set<string>();

  for (const row of entries) {
    // Filter out anyOf/oneOf type errors
    if (TYPE_ERROR_PATTERN.test(row.errorMessage)) {
      continue;
    }

    // Track files with address schema errors (anyOf/oneOf on the address entity)
    // Only consolidate when the address itself fails the schema validation
    if (isAddressPath(row.errorPath) && isSchemaMatchError(row.errorMessage)) {
      addressSchemaErrorFiles.add(row.filePath);
    }

    // Filter out generic anyOf/oneOf schema matching errors (not useful to users)
    if (isSchemaMatchError(row.errorMessage)) {
      continue;
    }

    rows.push(row);
  }

  // Consolidate address-related errors only for files where the address entity itself
  // failed the oneOf/anyOf validation (not property errors)
  const addressConsolidatedRows: ErrorEntry[] = [];
  const nonAddressRows: ErrorEntry[] = [];

  for (const row of rows) {
    // Only consolidate errors on the address entity, not property errors
    if (
      addressSchemaErrorFiles.has(row.filePath) &&
      isAddressPath(row.errorPath)
    ) {
      // Check if we already have a consolidated error for this file
      const hasConsolidated = addressConsolidatedRows.some(
        (r) => r.filePath === row.filePath
      );
      if (!hasConsolidated) {
        addressConsolidatedRows.push({
          ...row,
          errorPath: '/relationships/property_has_address',
          errorMessage:
            'Address should provide either unnormalized_address or normalized version distributed to other fields',
        });
      }
    } else {
      nonAddressRows.push(row);
    }
  }

  const filteredRows = [...nonAddressRows, ...addressConsolidatedRows];

  // Deduplicate by errorMessage + lastPathSegment
  const dedupeMap = new Map<string, ErrorEntry>();

  for (const row of filteredRows) {
    const pathParts = row.errorPath.split('/').filter((p) => p !== '');
    const lastSegment =
      pathParts.length > 0 ? pathParts[pathParts.length - 1] : 'root';
    const key = `${row.errorMessage}::${lastSegment}`;

    if (!dedupeMap.has(key)) {
      dedupeMap.set(key, row);
    }
  }

  return Array.from(dedupeMap.values());
}
