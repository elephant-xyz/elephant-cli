# Mirror Validate Command

## Overview

The `mirror-validate` command validates the entity extraction completeness between raw data (from the `prepare` command) and transformed data (from the `transform` command). It uses Named Entity Recognition (NER) models to extract entities and compares them using various similarity metrics.

## Table of Contents

- [Usage](#usage)
- [Architecture](#architecture)
- [Entity Types](#entity-types)
- [Comparison Metrics](#comparison-metrics)
- [Examples](#examples)
- [Integration with Workflow](#integration-with-workflow)

## Usage

### Basic Usage

```bash
npx elephant-cli mirror-validate \
  --prepare-zip path/to/prepare-output.zip \
  --transform-zip path/to/transform-output.zip
```

### With JSON Output

```bash
npx elephant-cli mirror-validate \
  --prepare-zip path/to/prepare-output.zip \
  --transform-zip path/to/transform-output.zip \
  --output completeness-report.json
```

### Options

| Option | Required | Description |
|--------|----------|-------------|
| `--prepare-zip` | Yes | Path to the output zip from the `prepare` command |
| `--transform-zip` | Yes | Path to the output zip from the `transform` command |
| `--output` | No | Path to save detailed JSON report |

## Architecture

The command is built on three core services:

### 1. NER Entity Extractor Service

**File:** `src/services/ner-entity-extractor.service.ts`

**Responsibilities:**
- Loads and initializes local NER models (Money/Date and Person/Org/Location)
- Extracts entities from text using BERT-based models
- Aggregates entities using BIO (Begin-Inside-Outside) tagging
- Normalizes entities:
  - **Dates**: Converts to MM/DD/YYYY format using dayjs
  - **Money**: Removes currency symbols, validates numbers
  - **Organizations/Locations**: Converts to lowercase
- Handles long texts via chunking (MAX_CHARS = 1000)
- Removes duplicates and substring entities

**Key Methods:**
- `initialize()`: Loads NER models from local cache
- `extractEntities(text)`: Returns `ExtractedEntities` object

### 2. Entity Comparison Service

**File:** `src/services/entity-comparison.service.ts`

**Responsibilities:**
- Compares entities between raw and transformed data
- Calculates similarity and coverage metrics
- Uses different algorithms per entity type

**Comparison Algorithms:**

#### Money Entities
- **Cosine Similarity**: Log-histogram distribution comparison
- **Coverage**: Exact number matching with tolerance (default 0.01)

#### Date Entities
- **Cosine Similarity**: Feature vector (year, month sin/cos, day sin/cos)
- **Coverage**: Exact date matching with day tolerance (default 0)

#### Organization/Location Entities
- **Cosine Similarity**: Bag-of-tokens comparison
- **Coverage**: Jaro-Winkler fuzzy matching (threshold 0.88)

**Key Methods:**
- `compareMoney(entitiesA, entitiesB, tolerance)`: Returns `EntityTypeComparison`
- `compareDate(entitiesA, entitiesB, dayTolerance)`: Returns `EntityTypeComparison`
- `compareText(entitiesA, entitiesB, similarityThreshold)`: Returns `EntityTypeComparison`
- `compareEntities(entitiesA, entitiesB)`: Returns `ComparisonResult`

### 3. Transform Data Aggregator Service

**File:** `src/services/transform-data-aggregator.service.ts`

**Responsibilities:**
- Aggregates all JSON files from transform output into single object
- Parses relationship files to build entity graph
- Cleans metadata fields (`source_http_request`, `request_identifier`)
- Excludes fact sheet relationships
- Converts aggregated data to text for NER processing

**Key Methods:**
- `aggregateTransformOutput(dir, swapDirection)`: Returns aggregated data structure
- `jsonToText(obj)`: Converts JSON to array of text sentences
- `convertAggregatedDataToText(aggregatedData)`: Returns single text string

## Entity Types

### QUANTITY
- **Examples**: `100`, `50000`, `1234.56`
- **Normalization**: Removes `$`, `€`, `£`, `¥` symbols, validates numeric format
- **Filtering**: Excludes ranges (e.g., "100-200")

### DATE
- **Examples**: `01/15/2024`, `2024-01-15`, `January 15, 2024`
- **Normalization**: All dates converted to `MM/DD/YYYY` format
- **Filtering**: Excludes vague dates ("yearly", "monthly", "each year")
- **Validation**: Year must be between 1900 and 2100

### ORGANIZATION
- **Examples**: `microsoft`, `apple corporation`
- **Normalization**: Converted to lowercase
- **Fuzzy Matching**: Jaro-Winkler similarity ≥ 0.88

### LOCATION
- **Examples**: `seattle`, `new york`
- **Normalization**: Converted to lowercase
- **Fuzzy Matching**: Jaro-Winkler similarity ≥ 0.88

## Comparison Metrics

### Per-Entity Metrics

Each entity type reports:

1. **Cosine Similarity** (0.0 to 1.0)
   - Measures distributional similarity between raw and transformed data
   - 1.0 = identical distributions, 0.0 = completely different

2. **Coverage** (0.0 to 1.0)
   - Percentage of entities from raw data found in transformed data
   - 1.0 = all raw entities present in transformed, 0.0 = none found

3. **Unmatched Entities**
   - List of entities from raw data not found in transformed data
   - Useful for identifying missing data

4. **Statistics**
   - Count of entities in raw vs transformed
   - Average confidence scores

### Global Completeness Score

Weighted average of coverage across all entity types:

```
weight = entity_count × avg_confidence
global_completeness = Σ(coverage × weight) / Σ(weight)
```

This gives more importance to:
- Entity types with more instances
- Entities with higher confidence scores

## Examples

### Example 1: High Completeness

```
💵 Money
  Raw data:         15 entities (avg confidence: 92.3%)
  Transformed data: 14 entities (avg confidence: 94.1%)

  Cosine Similarity: 95.2%
  Coverage:          93.3%

📅 Date
  Raw data:         8 entities (avg confidence: 88.5%)
  Transformed data: 8 entities (avg confidence: 91.2%)

  Cosine Similarity: 98.1%
  Coverage:          100.0%

🎯 Global Completeness Score: 95.8%
```

### Example 2: Low Completeness

```
💵 Money
  Raw data:         20 entities (avg confidence: 85.2%)
  Transformed data: 12 entities (avg confidence: 90.1%)

  Cosine Similarity: 72.4%
  Coverage:          60.0%

  ⚠️  Unmatched entities (8):
    • 50000
    • 125000
    • 3500
    ... and 5 more

🎯 Global Completeness Score: 68.3%
```

## Integration with Workflow

### Typical Workflow

1. **Prepare Raw Data**
   ```bash
   npx elephant-cli prepare \
     --url "https://example.com/property.html" \
     --address-zip seed-data.zip \
     --output-zip prepare-output.zip
   ```

2. **Transform Data**
   ```bash
   npx elephant-cli transform \
     --input-zip prepare-output.zip \
     --output-zip transform-output.zip
   ```

3. **Validate Completeness**
   ```bash
   npx elephant-cli mirror-validate \
     --prepare-zip prepare-output.zip \
     --transform-zip transform-output.zip \
     --output report.json
   ```

4. **Review Report**
   - Check global completeness score
   - Review unmatched entities
   - Identify data quality issues

### When to Use

- **Quality Assurance**: Verify transformation accuracy
- **Data Validation**: Ensure no critical information is lost
- **Debugging**: Identify issues in transformation scripts
- **Monitoring**: Track data quality over time
- **Compliance**: Document data completeness for audits

## Output Format

### Console Output

The command prints a formatted report to the console with:
- Progress indicators for each step
- Entity counts per extraction
- Comparison metrics per entity type
- Color-coded coverage scores (green ≥90%, yellow ≥70%, red <70%)
- Sample of unmatched entities (up to 5 per type)

### JSON Output (--output flag)

```json
{
  "rawEntities": {
    "QUANTITY": [{"value": "100", "confidence": 90.5}],
    "DATE": [{"value": "01/15/2024", "confidence": 88.2}],
    "ORGANIZATION": [{"value": "microsoft", "confidence": 92.1}],
    "LOCATION": [{"value": "seattle", "confidence": 85.3}]
  },
  "transformedEntities": {
    "QUANTITY": [{"value": "100", "confidence": 93.2}],
    "DATE": [{"value": "01/15/2024", "confidence": 91.5}],
    "ORGANIZATION": [{"value": "microsoft", "confidence": 94.3}],
    "LOCATION": [{"value": "seattle", "confidence": 87.8}]
  },
  "comparison": {
    "QUANTITY": {
      "cosineSimilarity": 0.952,
      "coverage": 1.0,
      "unmatchedFromA": [],
      "statsA": {"count": 1, "avgConfidence": 90.5},
      "statsB": {"count": 1, "avgConfidence": 93.2}
    },
    "DATE": { ... },
    "ORGANIZATION": { ... },
    "LOCATION": { ... },
    "globalCompleteness": 0.958
  },
  "summary": {
    "globalCompleteness": 0.958,
    "rawStats": {
      "money": 1,
      "date": 1,
      "organization": 1,
      "location": 1
    },
    "transformedStats": {
      "money": 1,
      "date": 1,
      "organization": 1,
      "location": 1
    }
  }
}
```

## Performance

- **Model Loading**: ~5-10 seconds (first time, cached afterward)
- **Entity Extraction**: ~1-5 seconds per document (depends on size)
- **Comparison**: <1 second
- **Memory Usage**: ~500MB (for loaded models)

## Testing

The command includes comprehensive tests:

- **Unit Tests**: 58 tests covering all three services
- **Integration Tests**: 2 tests with real HTML/JSON property data
- **Test Files**: Located in `tests/services/` and `tests/integration/`

Run tests:
```bash
npm test -- tests/services/ner-entity-extractor.service.test.ts
npm test -- tests/services/entity-comparison.service.test.ts
npm test -- tests/services/transform-data-aggregator.service.test.ts
npm test -- tests/integration/mirror-validate.integration.test.ts
```

## Troubleshooting

### Models Not Found

If you see "NER pipelines not initialized":
```bash
# Re-download models
rm -rf .cache/transformers
npm install
```

### Low Coverage Scores

Possible causes:
- Transformation script missing fields
- HTML parsing issues
- Different date/number formats
- Missing relationship files

Review unmatched entities in the report to identify issues.

### Performance Issues

For large documents:
- Entity extraction automatically chunks text (MAX_CHARS = 1000)
- Consider splitting very large documents
- Increase Node.js memory: `NODE_OPTIONS=--max-old-space-size=4096`

## Future Enhancements

Potential improvements:
- Support for additional entity types (PERCENT, QUANTITY, etc.)
- Configurable similarity thresholds
- Batch processing of multiple properties
- Historical comparison tracking
- ML-based completeness prediction
- Custom entity normalization rules

## References

- **NER Models Documentation**: [docs/nlp-models-setup.md](./nlp-models-setup.md)
- **Transformers.js**: [Documentation](https://huggingface.co/docs/transformers.js)
- **dayjs**: [Documentation](https://day.js.org/)
- **Jaro-Winkler**: [Wikipedia](https://en.wikipedia.org/wiki/Jaro%E2%80%93Winkler_distance)
