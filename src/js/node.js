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
  const CP1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
  const single = (bytes, mask) => Array.from(bytes, (byte) => String.fromCharCode(byte & mask)).join('');
  class Buffer extends Uint8Array {
    static from(value, encoding) {
      if (typeof value === 'string') {
        if (encoding === 'base64' || encoding === 'base64url') return Buffer.from(host.base64Decode(value.replace(/-/g, '+').replace(/_/g, '/')));
        if (encoding === 'hex') return Buffer.from((value.match(/../g) || []).map((pair) => parseInt(pair, 16)));
        if (encoding === 'latin1' || encoding === 'binary' || encoding === 'ascii') return Buffer.from(Array.from(value, (char) => char.charCodeAt(0) & 255));
        return Buffer.from(host.utf8Encode(value));
      }
      if (value instanceof ArrayBuffer) value = new Uint8Array(value);
      const buffer = new Buffer(value.length);
      buffer.set(value);
      return buffer;
    }
    static alloc(size, fill) {
      const buffer = new Buffer(size);
      if (fill !== undefined) buffer.fill(typeof fill === 'string' ? fill.charCodeAt(0) : fill);
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
    static compare(a, b) {
      for (let at = 0; at < a.length && at < b.length; at++) if (a[at] !== b[at]) return a[at] < b[at] ? -1 : 1;
      return Math.sign(a.length - b.length);
    }
    equals(other) {
      return Buffer.compare(this, other) === 0;
    }
    // a view, as in Node, where Uint8Array.prototype.slice would copy
    slice(start, end) {
      return this.subarray(start, end);
    }
    indexOf(value, from) {
      return typeof value === 'string' ? single(this, 255).indexOf(single(Buffer.from(value), 255), from) : super.indexOf(value, from);
    }
    includes(value, from) {
      return this.indexOf(value, from) >= 0;
    }
    readUInt8(at = 0) {
      return this[at];
    }
    toString(encoding) {
      if (encoding === 'base64') return host.base64Encode(this);
      if (encoding === 'base64url') return host.base64Encode(this).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      if (encoding === 'hex') return Array.from(this, (byte) => byte.toString(16).padStart(2, '0')).join('');
      if (encoding === 'latin1' || encoding === 'binary') return single(this, 255);
      if (encoding === 'ascii') return single(this, 127);
      return host.utf8Decode(this);
    }
    toJSON() {
      return { type: 'Buffer', data: Array.from(this) };
    }
  }
  class TextEncoder_ {
    encoding = 'utf-8';
    encode(text = '') {
      return new Uint8Array(host.utf8Encode(String(text)));
    }
  }
  class TextDecoder_ {
    constructor(label = 'utf-8') {
      const name = String(label).toLowerCase();
      this.encoding = ['utf8', 'utf-8'].includes(name) ? 'utf-8' : ['latin1', 'iso-8859-1', 'ascii', 'windows-1252', 'cp1252'].includes(name) ? 'windows-1252' : undefined;
      if (!this.encoding) throw new RangeError(`The "${label}" encoding is not supported`);
    }
    decode(bytes = new Uint8Array(0)) {
      const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (this.encoding === 'utf-8') return host.utf8Decode(view);
      return Array.from(view, (byte) => (byte >= 128 && byte < 160 ? CP1252[byte - 128] : String.fromCharCode(byte))).join('');
    }
  }
  Object.defineProperty(TextEncoder_, 'name', { value: 'TextEncoder' });
  Object.defineProperty(TextDecoder_, 'name', { value: 'TextDecoder' });

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
  const abs = (p) => path.resolve(p instanceof URL_ ? fileURLToPath(p) : String(p));
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
  // the callback forms: the same work, answered on the next turn
  const back = (fn) => (...args) => {
    const done = args.pop();
    let value;
    try {
      value = fn(...args);
    } catch (error) {
      return void queueMicrotask(() => done(error));
    }
    queueMicrotask(() => done(null, value));
  };
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
  for (const name of ['readFile', 'writeFile', 'appendFile', 'mkdir', 'readdir', 'unlink', 'rm', 'stat', 'lstat', 'access', 'copyFile', 'rename']) fs[name] = back(fs[`${name}Sync`]);
  fs.exists = (p, done) => queueMicrotask(() => done(fs.existsSync(p)));

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
  class Timeout {
    constructor(id) {
      this.id = id;
    }
    ref() {
      return this;
    }
    unref() {
      return this;
    }
    hasRef() {
      return true;
    }
    [Symbol.toPrimitive]() {
      return this.id;
    }
  }
  const schedule = (repeat) => (fn, delay, ...args) => {
    const timer = { id: ++ticket, due: host.now() + Math.max(0, Number(delay) || 0), fn, args, every: repeat ? Math.max(1, Number(delay) || 1) : 0 };
    timers.push(timer);
    return new Timeout(timer.id);
  };
  // an immediate runs before any timer that is due
  const immediately = (fn, ...args) => {
    timers.push({ id: ++ticket, due: 0, fn, args, every: 0 });
    return new Timeout(ticket);
  };
  const cancel = (id) => {
    const at = timers.findIndex((timer) => timer.id === (id && id.id ? id.id : id));
    if (at >= 0) timers.splice(at, 1);
  };
  // Run the timers that are due; return how long until the next one, or -1 when none is left.
  host.timers = () => {
    const now = host.now();
    for (const timer of timers.filter((timer) => timer.due <= now).sort((a, b) => a.due - b.due || a.id - b.id)) {
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
  const started = host.now();
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
    uptime: () => (host.now() - started) / 1000,
    pid: 1,
    emitWarning: (warning) => host.print(2, `Warning: ${warning && warning.message ? warning.message : warning}\n`),
    off: () => process,
    removeListener: () => process,
    on: () => process,
    once: () => process,
    stdout: { write: (text) => host.print(1, String(text)), isTTY: false },
    stderr: { write: (text) => host.print(2, String(text)), isTTY: false },
  };

  // ---- URL and URLSearchParams, for http(s) and file URLs ----
  const invalidUrl = (text) => Object.assign(new TypeError(`Invalid URL: ${text}`), { code: 'ERR_INVALID_URL', input: String(text) });
  // Percent-encode what a URL part may not hold as it stands; existing escapes stay.
  const escapeIn = (unsafe) => (text) =>
    text.replace(unsafe, (run) => {
      try {
        return encodeURIComponent(run).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
      } catch (error) {
        return run;
      }
    });
  const escapePath = escapeIn(/[\u0000- "<>`{}\u007f-￿]+/g);
  const escapeQuery = escapeIn(/[\u0000- "<>'\u007f-￿]+/g);
  const escapeHash = escapeIn(/[\u0000- "<>`\u007f-￿]+/g);
  const escapeUser = escapeIn(/[\u0000- "<>`{}/:;=@[\\\]^|?#\u007f-￿]+/g);
  const unescape = (text) => {
    try {
      return decodeURIComponent(text);
    } catch (error) {
      return text;
    }
  };
  const formDecode = (text) => unescape(text.replace(/\+/g, ' '));
  const formEncode = (text) => encodeURIComponent(text).replace(/%20/g, '+').replace(/[!'()~]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  const PORTS = { 'http:': '80', 'https:': '443', 'ftp:': '21', 'ws:': '80', 'wss:': '443', 'file:': '' };

  class URLSearchParams_ {
    #pairs = [];
    #changed;
    constructor(init, changed) {
      if (typeof init === 'string') this.#read(init);
      else if (init && typeof init[Symbol.iterator] === 'function') for (const [name, value] of init) this.#pairs.push([String(name), String(value)]);
      else if (init && typeof init === 'object') for (const name of Object.keys(init)) this.#pairs.push([name, String(init[name])]);
      this.#changed = changed;
    }
    #read(text) {
      this.#pairs = [];
      for (const piece of text.replace(/^\?/, '').split('&')) {
        if (!piece) continue;
        const at = piece.indexOf('=');
        this.#pairs.push([formDecode(at < 0 ? piece : piece.slice(0, at)), formDecode(at < 0 ? '' : piece.slice(at + 1))]);
      }
    }
    #touch() {
      if (this.#changed) this.#changed(this.toString());
    }
    // the owning URL was given a new query
    _reset(text) {
      this.#read(text);
    }
    get size() {
      return this.#pairs.length;
    }
    append(name, value) {
      this.#pairs.push([String(name), String(value)]);
      this.#touch();
    }
    delete(name) {
      this.#pairs = this.#pairs.filter((pair) => pair[0] !== String(name));
      this.#touch();
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
    set(name, value) {
      const at = this.#pairs.findIndex((pair) => pair[0] === String(name));
      if (at < 0) this.#pairs.push([String(name), String(value)]);
      else {
        this.#pairs[at][1] = String(value);
        this.#pairs = this.#pairs.filter((pair, index) => index <= at || pair[0] !== String(name));
      }
      this.#touch();
    }
    sort() {
      this.#pairs = this.#pairs
        .map((pair, index) => [pair, index])
        .sort((a, b) => (a[0][0] < b[0][0] ? -1 : a[0][0] > b[0][0] ? 1 : a[1] - b[1]))
        .map((entry) => entry[0]);
      this.#touch();
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
      return this.#pairs.map(([name, value]) => `${formEncode(name)}=${formEncode(value)}`).join('&');
    }
  }

  class URL_ {
    #scheme;
    #username = '';
    #password = '';
    #hostname = '';
    #port = '';
    #path = '';
    #query = null;
    #fragment = null;
    #params;
    constructor(text, base) {
      const given = String(text).trim();
      const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(given);
      if (scheme && !(base !== undefined && scheme[1].length === 1)) this.#parse(given, given);
      else {
        if (base === undefined) throw invalidUrl(text);
        const root = base instanceof URL_ ? base : new URL_(base);
        const origin = `${root.protocol}//${root.#authority()}`;
        const folder = root.#path.slice(0, root.#path.lastIndexOf('/') + 1);
        const query = root.#query === null ? '' : `?${root.#query}`;
        const joined =
          given === '' ? `${origin}${root.#path}${query}`
          : given.startsWith('//') ? `${root.protocol}${given}`
          : given.startsWith('/') ? `${origin}${given}`
          : given.startsWith('?') ? `${origin}${root.#path}${given}`
          : given.startsWith('#') ? `${origin}${root.#path}${query}${given}`
          : `${origin}${folder}${given}`;
        this.#parse(joined, text);
      }
    }
    #parse(given, shown) {
      const parts = /^([a-zA-Z][a-zA-Z0-9+.-]*:)(\/\/([^/?#]*))?([^?#]*)(\?[^#]*)?(#.*)?$/s.exec(given);
      if (!parts) throw invalidUrl(shown);
      this.#scheme = parts[1].toLowerCase();
      const special = Object.prototype.hasOwnProperty.call(PORTS, this.#scheme);
      if (special && parts[2] === undefined) throw invalidUrl(shown);
      const authority = /^(?:([^@]*)@)?(.*?)(?::(\d*))?$/.exec(parts[3] || '');
      if (authority[1] !== undefined) {
        const colon = authority[1].indexOf(':');
        this.#username = escapeUser(colon < 0 ? authority[1] : authority[1].slice(0, colon));
        this.#password = colon < 0 ? '' : escapeUser(authority[1].slice(colon + 1));
      }
      this.#hostname = authority[2].toLowerCase();
      if (special && this.#scheme !== 'file:' && !this.#hostname) throw invalidUrl(shown);
      if (/[\s<>^|%\\]/.test(this.#hostname)) throw invalidUrl(shown);
      this.#port = authority[3] && authority[3] !== PORTS[this.#scheme] ? String(Number(authority[3])) : '';
      this.#setPath(parts[4], special);
      this.#query = parts[5] === undefined ? null : escapeQuery(parts[5].slice(1));
      this.#fragment = parts[6] === undefined ? null : escapeHash(parts[6].slice(1));
    }
    #setPath(text, special) {
      if (!special) return void (this.#path = text);
      const kept = [];
      const pieces = escapePath(text).split('/').slice(1);
      pieces.forEach((piece, index) => {
        const last = index === pieces.length - 1;
        const plain = piece.replace(/%2e/gi, '.');
        if (plain === '..') kept.pop();
        if (plain === '..' || plain === '.') return void (last && kept.push(''));
        kept.push(piece);
      });
      this.#path = `/${kept.join('/')}`;
    }
    #authority() {
      const user = this.#username || this.#password ? `${this.#username}${this.#password ? `:${this.#password}` : ''}@` : '';
      return `${user}${this.host}`;
    }
    get protocol() {
      return this.#scheme;
    }
    get username() {
      return this.#username;
    }
    get password() {
      return this.#password;
    }
    get hostname() {
      return this.#hostname;
    }
    get port() {
      return this.#port;
    }
    get host() {
      return this.#hostname + (this.#port ? `:${this.#port}` : '');
    }
    get origin() {
      return this.#scheme === 'file:' || !Object.prototype.hasOwnProperty.call(PORTS, this.#scheme) ? 'null' : `${this.#scheme}//${this.host}`;
    }
    get pathname() {
      return this.#path;
    }
    set pathname(value) {
      const text = String(value);
      this.#setPath(text.startsWith('/') ? text : `/${text}`, true);
    }
    get search() {
      return this.#query ? `?${this.#query}` : '';
    }
    set search(value) {
      const text = String(value).replace(/^\?/, '');
      this.#query = text ? escapeQuery(text) : null;
      if (this.#params) this.#params._reset(this.#query || '');
    }
    get hash() {
      return this.#fragment ? `#${this.#fragment}` : '';
    }
    set hash(value) {
      const text = String(value).replace(/^#/, '');
      this.#fragment = text ? escapeHash(text) : null;
    }
    get searchParams() {
      this.#params = this.#params || new URLSearchParams_(this.#query || '', (text) => void (this.#query = text || null));
      return this.#params;
    }
    get href() {
      const slashes = Object.prototype.hasOwnProperty.call(PORTS, this.#scheme) || this.#hostname ? '//' : '';
      return `${this.#scheme}${slashes}${slashes ? this.#authority() : ''}${this.#path}${this.#query === null ? '' : `?${this.#query}`}${this.#fragment === null ? '' : `#${this.#fragment}`}`;
    }
    set href(value) {
      this.#username = this.#password = '';
      this.#parse(String(value).trim(), value);
      if (this.#params) this.#params._reset(this.#query || '');
    }
    toString() {
      return this.href;
    }
    toJSON() {
      return this.href;
    }
    static canParse(text, base) {
      try {
        return Boolean(new URL_(text, base));
      } catch (error) {
        return false;
      }
    }
  }
  Object.defineProperty(URL_, 'name', { value: 'URL' });
  Object.defineProperty(URLSearchParams_, 'name', { value: 'URLSearchParams' });
  const fileURLToPath = (url) => unescape((url instanceof URL_ ? url : new URL_(String(url))).pathname);

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
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const two = (value) => String(value).padStart(2, '0');
  // What toLocaleDateString, toLocaleTimeString and toLocaleString print: `wants` is 'date', 'time' or both.
  const localeDate = (date, wants, locales, options = {}) => {
    if (Number.isNaN(date.getTime())) return 'Invalid Date';
    const locale = (Array.isArray(locales) ? locales[0] : locales) || 'en-US';
    const refuse = (what) => {
      throw new RangeError(`${what} is not available in elephant-cli's JavaScript engine, which formats dates for en-US, en-CA and en-GB in local time or UTC`);
    };
    if (!['en', 'en-US', 'en-CA', 'en-GB'].includes(locale)) refuse(`The locale ${locale}`);
    for (const name of Object.keys(options)) {
      if (!['weekday', 'year', 'month', 'day', 'timeZone'].includes(name) || (name !== 'timeZone' && wants !== 'date')) refuse(`The option ${name}`);
    }
    if (options.timeZone !== undefined && options.timeZone !== 'UTC') refuse(`The time zone ${options.timeZone}`);
    const get = (part) => date[`get${options.timeZone ? 'UTC' : ''}${part}`]();
    const hour = get('Hours');
    const time = `${hour % 12 || 12}:${two(get('Minutes'))}:${two(get('Seconds'))} ${hour < 12 ? 'AM' : 'PM'}`;
    if (wants !== 'date' && !locale.endsWith('US') && locale !== 'en') refuse(`The time in ${locale}`);
    if (wants === 'time') return time;
    const year = get('FullYear');
    const month = get('Month');
    const day = get('Date');
    const chosen = ['weekday', 'year', 'month', 'day'].some((name) => options[name] !== undefined);
    let text = `${month + 1}/${day}/${year}`;
    if (locale === 'en-CA') text = `${year}-${two(month + 1)}-${two(day)}`;
    if (locale === 'en-GB') text = `${two(day)}/${two(month + 1)}/${year}`;
    if (chosen && (locale === 'en-CA' || locale === 'en-GB')) refuse(`Date options in ${locale}`);
    if (chosen) {
      const short = (name, style) => (style === 'long' ? name : name.slice(0, 3));
      const digits = (value, style) => (style === '2-digit' ? two(value % 100) : String(value));
      const named = options.month === 'long' || options.month === 'short';
      const parts = [
        options.month && (named ? short(MONTHS[month], options.month) : digits(month + 1, options.month)),
        options.day && digits(day, options.day),
        options.year && digits(year, options.year),
      ];
      const [m, d, y] = parts;
      text = named ? [[m, d].filter(Boolean).join(' '), y].filter(Boolean).join(d ? ', ' : ' ') : parts.filter(Boolean).join('/');
      if (options.weekday) text = [short(DAYS[get('Day')], options.weekday), text].filter(Boolean).join(', ');
    }
    return wants === 'date' ? text : `${text}, ${time}`;
  };
  if (typeof globalThis.Intl === 'undefined') {
    Number.prototype.toLocaleString = localeNumber;
    NativeDate.prototype.constructor = DateProxy;
    globalThis.Date = DateProxy;
    NativeDate.prototype.toLocaleDateString = function (locales, options) {
      return localeDate(this, 'date', locales, options);
    };
    NativeDate.prototype.toLocaleTimeString = function (locales, options) {
      return localeDate(this, 'time', locales, options);
    };
    NativeDate.prototype.toLocaleString = function (locales, options) {
      return localeDate(this, 'both', locales, options);
    };
    String.prototype.localeCompare = localeCompare;
    BigInt.prototype.toLocaleString = function () {
      return String(this).replace(/\d+/, group);
    };
  }

  // ---- util, assert, events, vm ----
  const format = (first, ...rest) => {
    if (typeof first !== 'string') return [first, ...rest].map(show).join(' ');
    const text = first.replace(/%([sdifjoO%])/g, (found, kind) => {
      if (kind === '%') return '%';
      if (!rest.length) return found;
      const value = rest.shift();
      if (kind === 's') return typeof value === 'object' && value !== null ? show(value) : String(value);
      if (kind === 'd') return String(Number(value));
      if (kind === 'i') return String(parseInt(value, 10));
      if (kind === 'f') return String(parseFloat(value));
      return JSON.stringify(value);
    });
    return [text, ...rest.map(show)].join(' ');
  };
  const alike = (a, b, strict) => {
    if (strict ? Object.is(a, b) : a == b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (strict && Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
    if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
    if (a instanceof Map || a instanceof Set) return a.size === b.size && alike([...a], [...b], strict);
    const names = Object.keys(a);
    return Array.isArray(a) === Array.isArray(b) && names.length === Object.keys(b).length && names.every((name) => name in b && alike(a[name], b[name], strict));
  };
  class AssertionError extends Error {
    constructor(message) {
      super(message);
      this.name = 'AssertionError';
      this.code = 'ERR_ASSERTION';
    }
  }
  const asserts = (strict) => {
    const check = (ok, message, fallback) => {
      if (ok) return;
      throw message instanceof Error ? message : new AssertionError(message === undefined ? fallback() : message);
    };
    const assert = (value, message) => check(value, message, () => 'The expression evaluated to a falsy value');
    const same = (a, b) => (strict ? Object.is(a, b) : a == b);
    return Object.assign(assert, {
      AssertionError,
      ok: assert,
      equal: (a, b, message) => check(same(a, b), message, () => `${show(a)} ${strict ? '!==' : '!='} ${show(b)}`),
      notEqual: (a, b, message) => check(!same(a, b), message, () => `${show(a)} ${strict ? '===' : '=='} ${show(b)}`),
      strictEqual: (a, b, message) => check(Object.is(a, b), message, () => `${show(a)} !== ${show(b)}`),
      notStrictEqual: (a, b, message) => check(!Object.is(a, b), message, () => `${show(a)} === ${show(b)}`),
      deepEqual: (a, b, message) => check(alike(a, b, strict), message, () => `${show(a)} does not deep-equal ${show(b)}`),
      deepStrictEqual: (a, b, message) => check(alike(a, b, true), message, () => `${show(a)} does not deep-equal ${show(b)}`),
      notDeepStrictEqual: (a, b, message) => check(!alike(a, b, true), message, () => `${show(a)} deep-equals ${show(b)}`),
      match: (text, pattern, message) => check(pattern.test(text), message, () => `${show(text)} does not match ${pattern}`),
      fail: (message) => check(false, message, () => 'Failed'),
      throws: (run, expected, message) => {
        try {
          run();
        } catch (error) {
          return;
        }
        check(false, typeof expected === 'string' ? expected : message, () => 'Missing expected exception.');
      },
    });
  };
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
    removeAllListeners(name) {
      if (name === undefined) this.#heard.clear();
      else this.#heard.delete(name);
      return this;
    }
    listenerCount(name) {
      return (this.#heard.get(name) || []).length;
    }
    listeners(name) {
      return (this.#heard.get(name) || []).map((listener) => listener.listener || listener);
    }
    eventNames() {
      return [...this.#heard.keys()];
    }
    setMaxListeners() {
      return this;
    }
  }
  EventEmitter.prototype.addListener = EventEmitter.prototype.on;
  EventEmitter.prototype.removeListener = EventEmitter.prototype.off;
  EventEmitter.EventEmitter = EventEmitter;
  // vm: code sees the context object's properties and the language's own
  // globals, not this module's `process`, `Buffer` or `console`.
  const hidden = new Set(['global', 'console', 'process', 'Buffer', 'setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'atob', 'btoa', 'structuredClone', 'queueMicrotask', 'AbortController', 'performance']);
  const evaluate = new Function('__elephant_scope__', '__elephant_code__', 'with (__elephant_scope__) { return eval(__elephant_code__); }');
  const within = (code, context = {}) =>
    evaluate(
      new Proxy(context, {
        has: (target, name) => name in target || hidden.has(name),
        get: (target, name) => (name === Symbol.unscopables ? undefined : target[name]),
      }),
      String(code)
    );
  const vm = {
    runInNewContext: within,
    runInContext: within,
    runInThisContext: (code) => (0, eval)(String(code)),
    createContext: (context = {}) => context,
    isContext: (context) => typeof context === 'object' && context !== null,
    Script: class Script {
      constructor(code) {
        this.code = String(code);
      }
      runInNewContext(context) {
        return within(this.code, context);
      }
      runInContext(context) {
        return within(this.code, context);
      }
      runInThisContext() {
        return (0, eval)(this.code);
      }
    },
  };
  const clone = (value, seen = new Map()) => {
    if (typeof value !== 'object' || value === null) return value;
    if (seen.has(value)) return seen.get(value);
    if (value instanceof Date) return new Date(value.getTime());
    if (value instanceof RegExp) return new RegExp(value.source, value.flags);
    if (ArrayBuffer.isView(value)) return value.slice();
    const made = value instanceof Map ? new Map() : value instanceof Set ? new Set() : Array.isArray(value) ? [] : {};
    seen.set(value, made);
    if (value instanceof Map) for (const [key, item] of value) made.set(clone(key, seen), clone(item, seen));
    else if (value instanceof Set) for (const item of value) made.add(clone(item, seen));
    else for (const name of Object.keys(value)) made[name] = clone(value[name], seen);
    return made;
  };
  class AbortController_ {
    signal = Object.assign(new EventEmitter(), {
      aborted: false,
      reason: undefined,
      addEventListener(name, listener) {
        this.once(name, listener);
      },
      removeEventListener(name, listener) {
        this.off(name, listener);
      },
      throwIfAborted() {
        if (this.aborted) throw this.reason;
      },
    });
    abort(reason = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })) {
      if (this.signal.aborted) return;
      Object.assign(this.signal, { aborted: true, reason });
      this.signal.emit('abort', { type: 'abort' });
    }
  }

  // ---- CommonJS ----
  const builtins = {
    fs,
    'fs/promises': fs.promises,
    path,
    process,
    buffer: { Buffer },
    os: { EOL: '\n', tmpdir: () => host.cwd, platform: () => 'linux', homedir: () => host.cwd, cpus: () => [{}] },
    url: { URL: URL_, URLSearchParams: URLSearchParams_, fileURLToPath, pathToFileURL: (file) => new URL_(`file://${path.resolve(file).replace(/[%?#]/g, encodeURIComponent)}`) },
    querystring: {
      escape: encodeURIComponent,
      unescape,
      stringify: (record) =>
        Object.keys(record || {})
          .flatMap((name) => [].concat(record[name]).map((value) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`))
          .join('&'),
      parse: (text) => {
        const record = {};
        for (const [name, value] of new URLSearchParams_(String(text))) record[name] = name in record ? [].concat(record[name], value) : value;
        return record;
      },
    },
    util: {
      inspect: show,
      format,
      promisify: (fn) => (...args) => new Promise((resolve, reject) => fn(...args, (error, value) => (error ? reject(error) : resolve(value)))),
      inherits: (child, parent) => Object.setPrototypeOf(child.prototype, parent.prototype),
      isDeepStrictEqual: (a, b) => alike(a, b, true),
      types: { isDate: (value) => value instanceof Date, isRegExp: (value) => value instanceof RegExp, isPromise: (value) => value instanceof Promise },
      TextEncoder: TextEncoder_,
      TextDecoder: TextDecoder_,
    },
    assert: asserts(false),
    'assert/strict': asserts(true),
    events: EventEmitter,
    vm,
    timers: { setTimeout: schedule(false), setInterval: schedule(true), setImmediate: immediately, clearTimeout: cancel, clearInterval: cancel, clearImmediate: cancel },
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
    setImmediate: immediately,
    clearTimeout: cancel,
    clearInterval: cancel,
    clearImmediate: cancel,
  });
  if (typeof globalThis.URL === 'undefined') Object.assign(globalThis, { URL: URL_, URLSearchParams: URLSearchParams_ });
  if (typeof globalThis.queueMicrotask === 'undefined') globalThis.queueMicrotask = (fn) => void Promise.resolve().then(fn);
  const offered = {
    structuredClone: (value) => clone(value),
    TextEncoder: TextEncoder_,
    TextDecoder: TextDecoder_,
    AbortController: AbortController_,
    atob: (text) => single(host.base64Decode(String(text)), 255),
    btoa: (text) => host.base64Encode(Buffer.from(String(text), 'latin1')),
    performance: { now: () => host.now() - started, timeOrigin: started },
  };
  for (const name of Object.keys(offered)) if (typeof globalThis[name] === 'undefined') globalThis[name] = offered[name];

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
