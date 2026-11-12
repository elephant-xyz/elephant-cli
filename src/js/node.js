// The slice of Node.js that county transform scripts use, on top of a few
// host functions: `fs` (synchronous calls and their `fs.promises` twins),
// `path` (POSIX), `process`, `console`, `Buffer`, timers and CommonJS
// `require`, with `cheerio` built in. Every path is resolved against a
// working directory the host confines the script to.
(function (host) {
  'use strict';

  // ---- path (POSIX) ----
  const normalize = (parts, absolute) => {
    const kept = [];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part !== '..') kept.push(part);
      else if (kept.length && kept[kept.length - 1] !== '..') kept.pop();
      else if (!absolute) kept.push('..');
    }
    return kept;
  };
  const path = {
    sep: '/',
    delimiter: ':',
    isAbsolute: (p) => String(p).startsWith('/'),
    normalize(p) {
      p = String(p);
      const absolute = p.startsWith('/');
      const joined = normalize(p.split('/'), absolute).join('/');
      const tail = p.endsWith('/') && joined ? '/' : '';
      return (absolute ? '/' : '') + joined + tail || (absolute ? '/' : '.');
    },
    join(...parts) {
      const joined = parts.filter((part) => String(part) !== '').join('/');
      return joined ? path.normalize(joined) : '.';
    },
    resolve(...parts) {
      let resolved = '';
      for (let at = parts.length - 1; at >= 0 && !resolved.startsWith('/'); at--) {
        if (String(parts[at]) !== '') resolved = parts[at] + (resolved ? '/' + resolved : '');
      }
      if (!resolved.startsWith('/')) resolved = host.cwd + (resolved ? '/' + resolved : '');
      return '/' + normalize(resolved.split('/'), true).join('/');
    },
    dirname(p) {
      p = String(p).replace(/\/+$/, '');
      const at = p.lastIndexOf('/');
      if (at < 0) return '.';
      return at === 0 ? '/' : p.slice(0, at);
    },
    basename(p, suffix) {
      const base = String(p).replace(/\/+$/, '').split('/').pop();
      return suffix && base.endsWith(suffix) && base !== suffix ? base.slice(0, -suffix.length) : base;
    },
    extname(p) {
      const base = path.basename(p);
      const at = base.lastIndexOf('.');
      return at > 0 ? base.slice(at) : '';
    },
    relative(from, to) {
      const a = path.resolve(from).split('/').filter(Boolean);
      const b = path.resolve(to).split('/').filter(Boolean);
      let same = 0;
      while (same < a.length && same < b.length && a[same] === b[same]) same++;
      return [...a.slice(same).map(() => '..'), ...b.slice(same)].join('/');
    },
    parse(p) {
      const base = path.basename(p);
      const ext = path.extname(p);
      const dir = path.dirname(p);
      return { root: String(p).startsWith('/') ? '/' : '', dir, base, ext, name: ext ? base.slice(0, -ext.length) : base };
    },
    format: (parts) => (parts.dir ? parts.dir + '/' : '') + (parts.base || (parts.name || '') + (parts.ext || '')),
  };
  path.posix = path;

  // ---- Buffer ----
  class Buffer extends Uint8Array {
    static from(value, encoding) {
      if (typeof value === 'string') {
        if (encoding === 'base64') return Buffer.from(host.base64Decode(value));
        if (encoding === 'hex') return Buffer.from(value.match(/../g).map((pair) => parseInt(pair, 16)));
        return Buffer.from(host.utf8Encode(value));
      }
      const buffer = new Buffer(value.length);
      buffer.set(value);
      return buffer;
    }
    static isBuffer(value) {
      return value instanceof Buffer;
    }
    static byteLength(value) {
      return typeof value === 'string' ? host.utf8Encode(value).length : value.length;
    }
    static concat(list) {
      const out = new Buffer(list.reduce((sum, item) => sum + item.length, 0));
      let at = 0;
      for (const item of list) {
        out.set(item, at);
        at += item.length;
      }
      return out;
    }
    toString(encoding) {
      if (encoding === 'base64') return host.base64Encode(this);
      if (encoding === 'hex') return Array.from(this, (byte) => byte.toString(16).padStart(2, '0')).join('');
      return host.utf8Decode(this);
    }
    toJSON() {
      return { type: 'Buffer', data: Array.from(this) };
    }
  }

  // ---- fs ----
  // The host reports failures as "CODE: text"; Node code reads `error.code`.
  const call = (fn, ...args) => {
    try {
      return fn(...args);
    } catch (error) {
      const code = /^([A-Z]+): /.exec(error && error.message);
      if (code) error.code = code[1];
      throw error;
    }
  };
  const abs = (p) => path.resolve(p instanceof URL_ ? p.pathname : String(p));
  const encodingOf = (options) => (typeof options === 'string' ? options : options && options.encoding);
  const stat = (p) => {
    const info = call(host.stat, abs(p));
    return {
      size: info.size,
      mtimeMs: info.mtime,
      mtime: new Date(info.mtime),
      isFile: () => info.kind === 'file',
      isDirectory: () => info.kind === 'dir',
      isSymbolicLink: () => false,
    };
  };
  const fs = {
    existsSync: (p) => {
      try {
        return host.exists(abs(p));
      } catch (error) {
        return false;
      }
    },
    readFileSync: (p, options) =>
      encodingOf(options) ? call(host.readText, abs(p)) : Buffer.from(call(host.readBytes, abs(p))),
    writeFileSync: (p, data) =>
      typeof data === 'string' ? call(host.writeText, abs(p), data, false) : call(host.writeBytes, abs(p), data),
    appendFileSync: (p, data) => call(host.writeText, abs(p), String(data), true),
    mkdirSync: (p, options) => {
      const recursive = Boolean(options && options.recursive);
      call(host.mkdir, abs(p), recursive);
      return recursive ? abs(p) : undefined;
    },
    readdirSync: (p, options) => {
      const names = call(host.list, abs(p));
      if (!(options && options.withFileTypes)) return names;
      return names.map((name) => {
        const info = stat(path.join(abs(p), name));
        return { name, isFile: info.isFile, isDirectory: info.isDirectory, isSymbolicLink: info.isSymbolicLink };
      });
    },
    unlinkSync: (p) => call(host.remove, abs(p), false, false),
    rmdirSync: (p, options) => call(host.remove, abs(p), Boolean(options && options.recursive), false),
    rmSync: (p, options) => call(host.remove, abs(p), Boolean(options && options.recursive), Boolean(options && options.force)),
    statSync: stat,
    lstatSync: stat,
    accessSync: (p) => void stat(p),
    copyFileSync: (from, to) => call(host.writeBytes, abs(to), call(host.readBytes, abs(from))),
    renameSync: (from, to) => call(host.rename, abs(from), abs(to)),
    constants: { F_OK: 0, R_OK: 4, W_OK: 2 },
  };
  const later = (fn) => async (...args) => fn(...args);
  fs.promises = {
    readFile: later(fs.readFileSync),
    writeFile: later(fs.writeFileSync),
    appendFile: later(fs.appendFileSync),
    mkdir: later(fs.mkdirSync),
    readdir: later(fs.readdirSync),
    unlink: later(fs.unlinkSync),
    rm: later(fs.rmSync),
    stat: later(fs.statSync),
    lstat: later(fs.lstatSync),
    access: later(fs.accessSync),
    copyFile: later(fs.copyFileSync),
    rename: later(fs.renameSync),
  };

  // ---- console ----
  const show = (value) => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack ? `${value.name}: ${value.message}\n${value.stack}` : String(value);
    if (typeof value === 'function') return `[Function: ${value.name || 'anonymous'}]`;
    if (value && typeof value === 'object') {
      try {
        return JSON.stringify(value, null, 2);
      } catch (error) {
        return String(value);
      }
    }
    return String(value);
  };
  const print = (stream) => (...args) => host.print(stream, args.map(show).join(' ') + '\n');
  const console = {
    log: print(1),
    info: print(1),
    debug: print(1),
    warn: print(2),
    error: print(2),
    trace: print(2),
    table: print(1),
    dir: print(1),
    group: print(1),
    groupEnd: () => {},
    assert: (ok, ...args) => void (ok || print(2)('Assertion failed', ...args)),
    time: () => {},
    timeEnd: () => {},
  };

  // ---- timers ----
  const timers = [];
  let ticket = 0;
  const schedule = (repeat) => (fn, delay, ...args) => {
    const timer = { id: ++ticket, due: host.now() + Math.max(0, Number(delay) || 0), fn, args, every: repeat ? Math.max(1, Number(delay) || 1) : 0 };
    timers.push(timer);
    return timer.id;
  };
  const cancel = (id) => {
    const at = timers.findIndex((timer) => timer.id === (id && id.id ? id.id : id));
    if (at >= 0) timers.splice(at, 1);
  };
  // Run the timers that are due; return how long until the next one, or -1 when none is left.
  host.timers = () => {
    const now = host.now();
    for (const timer of timers.filter((timer) => timer.due <= now)) {
      if (timer.every) timer.due = now + timer.every;
      else cancel(timer.id);
      timer.fn(...timer.args);
    }
    return timers.length ? Math.max(0, Math.min(...timers.map((timer) => timer.due)) - host.now()) : -1;
  };

  // ---- process ----
  class Exit extends Error {
    constructor(code) {
      super(`process.exit(${code})`);
      this.exitCode = code;
    }
  }
  const process = {
    argv: ['node', host.entry],
    execPath: 'node',
    env: { NODE_ENV: 'production' },
    platform: 'linux',
    version: 'v22.0.0',
    versions: { node: '22.0.0', quickjs: 'ng' },
    exitCode: undefined,
    cwd: () => host.cwd,
    exit: (code) => {
      const status = code === undefined ? process.exitCode || 0 : Number(code);
      // told to the host too: an exit inside a promise callback must still stop the run
      host.exit(status);
      throw new Exit(status);
    },
    nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)),
    hrtime: Object.assign(() => [Math.floor(host.now() / 1000), (host.now() % 1000) * 1e6], { bigint: () => BigInt(Math.round(host.now() * 1e6)) }),
    memoryUsage: () => ({ rss: 0, heapUsed: 0, heapTotal: 0 }),
    on: () => process,
    once: () => process,
    stdout: { write: (text) => host.print(1, String(text)), isTTY: false },
    stderr: { write: (text) => host.print(2, String(text)), isTTY: false },
  };

  // ---- URL: only what resolving a file path or reading a query needs ----
  class URL_ {
    constructor(text, base) {
      const match = /^([a-z][a-z0-9+.-]*:)(\/\/([^/?#]*))?([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(String(text));
      if (!match) {
        if (base === undefined) throw new TypeError(`Invalid URL: ${text}`);
        const root = new URL_(base);
        const joined = String(text).startsWith('/') ? String(text) : path.join(path.dirname(root.pathname || '/'), String(text));
        return new URL_(`${root.protocol}//${root.host}${joined}`);
      }
      this.protocol = match[1].toLowerCase();
      this.host = match[3] || '';
      this.hostname = this.host.replace(/:\d+$/, '');
      this.port = (/:(\d+)$/.exec(this.host) || [])[1] || '';
      this.pathname = match[4] || (match[2] !== undefined ? '/' : '');
      this.search = match[5] || '';
      this.hash = match[6] || '';
      this.origin = `${this.protocol}//${this.host}`;
      this.href = `${this.protocol}${match[2] !== undefined ? '//' + this.host : ''}${this.pathname}${this.search}${this.hash}`;
    }
    toString() {
      return this.href;
    }
  }

  // ---- locale: the en-US answers Node gives; this engine has no Intl ----
  // The plain digits of a non-negative finite number, taken from its shortest
  // form as Intl does (5.005 rounds to 5.01, though the double is below it).
  const digits = (value, shift) => {
    const [mantissa, exponent] = String(value).split('e');
    const [whole, fraction = ''] = mantissa.split('.');
    const all = whole + fraction;
    const point = whole.length + Number(exponent || 0) + shift;
    if (point <= 0) return ['0', '0'.repeat(-point) + all];
    return [all.slice(0, point).padEnd(point, '0'), all.slice(point)];
  };
  const group = (whole) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  function localeNumber(locales, options) {
    const value = Number(this);
    const style = (options && options.style) || 'decimal';
    const sign = value < 0 || Object.is(value, -0) ? '-' : '';
    const symbol = style === 'currency' ? (options.currency === 'USD' ? '$' : `${options.currency} `) : '';
    const unit = style === 'percent' ? '%' : '';
    if (Number.isNaN(value)) return `${symbol}NaN${unit}`;
    if (!Number.isFinite(value)) return `${sign}${symbol}∞${unit}`;
    const set = (name, fallback) => (options && options[name] !== undefined ? Number(options[name]) : fallback);
    const most = set('maximumFractionDigits', undefined);
    const least = set('minimumFractionDigits', Math.min(style === 'currency' ? 2 : 0, most === undefined ? 2 : most));
    const limit = most === undefined ? Math.max(least, style === 'currency' ? 2 : style === 'percent' ? 0 : 3) : Math.max(least, most);
    let [whole, fraction] = digits(Math.abs(value), style === 'percent' ? 2 : 0);
    if (fraction.length > limit) {
      const up = fraction[limit] >= '5';
      const kept = BigInt(whole + fraction.slice(0, limit)) + (up ? 1n : 0n);
      const text = kept.toString().padStart(limit + 1, '0');
      whole = text.slice(0, text.length - limit);
      fraction = text.slice(text.length - limit);
    }
    whole = whole.replace(/^0+(?=\d)/, '');
    fraction = fraction.replace(/0+$/, '').padEnd(least, '0');
    const grouped = options && options.useGrouping === false ? whole : group(whole);
    return `${sign}${symbol}${grouped}${fraction ? '.' + fraction : ''}${unit}`;
  }
  if (typeof globalThis.Intl === 'undefined') {
    Number.prototype.toLocaleString = localeNumber;
    BigInt.prototype.toLocaleString = function () {
      return String(this).replace(/\d+/, group);
    };
  }

  // ---- CommonJS ----
  const builtins = {
    fs,
    'fs/promises': fs.promises,
    path,
    process,
    buffer: { Buffer },
    os: { EOL: '\n', tmpdir: () => host.cwd, platform: () => 'linux', homedir: () => host.cwd, cpus: () => [{}] },
    url: { URL: URL_, fileURLToPath: (url) => new URL_(String(url)).pathname, pathToFileURL: (file) => new URL_(`file://${path.resolve(file)}`) },
    util: { inspect: show, format: (...args) => args.map(show).join(' '), promisify: (fn) => (...args) => new Promise((resolve, reject) => fn(...args, (error, value) => (error ? reject(error) : resolve(value)))) },
    assert: Object.assign((ok, message) => { if (!ok) throw new Error(message || 'Assertion failed'); }, { ok: (ok, message) => { if (!ok) throw new Error(message || 'Assertion failed'); }, strictEqual: (a, b, message) => { if (a !== b) throw new Error(message || `${show(a)} !== ${show(b)}`); } }),
  };
  const hashing = { sha256: host.sha256, sha512: host.sha512 };
  builtins.crypto = {
    createHash(name) {
      const digest = hashing[String(name).toLowerCase()];
      if (!digest) throw new Error(`Digest method not supported: ${name}`);
      const parts = [];
      const hash = {
        update: (data) => (parts.push(typeof data === 'string' ? Buffer.from(data) : data), hash),
        digest: (encoding) => {
          const bytes = Buffer.from(digest(Buffer.concat(parts)));
          return encoding ? bytes.toString(encoding) : bytes;
        },
      };
      return hash;
    },
    randomUUID: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => ((c === 'x' ? Math.random() * 16 : 8 + Math.random() * 4) | 0).toString(16)),
  };
  const packages = {};
  const loaded = new Map();
  const missing = (name) => Object.assign(new Error(`Cannot find module '${name}'`), { code: 'MODULE_NOT_FOUND' });
  const locate = (name, from) => {
    const base = path.resolve(from, name);
    for (const candidate of [base, base + '.js', base + '.cjs', base + '.json', base + '/index.js']) {
      if (host.isFile(candidate)) return candidate;
    }
    throw missing(name);
  };
  const builtin = (name) => {
    const plain = name.startsWith('node:') ? name.slice(5) : name;
    if (Object.prototype.hasOwnProperty.call(builtins, plain)) return builtins[plain];
    if (plain === 'cheerio') {
      if (!packages.cheerio) {
        const module = { exports: {} };
        new Function('module', 'exports', host.cheerio())(module, module.exports);
        packages.cheerio = module.exports;
      }
      return packages.cheerio;
    }
    return undefined;
  };
  // The module the host started: scripts end with `if (require.main === module) main();`.
  let main;
  const run = (file) => {
    if (loaded.has(file)) return loaded.get(file).exports;
    const module = { exports: {}, filename: file, id: file, path: path.dirname(file), paths: [], children: [], loaded: false };
    main = main || module;
    loaded.set(file, module);
    const source = call(host.readText, file);
    if (file.endsWith('.json')) module.exports = JSON.parse(source);
    else {
      const body = `(function (exports, require, module, __filename, __dirname) {${source.replace(/^#!.*/, '')}\n})`;
      host.compile(body, file)(module.exports, requirer(path.dirname(file)), module, file, path.dirname(file));
    }
    module.loaded = true;
    return module.exports;
  };
  const requirer = (from) => {
    const require = (name) => {
      const known = builtin(String(name));
      if (known !== undefined) return known;
      if (!/^\.{0,2}\//.test(name)) throw missing(name);
      return run(locate(name, from));
    };
    require.resolve = (name) => (builtin(String(name)) !== undefined ? name : locate(name, from));
    require.cache = {};
    require.main = main;
    return require;
  };

  Object.assign(globalThis, {
    global: globalThis,
    console,
    process,
    Buffer,
    setTimeout: schedule(false),
    setInterval: schedule(true),
    setImmediate: (fn, ...args) => schedule(false)(fn, 0, ...args),
    clearTimeout: cancel,
    clearInterval: cancel,
    clearImmediate: cancel,
  });
  if (typeof globalThis.URL === 'undefined') globalThis.URL = URL_;
  if (typeof globalThis.queueMicrotask === 'undefined') globalThis.queueMicrotask = (fn) => void Promise.resolve().then(fn);
  if (typeof globalThis.structuredClone === 'undefined') globalThis.structuredClone = (value) => JSON.parse(JSON.stringify(value));

  host.builtin = builtin;
  host.main = (file) => run(file);
  // Load a module (ES or CommonJS) and hand its exports to `entry`, a function
  // the host supplies as source text, together with `call(name, ...args)`.
  host.invoke = async (file, entry, esm) => {
    const loaded = esm ? await import(file) : run(file);
    const call = (name, ...args) => JSON.parse(host.call(name, JSON.stringify(args)));
    return (0, eval)(entry)(loaded, call);
  };
  host.exitCode = (error) => (error instanceof Exit ? error.exitCode : undefined);
  host.describe = (error) => (error instanceof Error ? `${error.stack && error.stack.includes(error.message) ? '' : `${error.name}: ${error.message}\n`}${error.stack || ''}` : `Uncaught ${show(error)}`);
})
