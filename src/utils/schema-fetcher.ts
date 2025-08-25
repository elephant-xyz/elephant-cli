import chalk from 'chalk';

type SchemaType = 'class' | 'relationship' | 'dataGroup';

type SchemaMeta = {
  type: SchemaType;
  ipfsCid: string;
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
        return await response.text();
      }
    } catch (e) {
      console.error(`Failed to fetch from ${gateway}: ${e}`);
    }
  }

  throw new Error(`Failed to fetch from any IPFS gateway: ${cid}`);
}
