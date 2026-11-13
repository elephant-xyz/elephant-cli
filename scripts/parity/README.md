# Parity checks

Scripts that hold this crate to elephant-cli 1.x and to its own contract on generated input. They are not part of the test suite: they need a checkout of 1.x, real county scripts or a large archive, and minutes to run. Run them after a change to the validator, to hashing, to the table export or to the JavaScript engine.

| Script | What it checks | Needs |
| --- | --- | --- |
| `fuzz-car.py <binary> <car> <schema-cache> <rounds> [seed]` | `validate` on thousands of corrupted copies of a valid county CAR: it ends, exits 0, 1 or 2, and passes no changed file | A CAR that passes |
| `fuzz-property.py <binary> <property-dir> <schema-cache> <rounds> [seed]` | `validate` and `hash` on damaged copies of a valid property: they end and exit 0, 1 or 2 | A property that passes |
| `hash-diff.py <binary> <property-dir> <schema-cache> <count> [seed]` | `hash` of 1.x and 2.x on properties full of awkward JSON: same CIDs, same CAR bytes | `ELEPHANT_CLI_V1` |
| `validate-diff.py <binary> <property-dir> <schema-cache> <count> [seed]` | `validate` of 1.x and 2.x on damaged properties: same findings | `ELEPHANT_CLI_V1` |
| `compare-tables.mjs <tables-a> <tables-b>` | Two `export-tables` outputs: same tables, columns and rows | `HYPARQUET` |
| `county-scripts.sh <scripts-repo> <prepared.zip> <out-dir>` | Every county's scripts under 1.x and 2.x on one prepared ZIP | `ELEPHANT_CLI_V1`, a checkout of `elephant-xyz/Counties-trasform-scripts` |
| `county-failures.py <output> <out-dir>` | For counties that fail under both: same script, same line | The output of `county-scripts.sh` |

`ELEPHANT_CLI_V1` is the command that runs 1.x, for example `node /path/to/elephant-cli-1.x/bin/elephant-cli`; build that checkout first and set `ELEPHANT_SKIP_UPDATE_CHECK=1`. `tests/fixtures/validate/clean` is a property that passes and `tests/fixtures/lexicon` a schema cache; `hash` of three copies of that property gives a CAR that passes.

A row that differs is not always a fault: 1.x lists the links of a data-group root in directory order, which varies between runs, and fetches a CID it does not know from a gateway.
