//! A headless browser, driven over the Chrome DevTools Protocol.
//!
//! By default this starts the obscura browser (`obscura serve`) as a child
//! process and talks to it over a local WebSocket; `--cdp-url` attaches to a
//! browser that is already running instead (obscura or Chrome). One page is
//! used per run. Page interaction goes through JavaScript in the page and
//! key events, which works the same with or without a rendering engine.

use crate::Fail;
use serde_json::{json, Value};
use std::io::ErrorKind;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket};

/// How to get a browser.
#[derive(Default, Clone)]
pub struct Launch {
    /// The obscura binary; `OBSCURA_BIN`, then `obscura` on `PATH`, when not given.
    pub binary: Option<PathBuf>,
    /// The WebSocket URL of a running browser's DevTools endpoint, to attach to instead.
    pub endpoint: Option<String>,
    /// `http://user:password@host:port`, or the older `user:password@host:port`.
    pub proxy: Option<String>,
}

/// A wait that ran out of time. Flows branch on it; everything else is a failure.
#[derive(Debug)]
pub struct Timeout(pub String);

impl std::fmt::Display for Timeout {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Timeout {}

pub struct Browser {
    child: Option<Child>,
    socket: WebSocket<MaybeTlsStream<TcpStream>>,
    session: String,
    sent: u64,
    /// Events received while waiting for something else, oldest first.
    events: Vec<Value>,
    /// Main-frame navigations seen so far.
    pub navigations: u64,
}

const MISSING: &str = "the obscura browser was not found. Install it from https://github.com/h4ckf0r0day/obscura/releases and put `obscura` on PATH, name it with --browser or OBSCURA_BIN, or attach to a running browser with --cdp-url";

impl Browser {
    pub fn start(launch: &Launch) -> Result<Browser, Fail> {
        let (child, endpoint) = match &launch.endpoint {
            Some(endpoint) => (None, endpoint.clone()),
            None => {
                let binary = launch.binary.clone().or_else(|| std::env::var_os("OBSCURA_BIN").map(PathBuf::from));
                let binary = binary.unwrap_or_else(|| PathBuf::from("obscura"));
                // a free port, then a file obscura writes once it listens
                let port = std::net::TcpListener::bind("127.0.0.1:0")?.local_addr()?.port();
                let ready = std::env::temp_dir().join(format!("elephant-obscura-{}-{port}.json", std::process::id()));
                let _ = std::fs::remove_file(&ready);
                let mut command = Command::new(&binary);
                command.arg("serve").arg("--port").arg(port.to_string()).arg("--ready-file").arg(&ready);
                if let Some(proxy) = &launch.proxy {
                    command.arg("--proxy").arg(if proxy.contains("://") { proxy.clone() } else { format!("http://{proxy}") });
                }
                let spawned = command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn();
                let mut child = spawned.map_err(|error| match error.kind() {
                    ErrorKind::NotFound => format!("{}: {MISSING}", binary.display()),
                    _ => format!("cannot start {}: {error}", binary.display()),
                })?;
                let began = Instant::now();
                while !ready.is_file() {
                    if let Some(status) = child.try_wait()? {
                        return Err(format!("{} stopped at once ({status})", binary.display()).into());
                    }
                    if began.elapsed() > Duration::from_secs(30) {
                        let _ = child.kill();
                        return Err(format!("{} did not start listening within 30 seconds", binary.display()).into());
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
                let told: Value = serde_json::from_slice(&std::fs::read(&ready)?).unwrap_or(Value::Null);
                let _ = std::fs::remove_file(&ready);
                let path = told["websocket_path"].as_str().unwrap_or("/devtools/browser");
                (Some(child), format!("ws://127.0.0.1:{port}{path}"))
            }
        };
        let connected =
            tungstenite::connect(&endpoint).map_err(|error| format!("cannot connect to the browser at {endpoint}: {error}"));
        let (socket, _) = match connected {
            Ok(connected) => connected,
            Err(error) => {
                if let Some(mut child) = child {
                    let _ = child.kill();
                }
                return Err(error.into());
            }
        };
        let mut browser = Browser { child, socket, session: String::new(), sent: 0, events: Vec::new(), navigations: 0 };
        let target = browser.call("Target.createTarget", json!({ "url": "about:blank" }))?;
        let attached = browser.call("Target.attachToTarget", json!({ "targetId": target["targetId"], "flatten": true }))?;
        browser.session = attached["sessionId"].as_str().ok_or("the browser gave no session")?.to_string();
        for domain in ["Page.enable", "Runtime.enable", "Network.enable"] {
            browser.call(domain, json!({}))?;
        }
        Ok(browser)
    }

    /// Read one message, waiting at most `within`. `None` when nothing came.
    fn read(&mut self, within: Duration) -> Result<Option<Value>, Fail> {
        if let MaybeTlsStream::Plain(stream) = self.socket.get_mut() {
            stream.set_read_timeout(Some(within.max(Duration::from_millis(1))))?;
        }
        match self.socket.read() {
            Ok(Message::Text(text)) => Ok(Some(serde_json::from_str(text.as_str())?)),
            Ok(_) => Ok(None),
            Err(tungstenite::Error::Io(error)) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => Ok(None),
            Err(error) => Err(format!("the browser connection failed: {error}").into()),
        }
    }

    fn note(&mut self, event: Value) {
        let main = event["method"] == "Page.frameNavigated" && event["params"]["frame"]["parentId"].is_null();
        if main {
            self.navigations += 1;
        }
        self.events.push(event);
    }

    /// Take in whatever the browser has sent, without waiting for more.
    pub fn pump(&mut self, within: Duration) -> Result<(), Fail> {
        let until = Instant::now() + within;
        loop {
            let left = until.saturating_duration_since(Instant::now());
            match self.read(left)? {
                Some(event) => self.note(event),
                None if left.is_zero() => return Ok(()),
                None => {}
            }
            if Instant::now() >= until {
                return Ok(());
            }
        }
    }

    /// Send one command and wait for its answer.
    pub fn call(&mut self, method: &str, params: Value) -> Result<Value, Fail> {
        self.sent += 1;
        let id = self.sent;
        let mut command = json!({ "id": id, "method": method, "params": params });
        if !self.session.is_empty() {
            command["sessionId"] = json!(self.session);
        }
        self.socket.send(Message::Text(command.to_string().into()))?;
        let until = Instant::now() + Duration::from_secs(120);
        loop {
            let Some(message) = self.read(until.saturating_duration_since(Instant::now()))? else {
                if Instant::now() >= until {
                    return Err(format!("the browser did not answer {method} within 120 seconds").into());
                }
                continue;
            };
            if message["id"].as_u64() != Some(id) {
                self.note(message);
                continue;
            }
            if let Some(problem) = message.get("error") {
                return Err(format!("{method} failed: {}", problem["message"].as_str().unwrap_or("unknown error")).into());
            }
            return Ok(message["result"].clone());
        }
    }

    /// Evaluate an expression in the page and return its JSON value; a promise is awaited.
    pub fn evaluate(&mut self, expression: &str) -> Result<Value, Fail> {
        let params = json!({ "expression": expression, "returnByValue": true, "awaitPromise": true, "userGesture": true });
        let answer = self.call("Runtime.evaluate", params)?;
        if let Some(thrown) = answer.get("exceptionDetails") {
            let described = thrown["exception"]["description"].as_str().or(thrown["text"].as_str()).unwrap_or("the page threw");
            return Err(described.into());
        }
        Ok(answer["result"]["value"].clone())
    }

    /// Evaluate until the expression is truthy; a `Timeout` error when it never is.
    pub fn wait(&mut self, expression: &str, timeout: Duration, what: &str) -> Result<Value, Fail> {
        let until = Instant::now() + timeout;
        loop {
            // a page in the middle of a navigation has no context to evaluate in: try again
            let value = self.evaluate(expression).unwrap_or(Value::Null);
            let truthy = !matches!(&value, Value::Null | Value::Bool(false)) && value != json!(0) && value != json!("");
            if truthy {
                return Ok(value);
            }
            if Instant::now() >= until {
                return Err(Box::new(Timeout(format!("Waiting for {what} failed: {}ms exceeded", timeout.as_millis()))));
            }
            self.pump(Duration::from_millis(100))?;
        }
    }

    /// Wait for the document a navigation started to reach `until`: `domcontentloaded`,
    /// `load`, or `networkidle0`/`networkidle2` (no network events for half a second).
    pub fn settle(&mut self, until: &str, timeout: Duration) -> Result<(), Fail> {
        let ready = match until {
            "domcontentloaded" => "document.readyState !== 'loading'",
            _ => "document.readyState === 'complete'",
        };
        let began = Instant::now();
        self.wait(&format!("location.href !== 'about:blank' && {ready}"), timeout, "the page to load")?;
        if !until.starts_with("networkidle") {
            return Ok(());
        }
        loop {
            let before = self
                .events
                .iter()
                .filter(|event| event["method"].as_str().is_some_and(|method| method.starts_with("Network.")))
                .count();
            self.pump(Duration::from_millis(500))?;
            let after = self
                .events
                .iter()
                .filter(|event| event["method"].as_str().is_some_and(|method| method.starts_with("Network.")))
                .count();
            if after == before || began.elapsed() > timeout {
                return Ok(());
            }
        }
    }

    /// Navigate and wait for the page; returns the status of the document response when it was seen.
    pub fn goto(&mut self, target: &str, until: &str, timeout: Duration) -> Result<Option<(u16, String)>, Fail> {
        self.pump(Duration::ZERO)?;
        self.events.clear();
        let answer = self.call("Page.navigate", json!({ "url": target }))?;
        if let Some(problem) = answer["errorText"].as_str().filter(|problem| !problem.is_empty()) {
            return Err(format!("{problem} at {target}").into());
        }
        self.settle(until, timeout)?;
        let document = self
            .events
            .iter()
            .rev()
            .find(|event| event["method"] == "Network.responseReceived" && event["params"]["type"] == "Document");
        Ok(document.map(|event| {
            let response = &event["params"]["response"];
            (response["status"].as_u64().unwrap_or(0) as u16, response["statusText"].as_str().unwrap_or_default().to_string())
        }))
    }

    pub fn url(&mut self) -> Result<String, Fail> {
        Ok(self.evaluate("location.href")?.as_str().unwrap_or_default().to_string())
    }

    /// The page as HTML, doctype included.
    pub fn content(&mut self, root: &str) -> Result<String, Fail> {
        let expression = format!(
            "(() => {{ const page = {root}; if (!page) return null; const kind = page.doctype; const head = kind ? new XMLSerializer().serializeToString(kind) : ''; return head + (page.documentElement ? page.documentElement.outerHTML : ''); }})()"
        );
        match self.evaluate(&expression)? {
            Value::String(html) => Ok(html),
            _ => Err("the frame to capture was not found".into()),
        }
    }

    /// Press and release one key by its name (`Enter`, `Tab`, `a`).
    pub fn press(&mut self, key: &str) -> Result<(), Fail> {
        let (code, number, text) = match key {
            "Enter" => ("Enter", 13, "\r"),
            "Tab" => ("Tab", 9, ""),
            "Escape" => ("Escape", 27, ""),
            "Backspace" => ("Backspace", 8, ""),
            "Delete" => ("Delete", 46, ""),
            "ArrowDown" => ("ArrowDown", 40, ""),
            "ArrowUp" => ("ArrowUp", 38, ""),
            "ArrowLeft" => ("ArrowLeft", 37, ""),
            "ArrowRight" => ("ArrowRight", 39, ""),
            "Space" | " " => ("Space", 32, " "),
            other if other.chars().count() == 1 => ("", 0, other),
            other => return Err(format!("Unknown key: {other}").into()),
        };
        let named = if text.len() == 1 && code.is_empty() || key == " " { text } else { key };
        let mut down = json!({ "type": if text.is_empty() { "rawKeyDown" } else { "keyDown" }, "key": named, "code": code, "windowsVirtualKeyCode": number });
        if !text.is_empty() {
            down["text"] = json!(text);
        }
        self.call("Input.dispatchKeyEvent", down)?;
        self.call(
            "Input.dispatchKeyEvent",
            json!({ "type": "keyUp", "key": named, "code": code, "windowsVirtualKeyCode": number }),
        )?;
        Ok(())
    }

    /// Type text into whatever has focus, one key at a time.
    pub fn keys(&mut self, text: &str, delay: Duration) -> Result<(), Fail> {
        for letter in text.chars() {
            self.press(&letter.to_string())?;
            if !delay.is_zero() {
                std::thread::sleep(delay);
            }
        }
        Ok(())
    }
}

impl Drop for Browser {
    fn drop(&mut self) {
        let _ = self.socket.close(None);
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
