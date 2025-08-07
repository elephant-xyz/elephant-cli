import { promises as fsPromises } from 'fs';
import path from 'path';
import { SchemaCacheService } from './schema-cache.service.js';
import { JsonValidatorService } from './json-validator.service.js';
import { CsvReporterService } from './csv-reporter.service.js';
import { SimpleProgress } from '../utils/simple-progress.js';
import { logger } from '../utils/logger.js';
import { isValidDataGroupSchema } from '../utils/datagroup-schema.js';
import { FileEntry, ProcessedFile } from '../types/submit.types.js';
import { IPLDConverterService } from './ipld-converter.service.js';
import { JsonCanonicalizerService } from './json-canonicalizer.service.cjs';
import { IPLDCanonicalizerService } from './ipld-canonicalizer.service.js';
import { CidCalculatorService } from './cid-calculator.service.js';
import { PinataService } from './pinata.service.js';
import { SEED_DATAGROUP_SCHEMA_CID } from '../config/constants.js';

export interface ValidationServices {
  schemaCacheService: SchemaCacheService;
  jsonValidatorService: JsonValidatorService;
  csvReporterService: CsvReporterService;
  progressTracker: SimpleProgress;
}

export interface UploadPrepServices {
  ipldConverterService: IPLDConverterService;
  jsonCanonicalizerService: JsonCanonicalizerService | IPLDCanonicalizerService;
  cidCalculatorService: CidCalculatorService;
}

export async function readJsonOrReport(
  fileEntry: FileEntry,
  csvReporterService: CsvReporterService,
  progressTracker: SimpleProgress
): Promise<any | null> {
  try {
    const fileContentStr = await fsPromises.readFile(
      fileEntry.filePath,
      'utf-8'
    );
    return JSON.parse(fileContentStr);
  } catch (readOrParseError) {
    const errorMsg =
      readOrParseError instanceof Error
        ? readOrParseError.message
        : String(readOrParseError);
    await csvReporterService.logError({
      propertyCid: fileEntry.propertyCid,
      dataGroupCid: fileEntry.dataGroupCid,
      filePath: fileEntry.filePath,
      errorPath: 'root',
      errorMessage: `File read/parse error: ${errorMsg}`,
      timestamp: new Date().toISOString(),
    });
    progressTracker.increment('errors');
    return null;
  }
}

export async function validateFileEntry(
  fileEntry: FileEntry,
  services: ValidationServices,
  allowFileRefs: boolean
): Promise<{ ok: true; data: any; schema: any } | { ok: false }> {
  const jsonData = await readJsonOrReport(
    fileEntry,
    services.csvReporterService,
    services.progressTracker
  );
  if (jsonData === null) return { ok: false };

  try {
    const schemaCid = fileEntry.dataGroupCid;
    const schema = await services.schemaCacheService.getSchema(schemaCid);
    if (!schema) {
      const error = `Could not load schema ${schemaCid} for ${fileEntry.filePath}`;
      await services.csvReporterService.logError({
        propertyCid: fileEntry.propertyCid,
        dataGroupCid: fileEntry.dataGroupCid,
        filePath: fileEntry.filePath,
        errorPath: 'root',
        errorMessage: error,
        timestamp: new Date().toISOString(),
      });
      services.progressTracker.increment('errors');
      return { ok: false };
    }

    const schemaValidation = isValidDataGroupSchema(schema);
    if (!schemaValidation.valid) {
      const error = `Schema CID ${schemaCid} is not a valid data group schema. Data group schemas must describe an object with exactly two properties: "label" and "relationships". For valid data group schemas, please visit https://lexicon.elephant.xyz`;
      await services.csvReporterService.logError({
        propertyCid: fileEntry.propertyCid,
        dataGroupCid: fileEntry.dataGroupCid,
        filePath: fileEntry.filePath,
        errorPath: 'root',
        errorMessage: error,
        timestamp: new Date().toISOString(),
      });
      services.progressTracker.increment('errors');
      return { ok: false };
    }

    const validationResult = await services.jsonValidatorService.validate(
      jsonData,
      schema,
      fileEntry.filePath,
      !allowFileRefs ? true : false
    );

    if (!validationResult.valid) {
      const errorMessages: Array<{ path: string; message: string }> =
        services.jsonValidatorService.getErrorMessages(
          validationResult.errors || []
        );

      for (const errorInfo of errorMessages) {
        await services.csvReporterService.logError({
          propertyCid: fileEntry.propertyCid,
          dataGroupCid: fileEntry.dataGroupCid,
          filePath: fileEntry.filePath,
          errorPath: errorInfo.path,
          errorMessage: errorInfo.message,
          timestamp: new Date().toISOString(),
        });
      }
      services.progressTracker.increment('errors');
      return { ok: false };
    }

    return { ok: true, data: jsonData, schema };
  } catch (processingError) {
    const errorMsg =
      processingError instanceof Error
        ? processingError.message
        : String(processingError);
    await services.csvReporterService.logError({
      propertyCid: fileEntry.propertyCid,
      dataGroupCid: fileEntry.dataGroupCid,
      filePath: fileEntry.filePath,
      errorPath: 'root',
      errorMessage: `Processing error: ${errorMsg}`,
      timestamp: new Date().toISOString(),
    });
    services.progressTracker.increment('errors');
    return { ok: false };
  }
}

export async function prepareUpload(
  fileEntry: FileEntry,
  validatedData: any,
  schema: any,
  services: UploadPrepServices
): Promise<{ processedFile: ProcessedFile; finalPropertyCid: string } | null> {
  let dataToUpload = validatedData;

  try {
    if (services.ipldConverterService?.hasIPLDLinks(validatedData, schema)) {
      logger.debug(
        `Data has IPLD links, running IPLD converter for ${fileEntry.filePath}`
      );
      const conversionResult =
        await services.ipldConverterService.convertToIPLD(
          validatedData,
          fileEntry.filePath,
          schema
        );
      dataToUpload = conversionResult.convertedData;
    }
  } catch (conversionError) {
    const errorMsg =
      conversionError instanceof Error
        ? conversionError.message
        : String(conversionError);
    logger.error(
      `Failed to convert IPLD links for ${fileEntry.filePath}: ${errorMsg}`
    );
  }

  const canonicalJson =
    services.jsonCanonicalizerService.canonicalize(dataToUpload);

  const calculatedCid =
    await services.cidCalculatorService.calculateCidFromCanonicalJson(
      canonicalJson,
      dataToUpload
    );

  const isSeedFile = fileEntry.dataGroupCid === SEED_DATAGROUP_SCHEMA_CID;
  const finalPropertyCid = isSeedFile ? calculatedCid : fileEntry.propertyCid;

  const processedFile: ProcessedFile = {
    propertyCid: fileEntry.propertyCid,
    dataGroupCid: fileEntry.dataGroupCid,
    filePath: fileEntry.filePath,
    canonicalJson,
    calculatedCid,
    validationPassed: true,
  };

  return { processedFile, finalPropertyCid };
}

export async function performUpload(
  processedFile: ProcessedFile,
  pinataService: PinataService
): Promise<{ success: boolean; ipfsCid?: string; error?: string }> {
  // Provide a compatible shape for tests that expect a 'path' field
  const results = await pinataService.uploadBatch([
    {
      ...(processedFile as any),
      path: (processedFile as any).path || processedFile.filePath,
    },
  ] as any);
  const first = results[0];
  if (first && first.success && first.cid) {
    return { success: true, ipfsCid: first.cid };
  }
  return {
    success: false,
    error: first
      ? first.error || 'Unknown upload error'
      : 'Unknown upload error',
  };
}

export async function processSeedExplicit(
  fileEntry: FileEntry,
  validationServices: ValidationServices,
  uploadServices?: UploadPrepServices,
  pinataService?: PinataService,
  allowFileRefs: boolean = true
): Promise<{ success: boolean; seedCid?: string }> {
  const result = await validateFileEntry(
    fileEntry,
    validationServices,
    allowFileRefs
  );
  if (!result.ok) return { success: false };

  if (!uploadServices) {
    return { success: true };
  }

  const prepared = await prepareUpload(
    fileEntry,
    result.data,
    result.schema,
    uploadServices
  );
  if (!prepared) return { success: false };

  if (!pinataService)
    return { success: true, seedCid: prepared.processedFile.calculatedCid };

  const upload = await performUpload(prepared.processedFile, pinataService);
  if (!upload.success) return { success: false };

  return { success: true, seedCid: upload.ipfsCid };
}
