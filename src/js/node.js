// The slice of Node.js that county transform scripts use, on top of a few
// host functions: `fs`, `path` (POSIX), `process`, `console`, `Buffer`,
// `setTimeout`, a read-only `URL`, `http.get` and `https.get`,
// `vm.runInNewContext`, sha256 through `crypto`, CommonJS `require`, and
// `cheerio` built in. Every path is resolved against a working directory the
// host confines the script to. The engine has no Intl: number formatting and
// string collation give Node's en-US answers.
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
    relative(from, to) {
      const a = path.resolve(from).split('/').filter(Boolean);
      const b = path.resolve(to).split('/').filter(Boolean);
      let same = 0;
      while (same < a.length && same < b.length && a[same] === b[same]) same++;
      return [...a.slice(same).map(() => '..'), ...b.slice(same)].join('/');
    },
  };

  // ---- Buffer: bytes, read as UTF-8 or hex ----
  const utf8 = (encoding) => {
    if (encoding && !/^utf-?8$/i.test(encoding)) throw new TypeError(`The "${encoding}" encoding is not available in elephant-cli's JavaScript engine`);
  };
  class Buffer extends Uint8Array {
    static from(value, encoding) {
      if (typeof value === 'string') {
        utf8(encoding);
        return Buffer.from(host.utf8Encode(value));
      }
      if (value instanceof ArrayBuffer) value = new Uint8Array(value);
      const buffer = new Buffer(value.length);
      buffer.set(value);
      return buffer;
    }
    static isBuffer(value) {
      return value instanceof Buffer;
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
      if (encoding === 'hex') return Array.from(this, (byte) => byte.toString(16).padStart(2, '0')).join('');
      utf8(encoding);
      return host.utf8Decode(this);
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
  const abs = (p) => path.resolve(String(p));
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
      typeof data === 'string' ? call(host.writeText, abs(p), data) : call(host.writeBytes, abs(p), data),
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
  };
  const later = (fn) => async (...args) => fn(...args);
  fs.promises = { readFile: later(fs.readFileSync), writeFile: later(fs.writeFileSync), readdir: later(fs.readdirSync), unlink: later(fs.unlinkSync) };

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
  const console = { log: print(1), info: print(1), debug: print(1), warn: print(2), error: print(2) };

  // ---- timers ----
  const timers = [];
  let ticket = 0;
  const schedule = (fn, delay, ...args) => {
    timers.push({ id: ++ticket, due: host.now() + Math.max(0, Number(delay) || 0), fn, args });
    return ticket;
  };
  // an immediate runs before any timer that is due
  const immediately = (fn) => void timers.push({ id: ++ticket, due: 0, fn, args: [] });
  const cancel = (id) => {
    const at = timers.findIndex((timer) => timer.id === id);
    if (at >= 0) timers.splice(at, 1);
  };
  // Run the timers that are due; return how long until the next one, or -1 when none is left.
  host.timers = () => {
    const now = host.now();
    for (const timer of timers.filter((timer) => timer.due <= now).sort((a, b) => a.due - b.due || a.id - b.id)) {
      cancel(timer.id);
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
    env: { NODE_ENV: 'production' },
    exitCode: undefined,
    cwd: () => host.cwd,
    exit: (code) => {
      const status = code === undefined ? process.exitCode || 0 : Number(code);
      // told to the host too: an exit inside a promise callback must still stop the run
      host.exit(status);
      throw new Exit(status);
    },
    stdout: { write: (text) => host.print(1, String(text)), isTTY: false },
    stderr: { write: (text) => host.print(2, String(text)), isTTY: false },
  };

  // ---- URL, to read: the host takes the text apart by the same rules Node follows ----
  // The query of a URL, read as URLSearchParams reads it.
  class Query {
    #pairs;
    #text;
    constructor(pairs, text) {
      this.#pairs = pairs;
      this.#text = text;
    }
    get size() {
      return this.#pairs.length;
    }
    get(name) {
      const found = this.#pairs.find((pair) => pair[0] === String(name));
      return found ? found[1] : null;
    }
    getAll(name) {
      return this.#pairs.filter((pair) => pair[0] === String(name)).map((pair) => pair[1]);
    }
    has(name) {
      return this.#pairs.some((pair) => pair[0] === String(name));
    }
    forEach(each, self) {
      for (const [name, value] of this.#pairs) each.call(self, value, name, this);
    }
    keys() {
      return this.#pairs.map((pair) => pair[0])[Symbol.iterator]();
    }
    values() {
      return this.#pairs.map((pair) => pair[1])[Symbol.iterator]();
    }
    entries() {
      return this.#pairs.map((pair) => [pair[0], pair[1]])[Symbol.iterator]();
    }
    [Symbol.iterator]() {
      return this.entries();
    }
    toString() {
      return this.#text;
    }
  }
  class URL_ {
    constructor(text, base) {
      const parsed = host.url(String(text), base === undefined ? null : String(base));
      if (parsed == null) throw Object.assign(new TypeError(`Invalid URL: ${text}`), { code: 'ERR_INVALID_URL', input: String(text) });
      const { query, queryText, ...parts } = JSON.parse(parsed);
      // frozen: a part that is assigned to does not change the others, so it is not taken
      Object.freeze(Object.assign(this, parts, { searchParams: new Query(query, queryText) }));
    }
    toString() {
      return this.href;
    }
    toJSON() {
      return this.href;
    }
  }
  Object.defineProperty(URL_, 'name', { value: 'URL' });

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
  // String order as ICU's root collation gives it for what county data holds:
  // ASCII, Latin letters with accents, and common punctuation. Primary order
  // is punctuation, digits, letters without case; then accents; then case,
  // lowercase first. The tables are ICU's own order, read from Node by sorting
  // these characters with localeCompare.
  // ponytail: characters outside the tables sort after `z` by code point; use ICU's data if other scripts matter.
  const ORDER =
    '\t\n\u000b\f\r _-‐‒–—―,;:!¡?¿.…·\'‹›"«»()[]{}§¶@*/\\&#%‰†‡•′″`´^¯¨¸°©®+±÷×<=>¬|¦~¤¢$£¥€0123456789abcdefghijklmnopqrstuvwxyz';
  const MARKS = '̸̵̧̨́̀̆̂̌̊̈̋̃̇̄';
  // letters and signs that sort as others with a difference of accent (..) or of case ()
  const FOLD = {
    'ø': 'o̸', 'Ø': 'O̸', 'ł': 'l̵', 'Ł': 'L̵', 'đ': 'd̵', 'Đ': 'D̵',
    'æ': 'ae', 'Æ': 'AE', 'œ': 'oe', 'Œ': 'OE', 'ß': 'ss', 'ẞ': 'SS',
    'ð': 'd', 'Ð': 'D', 'ſ': 's', '‑': '‐', ' ': ' ',
    '‘': "'", '’': "'", '‚': "'", '“': '"', '”': '"', '„': '"',
  };
  const folded = new RegExp(`[${Object.keys(FOLD).join('')}]`, 'g');
  const DIGIT = ORDER.indexOf('0');
  const collationKey = (text, numeric) => {
    const key = [];
    const source = text.normalize('NFD').replace(folded, (found) => FOLD[found]);
    for (let at = 0; at < source.length; at++) {
      const char = source[at];
      const last = key[key.length - 1];
      const mark = MARKS.indexOf(char);
      if (last && (mark >= 0 || (char >= '̀' && char <= 'ͯ'))) last.accents += String.fromCharCode(mark >= 0 ? mark + 1 : char.charCodeAt(0));
      else if (last && char === '') last.cased = 2;
      else if (numeric && char >= '0' && char <= '9') {
        // a run of digits orders by its value: by how many digits count, then by those digits
        let end = at;
        while (source[end + 1] >= '0' && source[end + 1] <= '9') end++;
        const counted = source.slice(at, end + 1).replace(/^0+/, '');
        key.push({ rank: DIGIT + counted.length / (counted.length + 1), accents: '', cased: 0 });
        for (const digit of counted) key.push({ rank: DIGIT + Number(digit), accents: '', cased: 0 });
        at = end;
      } else {
        const lower = char.toLowerCase();
        const rank = ORDER.indexOf(lower);
        key.push({ rank: rank >= 0 ? rank : 1000 + lower.charCodeAt(0), accents: '', cased: lower === char ? 0 : 1 });
      }
    }
    return key;
  };
  function localeCompare(that, locales, options) {
    const level = (options && options.sensitivity) || 'variant';
    const a = collationKey(String(this), Boolean(options && options.numeric));
    const b = collationKey(String(that), Boolean(options && options.numeric));
    const by = (pick) => {
      for (let at = 0; at < a.length && at < b.length; at++) {
        const x = pick(a[at]);
        const y = pick(b[at]);
        if (x !== y) return x < y ? -1 : 1;
      }
      return 0;
    };
    return (
      by((part) => part.rank) ||
      Math.sign(a.length - b.length) ||
      (level === 'accent' || level === 'variant' ? by((part) => part.accents) : 0) ||
      (level === 'case' || level === 'variant' ? by((part) => part.cased) : 0)
    );
  }
  // Dates. The engine reads the same texts V8 does, but takes a month or day
  // of zero and a day above 31 as a date where V8 says Invalid Date; scripts
  // rely on that answer to drop what is not a date.
  const NativeDate = Date;
  const parseDate = (value) => {
    const text = String(value).trim();
    const us = /^(\d{1,2})[/-](\d{1,2})[/-]\d{2,4}(?!\d)/.exec(text);
    const iso = /^[+-]?\d{4,6}-(\d{2})(?:-(\d{2}))?(?!\d)/.exec(text);
    const within = (part, most) => part === undefined || (Number(part) >= 1 && Number(part) <= most);
    if (us && !(within(us[1], 12) && within(us[2], 31))) return NaN;
    if (iso && !(within(iso[1], 12) && within(iso[2], 31))) return NaN;
    if (/^\d{1,2}\/\d{4}$/.test(text)) return NaN;
    return NativeDate.parse(text);
  };
  const DateProxy = new Proxy(NativeDate, {
    construct: (target, args, fresh) =>
      Reflect.construct(target, args.length === 1 && typeof args[0] === 'string' ? [parseDate(args[0])] : args, fresh === DateProxy ? target : fresh),
    get: (target, name) => (name === 'parse' ? parseDate : target[name]),
  });
  Number.prototype.toLocaleString = localeNumber;
  String.prototype.localeCompare = localeCompare;
  NativeDate.prototype.constructor = DateProxy;
  globalThis.Date = DateProxy;
  // the engine's own date texts are not Node's, so these refuse instead of printing another format
  for (const name of ['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString']) {
    NativeDate.prototype[name] = () => {
      throw new RangeError(`Date.prototype.${name} is not available in elephant-cli's JavaScript engine: build the text from the parts of the date`);
    };
  }

  // ---- events, as far as http.get needs them, and vm.runInNewContext ----
  class EventEmitter {
    #heard = new Map();
    on(name, listener) {
      this.#heard.set(name, [...(this.#heard.get(name) || []), listener]);
      return this;
    }
    once(name, listener) {
      const wrapped = (...args) => {
        this.off(name, wrapped);
        listener.apply(this, args);
      };
      wrapped.listener = listener;
      return this.on(name, wrapped);
    }
    off(name, listener) {
      const kept = (this.#heard.get(name) || []).filter((known) => known !== listener && known.listener !== listener);
      if (kept.length) this.#heard.set(name, kept);
      else this.#heard.delete(name);
      return this;
    }
    emit(name, ...args) {
      const listeners = this.#heard.get(name) || [];
      if (!listeners.length && name === 'error') throw args[0] instanceof Error ? args[0] : new Error(`Unhandled error. (${show(args[0])})`);
      for (const listener of listeners) listener.apply(this, args);
      return listeners.length > 0;
    }
  }
  // vm: code sees the context object's properties and the language's own
  // globals, not this module's `process`, `Buffer` or `console`.
  const hidden = new Set(['global', 'console', 'process', 'Buffer', 'setTimeout', 'clearTimeout', 'URL', 'atob', 'btoa', 'queueMicrotask', 'performance']);
  const evaluate = new Function('__elephant_scope__', '__elephant_code__', 'with (__elephant_scope__) { return eval(__elephant_code__); }');
  const within = (code, context = {}) =>
    evaluate(
      new Proxy(context, {
        has: (target, name) => name in target || hidden.has(name),
        get: (target, name) => (name === Symbol.unscopables ? undefined : target[name]),
      }),
      String(code)
    );
  const vm = { runInNewContext: within };

  // ---- http.get and https.get: one blocking exchange with the host ----
  const web = {
    get(url, options, listener) {
      if (typeof options === 'function') [listener, options] = [options, {}];
      const req = new EventEmitter();
      immediately(() => {
        let answer;
        try {
          answer = call(host.request, String(url), JSON.stringify((options && options.headers) || {}));
        } catch (error) {
          return void req.emit('error', error);
        }
        const res = Object.assign(new EventEmitter(), { statusCode: answer.status, statusMessage: answer.reason, headers: JSON.parse(answer.headers) });
        if (listener) listener(res);
        req.emit('response', res);
        // after the listener has had its turn to say what it wants to hear
        immediately(() => {
          if (answer.body.length) res.emit('data', Buffer.from(answer.body));
          res.emit('end');
        });
      });
      return req;
    },
  };

  // ---- CommonJS ----
  const builtins = {
    fs,
    'fs/promises': fs.promises,
    path,
    vm,
    http: web,
    https: web,
    crypto: {
      createHash(name) {
        if (String(name).toLowerCase() !== 'sha256') throw new Error(`Digest method not supported: ${name}`);
        const parts = [];
        const hash = {
          update: (data) => (parts.push(typeof data === 'string' ? Buffer.from(data) : data), hash),
          digest: (encoding) => {
            const bytes = Buffer.from(host.sha256(Buffer.concat(parts)));
            return encoding ? bytes.toString(encoding) : bytes;
          },
        };
        return hash;
      },
    },
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

  Object.assign(globalThis, { global: globalThis, console, process, Buffer, URL: URL_, setTimeout: schedule, clearTimeout: cancel });

  host.builtin = builtin;
  host.main = (file) => run(file);
  // Load a module (ES or CommonJS) and hand its exports to `entry`, a function
  // the host supplies as source text, together with `call(name, ...args)`.
  host.invoke = async (file, entry, esm) => {
    const loaded = esm ? await import(file) : run(file);
    const call = (name, ...args) => JSON.parse(host.call(name, JSON.stringify(args)));
    return (0, eval)(entry)(loaded, call);
  };
  // an error as Node prints it: name and message, the stack, and what caused it
  host.describe = (error) => {
    if (!(error instanceof Error)) return `Uncaught ${show(error)}`;
    const head = error.stack && error.stack.includes(error.message) ? '' : `${error.name}: ${error.message}\n`;
    const cause = error.cause === undefined ? '' : `\n  [cause]: ${error.cause instanceof Error ? `${error.cause.name}: ${error.cause.message}` : show(error.cause)}`;
    return `${head}${error.stack || ''}${cause}`;
  };
})
