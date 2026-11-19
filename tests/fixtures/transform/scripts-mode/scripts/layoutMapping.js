const fs = require('fs');
fs.mkdirSync('owners', { recursive: true });
fs.writeFileSync('owners/layout_data.json', JSON.stringify({ layouts: [] }));
