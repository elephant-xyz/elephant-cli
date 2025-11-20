import { promises as fs } from 'fs';
import path from 'path';

const EXCLUDE_SUBSTRINGS = [
  'has_file',
  'file_has',
  'has_fact_sheet',
  'fact_sheet_has',
];

interface IPLDLink {
  '/': string;
}

interface JsonObject {
  [key: string]: unknown;
}

function cleanObject(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => cleanObject(item));
  }

  const result: JsonObject = {};

  for (const [key, value] of Object.entries(obj)) {
    if (key === 'source_http_request' || key === 'request_identifier') {
      continue;
    }

    const cleanedValue = cleanObject(value);

    if (cleanedValue === null || cleanedValue === undefined) {
      continue;
    }

    if (typeof cleanedValue === 'string' && cleanedValue === '') {
      continue;
    }

    result[key] = cleanedValue;
  }

  return result;
}

function parseRelationshipLabel(relName: string): { from: string; to: string } {
  const tokens = relName.toLowerCase().split('_');

  if (tokens.includes('has')) {
    const idx = tokens.indexOf('has');
    const left = tokens.slice(0, idx).join('_') || 'unknown_from';
    const right = tokens.slice(idx + 1).join('_') || 'unknown_to';
    return { from: left, to: right };
  }

  if (tokens.includes('of')) {
    const idx = tokens.indexOf('of');
    const left = tokens.slice(idx + 1).join('_') || 'unknown_from';
    const right = tokens.slice(0, idx).join('_') || 'unknown_to';
    return { from: left, to: right };
  }

  return { from: 'unknown_from', to: 'unknown_to' };
}

export class TransformDataAggregatorService {
  async aggregateTransformOutput(
    transformOutputDir: string,
    swapDirection = false
  ): Promise<Record<string, Record<string, JsonObject[]>>> {
    const files = await fs.readdir(transformOutputDir, { withFileTypes: true });
    const jsonFiles = files
      .filter((f) => f.isFile() && f.name.endsWith('.json'))
      .map((f) => f.name);

    const datagroupRootFiles = await this.findDatagroupRootFiles(
      transformOutputDir,
      jsonFiles
    );

    const result: Record<string, Record<string, JsonObject[]>> = {};

    for (const { label, relationships } of datagroupRootFiles) {
      const classes: Record<string, JsonObject[]> = {};
      const cidToLabel = new Map<string, string>();
      const seen = new Set<string>();

      for (const [relName, relLinks] of Object.entries(relationships)) {
        const lowered = relName.toLowerCase();

        if (EXCLUDE_SUBSTRINGS.some((sub) => lowered.includes(sub))) {
          continue;
        }

        const { from: leftLabel, to: rightLabel } =
          parseRelationshipLabel(relName);

        const linkArray = Array.isArray(relLinks) ? relLinks : [relLinks];

        for (const link of linkArray) {
          const relRef = (link as IPLDLink)['/'];
          if (typeof relRef !== 'string') continue;

          const relFileName = relRef.replace('./', '').replace(/^\//, '');
          const relPath = path.join(transformOutputDir, relFileName);

          let relData: JsonObject | JsonObject[];

          try {
            const relContent = await fs.readFile(relPath, 'utf-8');
            relData = JSON.parse(relContent);
          } catch {
            continue;
          }

          const relationships = Array.isArray(relData) ? relData : [relData];

          for (const rel of relationships) {
            const from = rel.from as IPLDLink | undefined;
            const to = rel.to as IPLDLink | undefined;

            if (!from || !to) continue;

            const fromRef = from['/'];
            const toRef = to['/'];

            if (typeof fromRef !== 'string' || typeof toRef !== 'string')
              continue;

            const fromFileName = fromRef.replace('./', '').replace(/^\//, '');
            const toFileName = toRef.replace('./', '').replace(/^\//, '');

            const fromPath = path.join(transformOutputDir, fromFileName);
            const toPath = path.join(transformOutputDir, toFileName);

            let fromObj: JsonObject = {};
            let toObj: JsonObject = {};

            try {
              const fromContent = await fs.readFile(fromPath, 'utf-8');
              fromObj = JSON.parse(fromContent);
            } catch {
              // Ignore if file doesn't exist
            }

            try {
              const toContent = await fs.readFile(toPath, 'utf-8');
              toObj = JSON.parse(toContent);
            } catch {
              // Ignore if file doesn't exist
            }

            const fromClean = cleanObject(fromObj) as JsonObject;
            const toClean = cleanObject(toObj) as JsonObject;

            if (swapDirection) {
              this.addObject(
                classes,
                cidToLabel,
                seen,
                fromFileName,
                rightLabel,
                fromClean
              );
              this.addObject(
                classes,
                cidToLabel,
                seen,
                toFileName,
                leftLabel,
                toClean
              );
            } else {
              this.addObject(
                classes,
                cidToLabel,
                seen,
                fromFileName,
                leftLabel,
                fromClean
              );
              this.addObject(
                classes,
                cidToLabel,
                seen,
                toFileName,
                rightLabel,
                toClean
              );
            }
          }
        }
      }

      result[label] = classes;
    }

    return result;
  }

  private async findDatagroupRootFiles(
    transformOutputDir: string,
    jsonFiles: string[]
  ): Promise<
    Array<{
      filename: string;
      label: string;
      relationships: Record<string, unknown>;
    }>
  > {
    const datagroupRoots: Array<{
      filename: string;
      label: string;
      relationships: Record<string, unknown>;
    }> = [];

    for (const filename of jsonFiles) {
      if (!filename.startsWith('bafkrei')) continue;

      const filePath = path.join(transformOutputDir, filename);
      let content: JsonObject;

      try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        content = JSON.parse(fileContent);
      } catch {
        continue;
      }

      const keys = Object.keys(content);
      if (
        keys.length === 2 &&
        keys.includes('label') &&
        keys.includes('relationships')
      ) {
        const label = content.label;
        const relationships = content.relationships;

        if (
          typeof label === 'string' &&
          typeof relationships === 'object' &&
          relationships !== null
        ) {
          datagroupRoots.push({
            filename,
            label,
            relationships: relationships as Record<string, unknown>,
          });
        }
      }
    }

    return datagroupRoots;
  }

  private addObject(
    classes: Record<string, JsonObject[]>,
    cidToLabel: Map<string, string>,
    seen: Set<string>,
    cid: string,
    label: string,
    obj: JsonObject
  ): void {
    if (seen.has(cid)) return;

    seen.add(cid);

    if (!cidToLabel.has(cid)) {
      cidToLabel.set(cid, label);
    }

    const finalLabel = cidToLabel.get(cid)!;

    if (!classes[finalLabel]) {
      classes[finalLabel] = [];
    }

    classes[finalLabel].push(obj);
  }

  jsonToText(obj: unknown): string[] {
    const sentences: string[] = [];

    if (typeof obj !== 'object' || obj === null) {
      return sentences;
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        sentences.push(...this.jsonToText(item));
      }
      return sentences;
    }

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && value.trim().length > 2) {
        const keyContext = key.replace(/_/g, ' ');
        sentences.push(`${keyContext}: ${value}`);
      } else if (typeof value === 'number') {
        const keyContext = key.replace(/_/g, ' ');
        sentences.push(`${keyContext}: ${value}`);
      } else if (typeof value === 'object') {
        sentences.push(...this.jsonToText(value));
      }
    }

    return sentences;
  }

  convertAggregatedDataToText(
    aggregatedData: Record<string, Record<string, JsonObject[]>>
  ): string {
    const parts = this.jsonToText(aggregatedData);
    return parts.join('. ').replace(/\.\./g, '.').replace(/\s+/g, ' ').trim();
  }
}
