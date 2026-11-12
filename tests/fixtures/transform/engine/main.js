// County scripts end with `if (require.main === module) main();`.
const fs = require('fs');
const path = require('path');

fs.writeFileSync('helper.js', 'module.exports = { main: require.main === module, parent: require.main.filename };');
const helper = require(path.resolve('helper.js'));

const checks = {
  ran: false,
  helper_is_main: helper.main,
  helper_sees_main: helper.parent === __filename,
  main_filename: require.main.filename === __filename,
  module_keys: ['children', 'exports', 'filename', 'id', 'loaded', 'path', 'paths'].filter((key) => key in module),
  exec_path: typeof process.execPath,
  argv: [process.argv.length, process.argv[1] === __filename],
};

function main() {
  checks.ran = true;
}

if (require.main === module) main();

fs.unlinkSync('helper.js');
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync(path.join('data', 'probe.json'), JSON.stringify({ checks }, null, 2));
