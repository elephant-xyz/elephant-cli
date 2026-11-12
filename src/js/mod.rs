//! County JavaScript on QuickJS (through rquickjs, the binding AWS LLRT uses).
//!
//! A script runs as it would as a Node program: CommonJS or ES module, with
//! the built-ins in `node.js` (`fs`, `path`, `process`, `console`, `Buffer`,
//! timers) and `cheerio`. Unlike under Node, it can only read and write
//! inside the directory it is given, has no network, and is stopped at its
//! deadline.

use rquickjs::context::EvalOptions;
use rquickjs::loader::{ImportAttributes, Loader, Resolver};
use rquickjs::module::Declared;
use rquickjs::promise::PromiseState;
use rquickjs::{Context, Ctx, Exception, Function, Module, Object, Promise, Runtime, TypedArray, Value};
use std::cell::{Cell, RefCell};
use std::path::{Component, Path, PathBuf};
use std::rc::Rc;
use std::time::{Duration, Instant};

const NODE: &str = include_str!("node.js");
/// cheerio 1.1.2 (MIT), its browser build bundled into one CommonJS file by `scripts/bundle-cheerio.sh`.
const CHEERIO: &str = include_str!("../../assets/cheerio.js");

/// Where a script may read and write, and for how long it may run.
pub struct Sandbox {
    /// Nothing outside this directory is visible to the script.
    pub root: PathBuf,
    /// What `process.cwd()` returns and relative paths resolve against; inside `root`.
    pub cwd: PathBuf,
    pub timeout: Duration,
}

#[derive(Default, Debug)]
pub struct Ran {
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug)]
pub struct Failed {
    /// The exit code: 1 for an uncaught error, -1 when stopped at the deadline.
    pub code: i32,
    pub timed_out: bool,
    pub stdout: String,
    pub stderr: String,
}

/// The path, if it stays inside `root` once `.` and `..` are resolved.
fn inside(root: &Path, text: &str) -> Option<PathBuf> {
    let mut kept = PathBuf::new();
    for part in Path::new(text).components() {
        match part {
            Component::ParentDir => {
                kept.pop();
            }
            Component::CurDir => {}
            other => kept.push(other),
        }
    }
    kept.starts_with(root).then_some(kept)
}

/// A failure as Node words it: `CODE: text, call 'path'`.
fn refuse(ctx: &Ctx<'_>, error: &std::io::Error, call: &str, path: &str) -> rquickjs::Error {
    use std::io::ErrorKind as Kind;
    let (code, text) = match error.kind() {
        Kind::NotFound => ("ENOENT", "no such file or directory"),
        Kind::AlreadyExists => ("EEXIST", "file already exists"),
        Kind::PermissionDenied => ("EACCES", "permission denied"),
        Kind::NotADirectory => ("ENOTDIR", "not a directory"),
        Kind::IsADirectory => ("EISDIR", "illegal operation on a directory"),
        Kind::DirectoryNotEmpty => ("ENOTEMPTY", "directory not empty"),
        _ => ("EIO", "i/o error"),
    };
    Exception::throw_message(ctx, &format!("{code}: {text}, {call} '{path}'"))
}

/// Resolve a path the script named, or throw as Node does for a path it may not touch.
fn reach(ctx: &Ctx<'_>, root: &Path, call: &str, path: &str) -> rquickjs::Result<PathBuf> {
    inside(root, path).ok_or_else(|| Exception::throw_message(ctx, &format!("EACCES: permission denied, {call} '{path}'")))
}

fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let word = chunk.iter().fold(0u32, |word, byte| word << 8 | u32::from(*byte)) << (8 * (3 - chunk.len()));
        for at in 0..4 {
            match at <= chunk.len() {
                true => out.push(ALPHABET[(word >> (18 - 6 * at) & 63) as usize] as char),
                false => out.push('='),
            }
        }
    }
    out
}

fn unbase64(text: &str) -> Vec<u8> {
    let mut out = Vec::new();
    let mut word = 0u32;
    let mut bits = 0;
    for byte in text.bytes() {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            _ => continue,
        };
        word = word << 6 | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((word >> bits) as u8);
        }
    }
    out
}

/// The bytes of a typed array a script passed in.
fn bytes_of<'a>(array: &'a TypedArray<'_, u8>) -> &'a [u8] {
    // SAFETY: the slice is read before control returns to JavaScript, so the
    // buffer cannot be detached or resized while it is borrowed.
    unsafe { array.as_bytes() }.unwrap_or(&[])
}

/// What was thrown, as Node would print an uncaught error.
fn thrown<'js>(ctx: &Ctx<'js>, host: Option<&Object<'js>>, error: &rquickjs::Error) -> String {
    let value = ctx.catch();
    let describe = host.and_then(|host| host.get::<_, Function<'js>>("describe").ok());
    let described = describe.and_then(|describe| describe.call::<_, String>((value.clone(),)).ok());
    described.unwrap_or_else(|| format!("{error}: {value:?}"))
}

/// Whether source text is an ES module, the way Node guesses for a `.js` file: by `import`/`export` statements.
fn module(source: &str) -> bool {
    source.lines().any(|line| {
        let line = line.trim_start();
        let import = line.strip_prefix("import").is_some_and(|rest| rest.starts_with([' ', '{', '*', '"', '\'']));
        let export = line.strip_prefix("export").is_some_and(|rest| rest.starts_with([' ', '{', '*']));
        import || export
    })
}

/// ES module names: built-ins by name, files by their path inside the sandbox.
struct Files {
    root: PathBuf,
}

impl Resolver for Files {
    fn resolve<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        base: &str,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<String> {
        if !name.starts_with('.') && !name.starts_with('/') {
            return Ok(name.strip_prefix("node:").unwrap_or(name).to_string());
        }
        let from = Path::new(base).parent().unwrap_or(Path::new("/"));
        let wanted = from.join(name).to_string_lossy().into_owned();
        for candidate in [wanted.clone(), format!("{wanted}.js"), format!("{wanted}.mjs"), format!("{wanted}/index.js")] {
            if inside(&self.root, &candidate).is_some_and(|file| file.is_file()) {
                return Ok(inside(&self.root, &candidate).expect("just checked").to_string_lossy().into_owned());
            }
        }
        Err(Exception::throw_message(ctx, &format!("Cannot find module '{name}' imported from {base}")))
    }
}

impl Loader for Files {
    fn load<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<Module<'js, Declared>> {
        if name.starts_with('/') {
            let source = std::fs::read_to_string(name).map_err(|error| refuse(ctx, &error, "open", name))?;
            return Module::declare(ctx.clone(), name, source);
        }
        // A built-in: its CommonJS exports, re-exported by name.
        let host: Object = ctx.globals().get("__host")?;
        let found: Value = host.get::<_, Function>("builtin")?.call((name,))?;
        let Some(exports) = found.as_object() else {
            return Err(Exception::throw_message(ctx, &format!("Cannot find package '{name}'")));
        };
        let names: Vec<String> = exports.keys::<String>().flatten().collect();
        let plain = |name: &&String| {
            !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$') && *name != "default"
        };
        let named: Vec<&String> = names.iter().filter(plain).collect();
        let listed: Vec<String> = named.iter().map(|name| format!("export const {name} = __module.{name};")).collect();
        let source = format!(
            "const __module = globalThis.__host.builtin({});\nexport default __module;\n{}",
            serde_json::Value::String(name.to_string()),
            listed.join("\n")
        );
        Module::declare(ctx.clone(), name, source)
    }
}

/// What a run is asked to do once the built-ins are in place.
pub enum Start<'a> {
    /// Run a file as the program.
    Script(&'a Path),
    /// Load a module and pass its exports, and a `call(name, ...args)` into the
    /// bridge, to `entry`: the source text of a JavaScript function.
    Call { file: &'a Path, entry: &'a str },
}

/// Functions a caller offers to JavaScript: called with a name and JSON arguments, answering with JSON.
pub type Bridge<'a> = &'a mut dyn FnMut(&str, serde_json::Value) -> Result<serde_json::Value, String>;

pub fn run(start: Start<'_>, sandbox: &Sandbox, bridge: Option<Bridge<'_>>) -> Result<Ran, Failed> {
    let out = Rc::new(RefCell::new(Ran::default()));
    let exit: Rc<Cell<Option<i32>>> = Rc::new(Cell::new(None));
    let unhandled: Rc<RefCell<Vec<String>>> = Rc::new(RefCell::new(Vec::new()));
    let limit = Rc::new(Cell::new(Instant::now() + sandbox.timeout));
    let failed = |code: i32, timed_out: bool, text: String| {
        let mut out = out.borrow_mut();
        if !text.is_empty() {
            out.stderr.push_str(&text);
            out.stderr.push('\n');
        }
        Failed { code, timed_out, stdout: std::mem::take(&mut out.stdout), stderr: std::mem::take(&mut out.stderr) }
    };
    let broken = |error: rquickjs::Error| failed(1, false, format!("JavaScript engine error: {error}"));
    let runtime = Runtime::new().map_err(broken)?;
    runtime.set_memory_limit(2 << 30);
    runtime.set_max_stack_size(8 << 20);
    let stop = limit.clone();
    runtime.set_interrupt_handler(Some(Box::new(move || Instant::now() > stop.get())));
    runtime.set_loader(Files { root: sandbox.root.clone() }, Files { root: sandbox.root.clone() });
    let rejections = unhandled.clone();
    runtime.set_host_promise_rejection_tracker(Some(Box::new(move |_ctx, _promise, reason, handled| {
        let mut waiting = rejections.borrow_mut();
        if handled {
            waiting.pop();
            return;
        }
        let described = reason
            .as_exception()
            .map(|error| format!("{}\n{}", error.message().unwrap_or_default(), error.stack().unwrap_or_default()))
            .unwrap_or_else(|| format!("{reason:?}"));
        waiting.push(described);
    })));
    let context = Context::full(&runtime).map_err(broken)?;
    // The bridge lives on this stack frame; JavaScript reaches it only while `run` is on it.
    let bridge: Rc<RefCell<Option<Bridge<'_>>>> = Rc::new(RefCell::new(bridge));
    let bridge: Rc<RefCell<Option<Bridge<'static>>>> = unsafe { std::mem::transmute(bridge) };

    let outcome = context.with(|ctx| -> Result<(), Failed> {
        let fail = |described: String| -> Failed {
            if Instant::now() > limit.get() {
                return failed(-1, true, format!("[runner] Stopped after {}ms: the time limit was reached.", sandbox.timeout.as_millis()));
            }
            match exit.get() {
                Some(code) => failed(code, false, String::new()),
                None => failed(1, false, described),
            }
        };
        let host = build(&ctx, sandbox, &out, &exit, &limit, &bridge, &start).map_err(|error| fail(thrown(&ctx, None, &error)))?;
        let started = match &start {
            Start::Script(file) => {
                let name = file.to_string_lossy().into_owned();
                let source = std::fs::read_to_string(file).map_err(|error| failed(1, false, format!("{name}: {error}")))?;
                match module(&source) {
                    true => Module::evaluate(ctx.clone(), name, source).map(Some),
                    false => host.get::<_, Function>("main").and_then(|main| main.call::<_, Value>((name,))).map(|_| None),
                }
            }
            Start::Call { file, entry } => {
                let name = file.to_string_lossy().into_owned();
                let source = std::fs::read_to_string(file).map_err(|error| failed(1, false, format!("{name}: {error}")))?;
                let invoke = host.get::<_, Function>("invoke");
                invoke.and_then(|invoke| invoke.call::<_, Promise>((name, *entry, module(&source)))).map(Some)
            }
        };
        let promise = match started {
            Ok(promise) => promise,
            Err(_) if exit.get() == Some(0) => return Ok(()),
            Err(error) => return Err(fail(thrown(&ctx, Some(&host), &error))),
        };
        // The event loop: promise jobs, then timers, until nothing is left to run.
        let timers: Function = host.get("timers").map_err(|error| fail(thrown(&ctx, Some(&host), &error)))?;
        loop {
            while ctx.execute_pending_job() {}
            if let Some(code) = exit.get() {
                return if code == 0 { Ok(()) } else { Err(failed(code, false, String::new())) };
            }
            let wait: f64 = timers.call(()).map_err(|error| fail(thrown(&ctx, Some(&host), &error)))?;
            if ctx.execute_pending_job() {
                continue;
            }
            if Instant::now() > limit.get() {
                return Err(failed(-1, true, format!("[runner] Stopped after {}ms: the time limit was reached.", sandbox.timeout.as_millis())));
            }
            if wait < 0.0 {
                break;
            }
            std::thread::sleep(Duration::from_secs_f64(wait / 1000.0).min(limit.get().saturating_duration_since(Instant::now())));
        }
        if let Some(promise) = promise {
            match promise.state() {
                PromiseState::Resolved => {}
                PromiseState::Pending => return Err(failed(1, false, "The script stopped without finishing: a promise it awaits never settles.".to_string())),
                PromiseState::Rejected => {
                    let error = promise.result::<Value>().and_then(Result::err).unwrap_or(rquickjs::Error::Unknown);
                    return Err(fail(thrown(&ctx, Some(&host), &error)));
                }
            }
        }
        // As `node --unhandled-rejections=strict`: a rejection nobody handles fails the run.
        if let Some(reason) = unhandled.borrow().first() {
            return Err(failed(1, false, format!("Unhandled promise rejection: {reason}")));
        }
        Ok(())
    });
    drop(context);
    drop(runtime);
    outcome?;
    let ran = std::mem::take(&mut *out.borrow_mut());
    Ok(ran)
}

/// Install the host functions and the Node built-ins; returns the host object.
fn build<'js>(
    ctx: &Ctx<'js>,
    sandbox: &Sandbox,
    out: &Rc<RefCell<Ran>>,
    exit: &Rc<Cell<Option<i32>>>,
    limit: &Rc<Cell<Instant>>,
    bridge: &Rc<RefCell<Option<Bridge<'static>>>>,
    start: &Start<'_>,
) -> rquickjs::Result<Object<'js>> {
    let host = Object::new(ctx.clone())?;
    let entry = match start {
        Start::Script(file) | Start::Call { file, .. } => file.to_string_lossy().into_owned(),
    };
    host.set("cwd", sandbox.cwd.to_string_lossy().into_owned())?;
    host.set("entry", entry)?;
    let begun = Instant::now();
    let clock = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs_f64() * 1000.0;
    host.set("now", Function::new(ctx.clone(), move || clock + begun.elapsed().as_secs_f64() * 1000.0)?)?;
    host.set("cheerio", Function::new(ctx.clone(), || CHEERIO)?)?;
    let streams = out.clone();
    host.set(
        "print",
        Function::new(ctx.clone(), move |stream: i32, text: String| {
            let mut out = streams.borrow_mut();
            match stream {
                1 => out.stdout.push_str(&text),
                _ => out.stderr.push_str(&text),
            }
        })?,
    )?;
    let code = exit.clone();
    host.set("exit", Function::new(ctx.clone(), move |status: i32| code.set(Some(status)))?)?;
    // A script may shorten its own deadline, never extend it.
    let stop = limit.clone();
    host.set(
        "limit",
        Function::new(ctx.clone(), move |milliseconds: f64| {
            stop.set(stop.get().min(Instant::now() + Duration::from_secs_f64(milliseconds.max(0.0) / 1000.0)));
        })?,
    )?;
    host.set(
        "sha256",
        Function::new(ctx.clone(), |ctx: Ctx<'js>, bytes: TypedArray<'js, u8>| {
            TypedArray::<u8>::new(ctx, <sha2::Sha256 as sha2::Digest>::digest(bytes_of(&bytes)).to_vec())
        })?,
    )?;
    host.set(
        "sha512",
        Function::new(ctx.clone(), |ctx: Ctx<'js>, bytes: TypedArray<'js, u8>| {
            TypedArray::<u8>::new(ctx, <sha2::Sha512 as sha2::Digest>::digest(bytes_of(&bytes)).to_vec())
        })?,
    )?;
    host.set(
        "compile",
        Function::new(ctx.clone(), |ctx: Ctx<'js>, body: String, file: String| -> rquickjs::Result<Function<'js>> {
            let mut options = EvalOptions::default();
            options.strict = false;
            options.filename = Some(file);
            ctx.eval_with_options(body, options)
        })?,
    )?;
    host.set("utf8Encode", Function::new(ctx.clone(), |ctx: Ctx<'js>, text: String| TypedArray::<u8>::new(ctx, text.into_bytes()))?)?;
    host.set(
        "utf8Decode",
        Function::new(ctx.clone(), |bytes: TypedArray<'js, u8>| String::from_utf8_lossy(bytes_of(&bytes)).into_owned())?,
    )?;
    host.set("base64Encode", Function::new(ctx.clone(), |bytes: TypedArray<'js, u8>| base64(bytes_of(&bytes)))?)?;
    host.set("base64Decode", Function::new(ctx.clone(), |ctx: Ctx<'js>, text: String| TypedArray::<u8>::new(ctx, unbase64(&text)))?)?;

    // The file system, confined to the sandbox root.
    let root = sandbox.root.clone();
    host.set("exists", Function::new(ctx.clone(), move |path: String| inside(&root, &path).is_some_and(|path| path.exists()))?)?;
    let root = sandbox.root.clone();
    host.set("isFile", Function::new(ctx.clone(), move |path: String| inside(&root, &path).is_some_and(|path| path.is_file()))?)?;
    let root = sandbox.root.clone();
    host.set(
        "stat",
        Function::new(ctx.clone(), move |ctx: Ctx<'js>, path: String| -> rquickjs::Result<Object<'js>> {
            let found = std::fs::metadata(reach(&ctx, &root, "stat", &path)?).map_err(|error| refuse(&ctx, &error, "stat", &path))?;
            let info = Object::new(ctx.clone())?;
            info.set("kind", if found.is_dir() { "dir" } else { "file" })?;
            info.set("size", found.len() as f64)?;
            let changed = found.modified().ok().and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok());
            info.set("mtime", changed.unwrap_or_default().as_secs_f64() * 1000.0)?;
            Ok(info)
        })?,
    )?;
    let root = sandbox.root.clone();
    host.set(
        "readText",
        Function::new(ctx.clone(), move |ctx: Ctx<'js>, path: String| -> rquickjs::Result<String> {
            let bytes = std::fs::read(reach(&ctx, &root, "open", &path)?).map_err(|error| refuse(&ctx, &error, "open", &path))?;
            Ok(String::from_utf8_lossy(&bytes).into_owned())
        })?,
    )?;
    let root = sandbox.root.clone();
    host.set(
        "readBytes",
        Function::new(ctx.clone(), move |ctx: Ctx<'js>, path: String| -> rquickjs::Result<TypedArray<'js, u8>> {
            let bytes = std::fs::read(reach(&ctx, &root, "open", &path)?).map_err(|error| refuse(&ctx, &error, "open", &path))?;
            TypedArray::<u8>::new(ctx, bytes)
        })?,
    )?;
    let root = sandbox.root.clone();
    host.set(
        "writeText",
        Function::new(ctx.clone(), move |ctx: Ctx<'js>, path: String, text: String, append: bool| -> rquickjs::Result<()> {
            let file = reach(&ctx, &root, "open", &path)?;
            let written = match append {
                true => std::fs::OpenOptions::new().create(true).append(true).open(&file).and_then(|mut file| std::io::Write::write_all(&mut file, text.as_bytes())),
                false => std::fs::write(&file, text),
            };
            written.map_err(|error| refuse(&ctx, &error, "open", &path))
        })?,
    )?;
    let root = sandbox.root.clone();
    host.set(
        "writeBytes",
        Function::new(ctx.clone(), move |ctx: Ctx<'js>, path: String, bytes: TypedArray<'js, u8>| -> rquickjs::Result<()> {
            let file = reach(&ctx, &root, "open", &path)?;
            std::fs::write(file, bytes_of(&bytes)).map_err(|error| refuse(&ctx, &error, "open", &path))
        })?,
    )?;
    let root = sandbox.root.clone();
    host.set(
        "mkdir",
        Function::new(ctx.clone(), move |ctx: Ctx<'js>, path: String, recursive: bool| -> rquickjs::Result<()> {
            let dir = reach(&ctx, &root, "mkdir", &path)?;
            let made = if recursive { std::fs::create_dir_all(dir) } else { std::fs::create_dir(dir) };
            made.map_err(|error| refuse(&ctx, &error, "mkdir", &path))
        })?,
    )?;
    let root = sandbox.root.clone();
    host.set(
        "list",
        Function::new(ctx.clone(), move |ctx: Ctx<'js>, path: String| -> rquickjs::Result<Vec<String>> {
            let entries = std::fs::read_dir(reach(&ctx, &root, "scandir", &path)?).map_err(|error| refuse(&ctx, &error, "scandir", &path))?;
            let mut names: Vec<String> = entries.flatten().map(|entry| entry.file_name().to_string_lossy().into_owned()).collect();
            names.sort();
            Ok(names)
        })?,
    )?;
    let root = sandbox.root.clone();
    host.set(
        "remove",
        Function::new(ctx.clone(), move |ctx: Ctx<'js>, path: String, recursive: bool, force: bool| -> rquickjs::Result<()> {
            let target = reach(&ctx, &root, "unlink", &path)?;
            let removed = match (target.is_dir(), recursive) {
                (true, true) => std::fs::remove_dir_all(&target),
                (true, false) => std::fs::remove_dir(&target),
                _ => std::fs::remove_file(&target),
            };
            match removed {
                Err(error) if !(force && error.kind() == std::io::ErrorKind::NotFound) => Err(refuse(&ctx, &error, "unlink", &path)),
                _ => Ok(()),
            }
        })?,
    )?;
    let root = sandbox.root.clone();
    host.set(
        "rename",
        Function::new(ctx.clone(), move |ctx: Ctx<'js>, from: String, to: String| -> rquickjs::Result<()> {
            let (source, target) = (reach(&ctx, &root, "rename", &from)?, reach(&ctx, &root, "rename", &to)?);
            std::fs::rename(source, target).map_err(|error| refuse(&ctx, &error, "rename", &from))
        })?,
    )?;
    let offered = bridge.clone();
    host.set(
        "call",
        Function::new(ctx.clone(), move |ctx: Ctx<'js>, name: String, arguments: String| -> rquickjs::Result<String> {
            let arguments = serde_json::from_str(&arguments).unwrap_or(serde_json::Value::Null);
            let mut offered = offered.borrow_mut();
            let Some(bridge) = offered.as_mut() else {
                return Err(Exception::throw_message(&ctx, &format!("{name} is not available here")));
            };
            bridge(&name, arguments).map(|answer| answer.to_string()).map_err(|reason| Exception::throw_message(&ctx, &reason))
        })?,
    )?;
    ctx.globals().set("__host", host.clone())?;
    let install: Function = ctx.eval(NODE)?;
    install.call::<_, ()>((host.clone(),))?;
    Ok(host)
}
