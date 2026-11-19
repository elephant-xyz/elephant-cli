const fs = require('fs');
fs.mkdirSync('owners', { recursive: true });
fs.writeFileSync('owners/utilities_data.json', JSON.stringify({}));
