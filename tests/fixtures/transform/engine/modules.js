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
    typeof vm.runInThisContext('1 + 1'),
    new vm.Script('base - 1').runInNewContext({ base: 10 }),
    vm.runInContext('base + 1', vm.createContext({ base: 1 })),
    vm.isContext(vm.createContext({})),
    tryit(() => vm.runInNewContext('missing + 1', {})).split(':')[0],
    tryit(() => vm.runInNewContext('{ not valid', {})).split(':')[0],
  ];
});

checks.events = tryit(() => {
  const EventEmitter = require('events');
  const emitter = new EventEmitter();
  const heard = [];
  const once = (value) => heard.push(`once ${value}`);
  const each = (value, more) => heard.push(`each ${value} ${more}`);
  emitter.on('data', each);
  emitter.once('data', once);
  const first = emitter.emit('data', 1, 'x');
  emitter.emit('data', 2, 'y');
  emitter.off('data', each);
  const third = emitter.emit('data', 3, 'z');
  class Mine extends EventEmitter {}
  const mine = new Mine();
  mine.addListener('go', () => heard.push('mine')).emit('go');
  return [heard, first, third, emitter.listenerCount('data'), require('events').EventEmitter === EventEmitter, tryit(() => emitter.emit('error', new Error('unheard'))), emitter.eventNames()];
});

checks.buffer = tryit(() => [
  Buffer.from('héllo').toString('base64'),
  Buffer.from('aGk=', 'base64').toString(),
  Buffer.from('hi').toString('hex'),
  Buffer.byteLength('héllo'),
  Buffer.isBuffer(Buffer.alloc(2)),
  Array.from(Buffer.alloc(3, 1)),
  Buffer.concat([Buffer.from('a'), Buffer.from('b')]).toString(),
  Buffer.from('héllo', 'utf8').length,
  Buffer.from('héllo', 'latin1').length,
  Buffer.from([104, 105]).toString('utf8'),
  Buffer.from('héllo').toString('latin1').length,
  Buffer.from('hello world').slice(0, 5).toString(),
  Buffer.from('hello world').subarray(6).toString(),
  Buffer.from('abc').equals(Buffer.from('abc')),
  Buffer.from('a-b_c', 'base64url').length,
  Buffer.from('hi').toString('base64url'),
  JSON.stringify(Buffer.from('hi')),
  Buffer.from(new Uint8Array([1, 2]).buffer).length,
  Buffer.compare(Buffer.from('a'), Buffer.from('b')),
  Buffer.from('€').toString('ascii').length,
  Buffer.from('hi').includes('i'),
  Buffer.from('hello').indexOf('l'),
  Buffer.from('ff00', 'hex').readUInt8(0),
]);

checks.text = tryit(() => [
  Array.from(new TextEncoder().encode('é€')),
  new TextDecoder().decode(new Uint8Array([195, 169, 226, 130, 172])),
  new TextDecoder('utf-8').decode(Buffer.from('plain')),
  new TextDecoder('latin1').decode(new Uint8Array([233])),
  new TextDecoder('windows-1252').decode(new Uint8Array([233, 147])),
  new TextDecoder().decode(new Uint8Array([255, 104])),
  new TextDecoder().encoding,
  btoa('hi'),
  atob('aGk='),
]);

checks.util = tryit(() => {
  const util = require('util');
  return [util.format('%s has %d items: %j', 'cart', 2, { a: 1 }), typeof util.inspect({ a: 1, b: 'x' }), typeof util.promisify, util.isDeepStrictEqual({ a: [1] }, { a: [1] }), util.isDeepStrictEqual({ a: [1] }, { a: ['1'] }), util.types.isDate(new Date()), typeof util.inherits, util.format('%i%%', 12.5), util.format('a', 'b', 3)];
});

checks.os = tryit(() => {
  const os = require('os');
  return [os.EOL, typeof os.tmpdir(), typeof os.platform(), typeof os.homedir(), os.cpus().length > 0];
});

checks.process = tryit(() => [
  typeof process.cwd(), typeof process.execPath, process.argv.length, typeof process.env, typeof process.platform, typeof process.version,
  typeof process.hrtime()[0], typeof process.hrtime.bigint(), typeof process.memoryUsage().heapUsed, typeof process.uptime(), typeof process.pid, typeof process.emitWarning, process.env.LAYOUT_DEBUG === undefined, typeof process.stdout.write,
]);

checks.assert = tryit(() => {
  const assert = require('assert');
  const strict = require('assert/strict');
  const outcomes = [
    () => assert(true),
    () => assert.ok(0, 'zero is not ok'),
    () => assert.equal(1, '1'),
    () => assert.strictEqual(1, '1', 'one is not "1"'),
    () => assert.deepStrictEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }),
    () => assert.deepStrictEqual({ a: 1 }, { a: 2 }, 'not alike'),
    () => assert.deepEqual([1, 2], [1, 2]),
    () => assert.notStrictEqual(1, 1, 'same'),
    () => assert.throws(() => { throw new Error('x'); }),
    () => assert.match('abc', /b/),
    () => strict.equal(1, '1', 'strict is strict'),
    () => assert.fail('failed on purpose'),
  ];
  return outcomes.map((run) => {
    try {
      run();
      return 'ok';
    } catch (error) {
      return `${error.name}: ${error.message.split('\n')[0]}`;
    }
  });
});

checks.timers = tryit(() => {
  const timers = require('timers');
  return [typeof timers.setTimeout, typeof setTimeout(() => {}, 0).unref, typeof setInterval, typeof clearTimeout(undefined), typeof setTimeout(() => {}, 0).ref];
});

checks.globals = ['URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'structuredClone', 'setTimeout', 'setImmediate', 'queueMicrotask', 'Buffer', 'atob', 'btoa', 'globalThis', 'global', '__dirname', '__filename', 'console', 'process', 'require', 'module', 'exports', 'AbortController', 'performance']
  .filter((name) => tryit(() => typeof eval(name)) === 'undefined' || String(tryit(() => typeof eval(name))).includes('Error'));

checks.structured_clone = tryit(() => {
  const made = structuredClone({ at: new Date(0), list: [1, { deep: true }], map: new Map([[1, 2]]), set: new Set([1]), nothing: undefined });
  return [made.at instanceof Date, made.list[1].deep, made.map instanceof Map && made.map.get(1), made.set instanceof Set, 'nothing' in made];
});

// fs with callbacks and promises
done.push(new Promise((resolve) => {
  fs.writeFile('callback.txt', 'written', (error) => {
    fs.readFile('callback.txt', 'utf8', (failed, text) => {
      fs.readFile('missing.txt', 'utf8', (missing) => {
        fs.unlinkSync('callback.txt');
        checks.fs_callbacks = [error === null || error === undefined, failed === null, text, missing && missing.code];
        resolve();
      });
    });
  });
}));
done.push((async () => {
  const fsp = require('fs/promises');
  await fsp.mkdir('made/deep', { recursive: true });
  await fsp.writeFile('made/deep/file.json', JSON.stringify({ ok: true }));
  const read = JSON.parse(await fsp.readFile('made/deep/file.json', 'utf8'));
  const listed = await fs.promises.readdir('made');
  const missing = await fsp.readFile('made/none.json', 'utf8').catch((error) => error.code);
  await fsp.rm('made', { recursive: true, force: true });
  checks.fs_promises = [read.ok, listed, missing, fs.existsSync('made'), fsp === fs.promises];
})());
done.push(new Promise((resolve) => setTimeout(() => {
  checks.timer_order = [];
  setTimeout(() => checks.timer_order.push('timeout 5'), 5);
  setTimeout(() => checks.timer_order.push('timeout 0'), 0);
  setImmediate(() => checks.timer_order.push('immediate'));
  process.nextTick(() => checks.timer_order.push('tick'));
  Promise.resolve().then(() => checks.timer_order.push('promise'));
  checks.timer_order.push('sync');
  setTimeout(resolve, 20);
}, 0)));

Promise.all(done).then(() => {
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(path.join('data', 'probe.json'), JSON.stringify({ checks }, null, 2));
});
