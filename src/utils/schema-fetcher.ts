import chalk from 'chalk';
import { CID } from 'multiformats/cid';
import { equals as u8eq } from 'uint8arrays/equals';
import { sha256, sha512 } from 'multiformats/hashes/sha2';
import { Hasher } from 'multiformats/hashes/hasher';
import { logger } from '../utils/logger.js';

type SchemaType = 'class' | 'relationship' | 'dataGroup';

type SchemaMeta = {
  type: SchemaType;
  ipfsCid: string;
};

const HASHERS: Record<number, Hasher<'sha2-256', 18> | Hasher<'sha2-512', 19>> =
  {
    [sha256.code]: sha256,
    [sha512.code]: sha512,
  };

export async function fetchSchemaManifest(): Promise<
  Record<string, SchemaMeta>
> {
  const schemasManifestResponse = await fetch(
    'https://lexicon.elephant.xyz/json-schemas/schema-manifest.json'
  );
  if (!schemasManifestResponse.ok) {
    console.error(
      chalk.red(
        `Failed to fetch schemas manifest: ${schemasManifestResponse.statusText}`
      )
    );
    throw new Error(
      `Failed to fetch schemas manifest: ${schemasManifestResponse.statusText}`
    );
  }

  const schemasManifest: Record<string, SchemaMeta> =
    await schemasManifestResponse.json();
  return schemasManifest;
}

export async function fetchSchemas(
  schemaType: SchemaType = 'class'
): Promise<Record<string, string>> {
  const schemasManifest = await fetchSchemaManifest();
  const entries = await Promise.all(
    Object.entries(schemasManifest)
      .filter(([_, schemaMeta]) => schemaMeta.type === schemaType)
      .map(async ([schemaName, schemaMeta]) => {
        const schema = await fetchFromIpfs(schemaMeta.ipfsCid);
        const schemaParsed = JSON.parse(schema);
        if (Object.hasOwn(schemaParsed, 'allOf')) {
          delete schemaParsed.allOf;
        }
        if (Object.hasOwn(schemaParsed, 'properties')) {
          const properties = schemaParsed.properties;
          if (Object.hasOwn(properties, 'source_http_request')) {
            delete properties.source_http_request;
          }
          if (Object.hasOwn(properties, 'request_identifier')) {
            delete properties.request_identifier;
          }
          if (!Array.isArray(schemaParsed.required)) {
            throw new Error(
              `Schema ${schemaName} has invalid required field: ${properties.required}. Should be an array.`
            );
          }
          schemaParsed.required = schemaParsed.required?.filter(
            (prop: string) =>
              prop !== 'source_http_request' && prop !== 'request_identifier'
          );
          schemaParsed.properties = properties;
        }
        return [schemaName, JSON.stringify(schemaParsed)];
      })
  );
  return Object.fromEntries(entries);
}

export async function fetchFromIpfs(cid: string): Promise<string> {
  const ipfsGateways: string[] = [
    'https://ipfs.io',
    'https://gateway.ipfs.io',
    'https://dweb.link',
    'https://w3s.link',
  ];
  for (const gateway of ipfsGateways) {
    try {
      const response = await fetch(`${gateway}/ipfs/${cid}`);
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        const content = new Uint8Array(buffer);
        const responseText = new TextDecoder().decode(content);
        if (!(await verifyFetchedContent(cid, content))) {
          throw new Error(
            `CID ${cid} content does not match expected hash. Content: ${responseText.substring(0, 500)}${responseText.length > 500 ? '...' : ''}`
          );
        }
        return responseText;
      }
    } catch (e) {
      logger.error(
        `Failed to fetch from ${gateway}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  throw new Error(`Failed to fetch from any IPFS gateway: ${cid}`);
}

async function verifyFetchedContent(
  cidStr: string,
  content: Uint8Array
): Promise<boolean> {
  const cid = CID.parse(cidStr);

  const hasher = HASHERS[cid.multihash.code];
  if (!hasher) throw new Error(`Unsupported hasher code ${cid.multihash.code}`);

  const mh = await hasher.digest(content);
  return u8eq(mh.bytes, cid.multihash.bytes);
}
