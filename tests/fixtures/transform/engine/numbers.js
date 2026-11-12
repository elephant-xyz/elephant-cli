// Scripts format areas and amounts with `value.toLocaleString()`.
const fs = require('fs');
const path = require('path');

const values = [0, 12, 999, 1000, 1234, -98765, 1234567.891, 0.5, 1234.5678, 999.9995, 0.0005, 0.0004, 1e21, 123456789012345680000, -0, -0.0001, 2.5, 1e-7, NaN, Infinity, -Infinity];
const checks = {
  plain: values.map((value) => value.toLocaleString()),
  en_us: values.map((value) => value.toLocaleString('en-US')),
  two_digits: [1234.5, 1234.567, 0, -5.005, 1e6].map((value) => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
  no_digits: [1234.5, 0.5, 1.5, 2.5, 999.5].map((value) => value.toLocaleString('en-US', { maximumFractionDigits: 0 })),
  at_least_one: [1234, 1234.25].map((value) => value.toLocaleString(undefined, { minimumFractionDigits: 1 })),
  ungrouped: [1234567.5].map((value) => value.toLocaleString('en-US', { useGrouping: false })),
  dollars: [1234.5, -1234.5, 0, 1e6, 0.005].map((value) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })),
  whole_dollars: [1234.5, 1e6].map((value) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })),
  percent: [0.256, 1, 0.0049].map((value) => value.toLocaleString('en-US', { style: 'percent' })),
  in_a_template: `${(2400).toLocaleString()} sq ft`,
  bigint: (12345678901234567890n).toLocaleString(),
};

fs.mkdirSync('data', { recursive: true });
fs.writeFileSync(path.join('data', 'probe.json'), JSON.stringify({ checks }, null, 2));
