// The Node modules and globals county scripts reach for besides fs and path.
const fs = require('fs');
const path = require('path');

const tryit = (run) => {
  try {
    return run();
  } catch (error) {
    return `${error.name}: ${error.message}`;
  }
};
const checks = {};
const done = [];

// vm: one county evaluates an object literal it cuts out of the page
checks.vm = tryit(() => {
  const vm = require('vm');
  const sandbox = { base: 40, seen: [] };
  return [
    vm.runInNewContext('({ "0100": "Single Family", 200: ["a", \'b\'], nested: { ok: true } })', {}),
    vm.runInNewContext('base + 2', sandbox),
    vm.runInNewContext('var made = base * 2; seen.push(made); made', sandbox),
    sandbox.seen,
    vm.runInNewContext('typeof require + typeof process + typeof module', {}),
    tryit(() => vm.runInNewContext('missing + 1', {})).split(':')[0],
    tryit(() => vm.runInNewContext('{ not valid', {})).split(':')[0],
  ];
});

checks.buffer = tryit(() => [
  Buffer.from('hi').toString('hex'),
  Buffer.isBuffer(Buffer.from('a')),
  Buffer.isBuffer('a'),
  Buffer.concat([Buffer.from('a'), Buffer.from('b')]).toString(),
  Buffer.from('héllo', 'utf8').length,
  Buffer.from([104, 105]).toString('utf8'),
  Buffer.from(new Uint8Array([1, 2]).buffer).length,
  `${Buffer.from('in a template')}`,
]);

checks.crypto = tryit(() => {
  const crypto = require('crypto');
  return [crypto.createHash('sha256').update('parcel ').update(Buffer.from('12345')).digest('hex'), crypto.createHash('sha256').update('').digest().length];
});

checks.process = tryit(() => [typeof process.cwd(), process.argv.length, typeof process.env, process.env.LAYOUT_DEBUG === undefined, typeof process.stdout.write, typeof process.stderr.write, typeof process.exit]);

checks.globals = ['URL', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'Buffer', 'atob', 'btoa', 'globalThis', 'global', '__dirname', '__filename', 'console', 'process', 'require', 'module', 'exports', 'performance']
  .filter((name) => tryit(() => typeof eval(name)) === 'undefined' || String(tryit(() => typeof eval(name))).includes('Error'));

checks.files = tryit(() => {
  fs.mkdirSync('made/deep', { recursive: true });
  fs.writeFileSync('made/deep/a.json', JSON.stringify({ ok: true }));
  fs.writeFileSync('made/bytes.bin', Buffer.from('raw'));
  const listed = fs.readdirSync('made', { withFileTypes: true }).map((entry) => [entry.name, entry.isDirectory(), entry.isFile()]);
  const answer = [
    JSON.parse(fs.readFileSync('made/deep/a.json', 'utf8')).ok,
    fs.readFileSync('made/bytes.bin').toString(),
    listed,
    fs.statSync('made/bytes.bin').size,
    fs.statSync('made').isDirectory(),
    tryit(() => fs.readFileSync('made/none.json', 'utf8')).split(':')[1].trim(),
    tryit(() => fs.readFileSync('made/none.json', 'utf8').code) !== undefined,
  ];
  fs.unlinkSync('made/bytes.bin');
  fs.rmSync('made', { recursive: true, force: true });
  return [...answer, fs.existsSync('made')];
});

done.push((async () => {
  const fsp = require('fs/promises');
  fs.mkdirSync('kept', { recursive: true });
  await fsp.writeFile('kept/file.json', JSON.stringify({ ok: true }));
  const read = JSON.parse(await fsp.readFile('kept/file.json', 'utf8'));
  const listed = await fs.promises.readdir('kept');
  const missing = await fsp.readFile('kept/none.json', 'utf8').catch((error) => error.code);
  await fsp.unlink('kept/file.json');
  fs.rmdirSync('kept');
  checks.fs_promises = [read.ok, listed, missing, fs.existsSync('kept'), fsp === fs.promises];
})());
done.push(new Promise((resolve) => setTimeout(() => {
  checks.timer_order = [];
  const dropped = setTimeout(() => checks.timer_order.push('cancelled'), 1);
  setTimeout(() => checks.timer_order.push('timeout 5'), 5);
  setTimeout((word) => checks.timer_order.push(word), 0, 'timeout 0');
  Promise.resolve().then(() => checks.timer_order.push('promise'));
  clearTimeout(dropped);
  checks.timer_order.push('sync');
  setTimeout(resolve, 20);
}, 0)));

Promise.all(done).then(() => {
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(path.join('data', 'probe.json'), JSON.stringify({ checks }, null, 2));
});
