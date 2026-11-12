//! What `prepare` does in a browser: a plain visit, a browser flow (a small
//! state machine written as JSON, or generated from a template), and Browser
//! Flow v2 packages, whose JavaScript handler drives the page itself.

use crate::browser::{Browser, Timeout};
use crate::canonical::pretty;
use crate::js::{self, Sandbox, Start};
use crate::prepare::Fetched;
use crate::Fail;
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;

/// Text that marks a page as an error page, in lower case.
const BLOCKED: [&str; 8] = [
    "403 - forbidden",
    "access is denied",
    "server error 403",
    "404 not found",
    "request blocked",
    "access denied",
    "captcha",
    "verify you are human",
];

fn quoted(text: &str) -> String {
    Value::String(text.to_string()).to_string()
}

fn milliseconds(value: &Value, default: u64) -> Duration {
    Duration::from_millis(value.as_f64().map_or(default, |given| given.max(0.0) as u64))
}

/// The document a step works in: the page, or the document inside an iframe.
fn root(frame: Option<&str>) -> String {
    match frame {
        Some(selector) => format!("((document.querySelector({}) || {{}}).contentDocument)", quoted(selector)),
        None => "document".to_string(),
    }
}

/// An expression giving the element a selector names, or null.
fn element(selector: &str, frame: Option<&str>) -> String {
    format!("(({}) || {{ querySelector: () => null }}).querySelector({})", root(frame), quoted(selector))
}

/// An expression that is true once the element is there, and shown when `visible` is asked.
fn present(selector: &str, frame: Option<&str>, visible: bool) -> String {
    format!(
        "(() => {{ const found = {}; if (!found) return false; if (!{visible}) return true; const style = (found.ownerDocument.defaultView || window).getComputedStyle(found); return style.display !== 'none' && style.visibility !== 'hidden'; }})()",
        element(selector, frame)
    )
}

fn click(browser: &mut Browser, selector: &str, frame: Option<&str>) -> Result<(), Fail> {
    let clicked = browser.evaluate(&format!(
        "(() => {{ const found = {}; if (!found) return false; if (found.scrollIntoView) found.scrollIntoView(); found.click(); return true; }})()",
        element(selector, frame)
    ))?;
    match clicked == json!(true) {
        true => Ok(()),
        false => Err(format!("No element found for selector: {selector}").into()),
    }
}

/// Type into a field: real key events in the page itself, a set value inside an iframe.
fn enter(
    browser: &mut Browser,
    selector: &str,
    text: &str,
    delay: Duration,
    clear: bool,
    frame: Option<&str>,
) -> Result<(), Fail> {
    let script = match frame {
        Some(_) => format!(
            "(() => {{ const found = {}; if (!found) return false; found.value = {}; for (const kind of ['input', 'change']) found.dispatchEvent(new Event(kind, {{ bubbles: true }})); return true; }})()",
            element(selector, frame),
            quoted(text)
        ),
        None => format!(
            "(() => {{ const found = {}; if (!found) return false; if ({clear}) found.value = ''; found.focus(); return true; }})()",
            element(selector, frame)
        ),
    };
    if browser.evaluate(&script)? != json!(true) {
        return Err(format!("No element found for selector: {selector}").into());
    }
    match frame {
        Some(_) => Ok(()),
        None => browser.keys(text, delay),
    }
}

/// Read a browser flow file and check that every state it names exists.
pub fn load(file: &Path) -> Result<Value, Fail> {
    let text = std::fs::read(file).map_err(|error| format!("cannot read {}: {error}", file.display()))?;
    let flow: Value = serde_json::from_slice(&text).map_err(|error| format!("{}: {error}", file.display()))?;
    check(&flow).map_err(|reason| format!("Invalid custom browser flow definition: {reason}"))?;
    Ok(flow)
}

fn check(flow: &Value) -> Result<(), String> {
    let states = flow["states"].as_object().filter(|states| !states.is_empty()).ok_or("states must hold at least one state")?;
    let known = |name: &Value, place: &str| match name.as_str().is_some_and(|name| states.contains_key(name)) {
        true => Ok(()),
        false => Err(format!("{place} names the unknown state {name}")),
    };
    known(&flow["starts_at"], "starts_at")?;
    for (name, node) in states {
        if !node["type"].is_string() {
            return Err(format!("state {name} has no type"));
        }
        for key in ["next", "next_on_timeout"] {
            if !node[key].is_null() {
                known(&node[key], &format!("{name}.{key}"))?;
            }
        }
        for target in node["next_map"].as_object().into_iter().flatten().map(|(_, target)| target) {
            known(target, &format!("{name}.next_map"))?;
        }
        for winner in node["validate_winner"].as_object().into_iter().flatten().map(|(_, winner)| winner) {
            known(&winner["if_exists_goto"], &format!("{name}.validate_winner"))?;
        }
    }
    Ok(())
}

/// For `--input-csv`: the start URL of a flow, with the UUID in it replaced by the row's identifier.
pub fn origin(flow: &Value, identifier: &str) -> Option<String> {
    let start = &flow["states"][flow["starts_at"].as_str()?];
    let address = start["input"]["url"].as_str().filter(|_| start["type"] == "open_page")?;
    let pattern = regex::Regex::new("(?i)[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}").expect("a valid pattern");
    Some(pattern.replace(address, identifier).into_owned())
}

/// The `SEARCH_BY_PARCEL_ID` template: open the search page, pass up to two
/// "agree" buttons, type the parcel id, press Enter, wait for the result.
pub fn template(name: &str, parameters: &str, address: &str) -> Result<Value, Fail> {
    if name != "SEARCH_BY_PARCEL_ID" {
        return Err(format!(
            "Failed to create workflow from template: unknown template {name} (the only one is SEARCH_BY_PARCEL_ID)"
        )
        .into());
    }
    let given: Value = serde_json::from_str(parameters)
        .map_err(|error| format!("Failed to create workflow from template: --browser-flow-parameters is not JSON: {error}"))?;
    let text = |key: &str| given[key].as_str().filter(|value| !value.is_empty());
    let needed = |key: &str| text(key).ok_or(format!("Failed to create workflow from template: {key} is required"));
    let (form, result) = (needed("search_form_selector")?, needed("search_result_selector")?);
    let frame = text("iframe_selector");
    let step = |kind: &str, mut input: Value, next: Option<&str>| {
        if let Some(frame) = frame {
            input["iframe_selector"] = json!(frame);
        }
        let mut node = json!({ "type": kind, "input": input });
        match next {
            Some(next) => node["next"] = json!(next),
            None => node["end"] = json!(true),
        }
        node
    };
    let wait = |selector: &str, next: Option<&str>| {
        step("wait_for_selector", json!({ "selector": selector, "timeout": 30000, "visible": true }), next)
    };
    let race = |button: &str, label: &str, to: &str| {
        let options = json!([
            { "selector": form, "label": "search_form", "timeout": 30000 },
            { "selector": button, "label": label, "timeout": 30000 },
        ]);
        let mut node = step("wait_for_selector_race", json!({ "selectors": options, "visible": true }), None);
        node.as_object_mut().expect("a node").remove("end");
        node["next_map"] = json!({ "search_form": "wait_for_search_form_ready", label: to });
        node["validate_winner"] = json!({ "search_form": { "check_selector": button, "if_exists_goto": to } });
        node
    };
    let (first, second) = (text("continue_button_selector"), text("continue2_button_selector"));
    let mut states = serde_json::Map::new();
    let after = if first.is_some() || second.is_some() { "race_form_or_button" } else { "wait_for_search_form_ready" };
    let mut open = json!({ "type": "open_page", "input": { "url": address, "timeout": 30000, "wait_until": "domcontentloaded" }, "next": after });
    if let Some(frame) = frame {
        open["input"]["iframe_selector"] = json!(frame);
    }
    states.insert("open_search_page".to_string(), open);
    match (first, second) {
        (Some(first), second) => {
            states.insert("race_form_or_button".to_string(), race(first, "continue_button", "click_continue_button"));
            let next = if second.is_some() { "race_form_or_button2" } else { "wait_for_search_form_ready" };
            states.insert("click_continue_button".to_string(), step("click", json!({ "selector": first }), Some(next)));
            if let Some(second) = second {
                states.insert("race_form_or_button2".to_string(), race(second, "continue_button2", "click_continue_button2"));
                states.insert(
                    "click_continue_button2".to_string(),
                    step("click", json!({ "selector": second }), Some("wait_for_search_form_ready")),
                );
            }
        }
        (None, Some(second)) => {
            states.insert("race_form_or_button".to_string(), race(second, "continue_button2", "click_continue_button2"));
            states.insert(
                "click_continue_button2".to_string(),
                step("click", json!({ "selector": second }), Some("wait_for_search_form_ready")),
            );
        }
        (None, None) => {}
    }
    states.insert("wait_for_search_form_ready".to_string(), wait(form, Some("enter_parcel_id")));
    let typed = json!({ "selector": form, "value": "{{=it.request_identifier}}", "delay": 100 });
    states.insert("enter_parcel_id".to_string(), step("type", typed, Some("press_enter")));
    states.insert(
        "press_enter".to_string(),
        json!({ "type": "keyboard_press", "input": { "key": "Enter" }, "next": "wait_for_search_results" }),
    );
    let (button, details) = (text("property_details_button"), text("property_details_selector"));
    states.insert("wait_for_search_results".to_string(), wait(result, button.map(|_| "click_property_details")));
    if let Some(button) = button {
        states.insert(
            "click_property_details".to_string(),
            step("click", json!({ "selector": button }), details.map(|_| "wait_for_property_details")),
        );
        if let Some(details) = details {
            states.insert("wait_for_property_details".to_string(), wait(details, None));
        }
    }
    let capture = match text("capture_iframe_selector") {
        Some(selector) => json!({ "type": "iframe", "selector": selector }),
        None => json!({ "type": "page" }),
    };
    Ok(json!({ "starts_at": "open_search_page", "states": states, "capture": capture }))
}

/// Run a browser flow and capture the page, or one iframe, it ends on.
pub fn run(browser: &mut Browser, flow: &Value, identifier: &str, address: Option<&str>) -> Result<Fetched, Fail> {
    let mut known = json!({ "request_identifier": identifier, "url": address });
    let mut state = flow["starts_at"].as_str().unwrap_or_default().to_string();
    for _ in 0..1000 {
        let node = &flow["states"][&state];
        let mut input = node["input"].clone();
        // `{{=it.request_identifier}}` and friends, in the strings directly under `input`
        let templated: Vec<String> = input
            .as_object()
            .into_iter()
            .flatten()
            .filter(|(_, value)| value.as_str().is_some_and(|text| text.contains("=it.")))
            .map(|(key, _)| key.clone())
            .collect();
        let texts: Vec<String> = templated.iter().map(|key| input[key].as_str().unwrap_or_default().to_string()).collect();
        for (key, filled) in templated.iter().zip(js::fill(&texts, &known)?) {
            input[key] = json!(filled);
        }
        let text = |key: &str| input[key].as_str().map(str::to_string);
        let need = |key: &str| text(key).ok_or(format!("Step {state} needs input.{key}"));
        let frame = text("iframe_selector");
        let visible = input["visible"] == json!(true);
        let mut produced = None;
        let mut jump = None;
        match node["type"].as_str().unwrap_or_default() {
            "open_page" => {
                let until = text("wait_until").unwrap_or_else(|| "domcontentloaded".to_string());
                browser.goto(&need("url")?, &until, milliseconds(&input["timeout"], 30_000))?;
                std::thread::sleep(Duration::from_millis(500));
            }
            "wait_for_selector" => {
                let selector = need("selector")?;
                let waited = browser.wait(
                    &present(&selector, frame.as_deref(), visible),
                    milliseconds(&input["timeout"], 30_000),
                    &format!("selector `{selector}`"),
                );
                match waited {
                    Ok(_) => produced = Some(selector),
                    Err(error) if error.downcast_ref::<Timeout>().is_some() && node["continue_on_timeout"] == json!(true) => {
                        let next = node["next_on_timeout"].as_str();
                        jump = Some(
                            next.ok_or(format!(
                                "Step {state} timed out with continue_on_timeout, but no next_on_timeout is defined"
                            ))?
                            .to_string(),
                        );
                    }
                    Err(error) => return Err(error),
                }
            }
            "wait_for_selector_race" => {
                let options = input["selectors"]
                    .as_array()
                    .filter(|options| !options.is_empty())
                    .ok_or(format!("Step {state} needs input.selectors"))?;
                let checks: Vec<String> = options
                    .iter()
                    .map(|option| {
                        format!(
                            "[{}, {}]",
                            quoted(option["label"].as_str().unwrap_or_default()),
                            present(option["selector"].as_str().unwrap_or_default(), frame.as_deref(), visible)
                        )
                    })
                    .collect();
                // the first option that times out ends the race
                let shortest = options.iter().map(|option| milliseconds(&option["timeout"], 30_000)).min().unwrap_or_default();
                let race = format!(
                    "(() => {{ const won = [{}].find((option) => option[1]); return won ? won[0] : null; }})()",
                    checks.join(", ")
                );
                let won = browser.wait(&race, shortest, "one of the selectors")?;
                let label = won.as_str().unwrap_or_default().to_string();
                let next =
                    node["next_map"][&label].as_str().ok_or(format!("Step {state} result '{label}' not found in next_map"))?;
                jump = Some(next.to_string());
                // the form can win while the button that hides it is still there
                let winner = &node["validate_winner"][&label];
                if let Some(selector) = winner["check_selector"].as_str() {
                    if browser.evaluate(&present(selector, frame.as_deref(), false))? == json!(true) {
                        jump = winner["if_exists_goto"].as_str().map(str::to_string);
                    }
                }
                produced = Some(label);
            }
            "click" => click(browser, &need("selector")?, frame.as_deref())?,
            "type" => enter(
                browser,
                &need("selector")?,
                &need("value")?,
                milliseconds(&input["delay"], 0),
                input["clear"] == json!(true),
                frame.as_deref(),
            )?,
            "keyboard_press" => browser.press(&need("key")?)?,
            other => return Err(format!("Unknown type: {other}").into()),
        }
        if let Some(name) = node["result"].as_str() {
            match (&produced, &jump) {
                (Some(value), _) => known[name] = json!(value),
                (None, Some(_)) => {}
                (None, None) => return Err(format!("Missing result at step {state}").into()),
            }
        }
        if node["end"] == json!(true) {
            let landed = browser.url()?;
            let html = match flow["capture"]["type"].as_str() {
                Some("iframe") => browser.content(&root(flow["capture"]["selector"].as_str()))?,
                _ => browser.content("document")?,
            };
            return Ok(Fetched { content: js::clean(&html)?, html: true, landed: Some(landed) });
        }
        let next = jump.or_else(|| node["next"].as_str().map(str::to_string));
        state = next.ok_or(format!("Step {state} has neither \"end\" nor a next state"))?;
    }
    Err("The browser flow ran 1000 steps without reaching a state marked \"end\"".into())
}

/// `--use-browser`: load the page of a GET request and keep what the browser shows.
pub fn visit(browser: &mut Browser, address: &str, proceed: bool, button: Option<&str>, captcha: bool) -> Result<Fetched, Fail> {
    let status = browser.goto(address, "domcontentloaded", Duration::from_secs(15)).map_err(|error| {
        match error.downcast_ref::<Timeout>() {
            Some(_) => format!("{error}. If the site restricts by location, try from an address in its region.").into(),
            None => error,
        }
    })?;
    if let Some((code, reason)) = status.filter(|(code, _)| *code >= 400) {
        return Err(format!("HTTP error {code}: {reason}").into());
    }
    // A reCAPTCHA page redirects once it is passed: give it a minute.
    let challenged = "(/recaptchatoken=/i.test(location.href) || Boolean(document.querySelector('.g-recaptcha, [id*=\"recaptcha\"], [class*=\"recaptcha\"]')))";
    if !captcha && browser.evaluate(challenged)? == json!(true) {
        let passed = format!("location.href !== {} && !/recaptchatoken=/i.test(location.href)", quoted(address));
        if browser.wait(&passed, Duration::from_secs(60), "the reCAPTCHA redirect").is_ok() {
            std::thread::sleep(Duration::from_secs(2));
        }
    }
    // Either the notice some county sites show first, or the page itself.
    let notice = present("#pnlIssues", None, true);
    let shown = format!("({notice} || Boolean(document.querySelector('#parcelLabel, .sectionTitle, table.detailsTable, .textPanel, [id*=\"Property\"]')))");
    let _ = browser.wait(&shown, Duration::from_secs(15), "the page content");
    let before = browser.navigations;
    match button {
        Some(selector) => {
            let waited = browser.wait(&present(selector, None, true), Duration::from_secs(15), &format!("selector `{selector}`"));
            if waited.is_ok() && click(browser, selector, None).is_ok() {
                std::thread::sleep(Duration::from_secs(1));
            }
        }
        None if proceed => {
            let pressed = browser.evaluate(
                "(() => { const notice = document.querySelector('#pnlIssues'); if (!notice) return false; const style = getComputedStyle(notice); if (style.display === 'none' || style.visibility === 'hidden') return false; const go = notice.querySelector('#btnContinue, input[name=\"btnContinue\"], input[value=\"Continue\"], button[value=\"Continue\"]'); if (!go) return false; go.click(); return true; })()",
            )?;
            if pressed == json!(true) {
                let until = std::time::Instant::now() + Duration::from_secs(15);
                while browser.navigations == before && std::time::Instant::now() < until {
                    browser.pump(Duration::from_millis(100))?;
                }
                let _ = browser.settle("load", Duration::from_secs(15));
            }
        }
        None => {}
    }
    std::thread::sleep(Duration::from_secs(1));
    let html = browser.content("document")?;
    let lower = html.to_lowercase();
    let solved = browser.url()?.to_lowercase().contains("recaptchatoken=");
    let hit = BLOCKED.iter().find(|pattern| lower.contains(**pattern) && !(**pattern == "captcha" && (captcha || solved)));
    if let Some(pattern) = hit {
        return Err(format!("Browser returned error page: {pattern}").into());
    }
    Ok(Fetched { content: html, html: true, landed: None })
}

/// The `page` a Browser Flow v2 handler drives: the part of Puppeteer's `Page`
/// that flows use, on top of calls into the CLI.
const PAGE: &str = r#"(async (module, call) => {
  const exported = module.handler ? module : module.default || {};
  if (typeof exported.handler !== 'function') throw new Error('Browser flow v2 package must export a handler function');
  const input = call('input');
  const text = (value) => JSON.stringify(String(value));
  const source = (fn, args) => (typeof fn === 'function' ? `(${fn})(${args.map((arg) => JSON.stringify(arg)).join(', ')})` : String(fn));
  const withElement = (selector, index, fn, args) =>
    `(${fn})(${index === undefined ? `document.querySelector(${text(selector)})` : `document.querySelectorAll(${text(selector)})[${index}]`}${args.map((arg) => ', ' + JSON.stringify(arg)).join('')})`;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // Something that may be awaited next to the action that causes it, as in
  // Promise.all([page.waitForNavigation(), page.click(...)]): it starts after the action ran.
  const soon = (work) => new Promise((resolve, reject) => setTimeout(() => { try { resolve(work()); } catch (error) { reject(error); } }, 0));
  const handle = (selector, index) => ({
    click: async () => void call('evaluate', withElement(selector, index, '(found) => { found.scrollIntoView && found.scrollIntoView(); found.click(); }', [])),
    type: async (value, options = {}) => { call('evaluate', withElement(selector, index, '(found) => found.focus()', [])); call('keys', String(value), options.delay || 0); },
    focus: async () => void call('evaluate', withElement(selector, index, '(found) => found.focus()', [])),
    press: async (key) => { call('evaluate', withElement(selector, index, '(found) => found.focus()', [])); call('press', key); },
    evaluate: async (fn, ...args) => call('evaluate', withElement(selector, index, fn, args)),
    getProperty: async (name) => ({ jsonValue: async () => call('evaluate', withElement(selector, index, '(found, name) => found[name]', [name])) }),
    $: async (inner) => page.$(`${selector} ${inner}`),
  });
  const page = {
    goto: async (url, options = {}) => {
      const status = call('goto', String(url), options.waitUntil || 'load', options.timeout ?? 30000);
      return { status: () => status, ok: () => status === null || (status >= 200 && status < 300) };
    },
    url: () => call('url'),
    title: async () => call('evaluate', 'document.title'),
    content: async () => call('content'),
    evaluate: async (fn, ...args) => call('evaluate', source(fn, args)),
    waitForSelector: async (selector, options = {}) => {
      call('waitSelector', String(selector), Boolean(options.visible), Boolean(options.hidden), options.timeout ?? 30000);
      return options.hidden ? null : handle(selector);
    },
    waitForFunction: async (fn, options = {}, ...args) => call('wait', source(fn, args), options.timeout ?? 30000),
    waitForNavigation: (options = {}) => {
      const mark = call('mark');
      return soon(() => call('waitNavigation', mark, options.waitUntil || 'load', options.timeout ?? 30000));
    },
    waitForNetworkIdle: async (options = {}) => void call('settle', 'networkidle0', options.timeout ?? 30000),
    waitForTimeout: sleep,
    click: async (selector) => void call('click', String(selector)),
    type: async (selector, value, options = {}) => void call('type', String(selector), String(value), options.delay || 0),
    focus: async (selector) => handle(selector).focus(),
    select: async (selector, ...values) =>
      call('evaluate', withElement(selector, undefined, '(found, values) => { for (const option of found.options) option.selected = values.includes(option.value); for (const kind of ["input", "change"]) found.dispatchEvent(new Event(kind, { bubbles: true })); return values; }', [values])),
    $: async (selector) => (call('evaluate', `Boolean(document.querySelector(${text(selector)}))`) ? handle(selector) : null),
    $$: async (selector) => Array.from({ length: call('evaluate', `document.querySelectorAll(${text(selector)}).length`) }, (_, index) => handle(selector, index)),
    $eval: async (selector, fn, ...args) => call('evaluate', withElement(selector, undefined, fn, args)),
    $$eval: async (selector, fn, ...args) => call('evaluate', `(${fn})(Array.from(document.querySelectorAll(${text(selector)}))${args.map((arg) => ', ' + JSON.stringify(arg)).join('')})`),
    keyboard: {
      press: async (key) => void call('press', String(key)),
      type: async (value, options = {}) => void call('keys', String(value), options.delay || 0),
    },
    setDefaultTimeout: () => {},
    setDefaultNavigationTimeout: () => {},
    setViewport: async () => {},
  };
  const saveHtml = async ({ name, html } = {}) => void call('saveHtml', String(name), html === undefined ? call('content') : String(html));
  const saveSourceUrl = async (url) => void call('saveSourceUrl', String(url));
  const logger = Object.fromEntries(['info', 'success', 'error', 'warn', 'log', 'debug', 'technical', 'progress'].map((level) => [level, (...args) => console.log(...args)]));
  const signal = { aborted: false, addEventListener: () => {}, removeEventListener: () => {} };
  await exported.handler({ page, input, saveHtml, saveSourceUrl, signal, logger });
})"#;

/// A capture name: `property-detail`, `tax-2024`.
fn kebab(name: &str) -> bool {
    let part = |part: &str| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit());
    name.split('-').all(part)
}

/// Run a Browser Flow v2 package: its handler drives the page and saves named
/// captures into `work/captures/`, listed in `work/captures.json`.
pub fn package(browser: &mut Browser, package: &Path, work: &Path, input: &Value) -> Result<(), Fail> {
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
    let scratch = std::env::temp_dir().join(format!("elephant-flow-{}-{stamp:x}", std::process::id()));
    std::fs::create_dir_all(&scratch)?;
    let scratch = scratch.canonicalize()?;
    let outcome = handle(browser, package, &scratch, work, input);
    let _ = std::fs::remove_dir_all(&scratch);
    outcome
}

fn handle(browser: &mut Browser, package: &Path, scratch: &Path, work: &Path, input: &Value) -> Result<(), Fail> {
    let opened = std::fs::File::open(package).map_err(|error| format!("cannot read {}: {error}", package.display()))?;
    zip::ZipArchive::new(opened)?.extract(scratch)?;
    let entry = scratch.join("handler.js");
    if !entry.is_file() {
        return Err("The browser flow package has no handler.js at its root".into());
    }
    std::fs::create_dir_all(work.join("captures"))?;
    let mut captures: Vec<String> = Vec::new();
    let mut source: Option<String> = None;
    let mut bridge = |name: &str, arguments: Value| -> Result<Value, String> {
        let text = |at: usize| arguments[at].as_str().unwrap_or_default().to_string();
        let wait = |at: usize| milliseconds(&arguments[at], 30_000);
        let failed = |error: Fail| error.to_string();
        match name {
            "input" => Ok(input.clone()),
            "goto" => {
                let status = browser.goto(&text(0), &text(1), wait(2)).map_err(failed)?;
                Ok(status.map_or(Value::Null, |(code, _)| json!(code)))
            }
            "url" => browser.url().map(Value::String).map_err(failed),
            "content" => browser.content("document").map(Value::String).map_err(failed),
            "evaluate" => browser.evaluate(&text(0)).map_err(failed),
            "wait" => browser.wait(&text(0), wait(1), "the function").map_err(failed),
            "waitSelector" => {
                let (selector, visible, hidden) = (text(0), arguments[1] == json!(true), arguments[2] == json!(true));
                let shown = present(&selector, None, visible);
                let expression = if hidden { format!("!{shown}") } else { shown };
                browser.wait(&expression, wait(3), &format!("selector `{selector}`")).map_err(failed)
            }
            "mark" => {
                browser.pump(Duration::ZERO).map_err(failed)?;
                Ok(json!(browser.navigations))
            }
            "waitNavigation" => {
                let (mark, until) = (arguments[0].as_u64().unwrap_or(0), std::time::Instant::now() + wait(2));
                while browser.navigations <= mark {
                    if std::time::Instant::now() >= until {
                        return Err(format!("Navigation timeout of {}ms exceeded", wait(2).as_millis()));
                    }
                    browser.pump(Duration::from_millis(50)).map_err(failed)?;
                }
                browser.settle(&text(1), wait(2)).map(|_| Value::Null).map_err(failed)
            }
            "settle" => browser.settle(&text(0), wait(1)).map(|_| Value::Null).map_err(failed),
            "click" => click(browser, &text(0), None).map(|_| Value::Null).map_err(failed),
            "type" => enter(browser, &text(0), &text(1), milliseconds(&arguments[2], 0), false, None)
                .map(|_| Value::Null)
                .map_err(failed),
            "press" => browser.press(&text(0)).map(|_| Value::Null).map_err(failed),
            "keys" => browser.keys(&text(0), milliseconds(&arguments[1], 0)).map(|_| Value::Null).map_err(failed),
            "saveHtml" => {
                let name = text(0);
                if !kebab(&name) {
                    return Err(format!("Invalid capture name \"{name}\". Capture names must be kebab-case."));
                }
                if captures.contains(&name) {
                    return Err(format!("Duplicate capture name: {name}"));
                }
                let cleaned = js::clean(&text(1))?;
                std::fs::write(work.join("captures").join(format!("{name}.html")), cleaned).map_err(|error| error.to_string())?;
                captures.push(name);
                Ok(Value::Null)
            }
            "saveSourceUrl" => {
                if source.is_some() {
                    return Err("saveSourceUrl may only be called once".to_string());
                }
                source = Some(text(0));
                Ok(Value::Null)
            }
            other => Err(format!("{other} is not part of the browser flow v2 API")),
        }
    };
    let sandbox =
        Sandbox { root: scratch.to_path_buf(), cwd: scratch.to_path_buf(), timeout: Duration::from_secs(300), network: true };
    if let Err(failed) = js::run(Start::Call { file: &entry, entry: PAGE }, &sandbox, Some(&mut bridge)) {
        if failed.timed_out {
            return Err("Browser flow v2 timed out after 300000ms".into());
        }
        let lines: Vec<&str> = failed.stderr.trim_end().lines().collect();
        return Err(format!("Browser flow v2 handler failed:\n{}", lines[lines.len().saturating_sub(40)..].join("\n")).into());
    }
    let source = source.ok_or("Browser flow v2 handler must call saveSourceUrl")?;
    if captures.is_empty() {
        return Err("Browser flow v2 handler must save at least one capture".into());
    }
    captures.sort();
    let listed: Vec<Value> =
        captures.iter().map(|name| json!({ "name": name, "path": format!("captures/{name}.html"), "type": "html" })).collect();
    let manifest =
        json!({ "version": 2, "request_identifier": input["request_identifier"], "sourceUrl": source, "captures": listed });
    Ok(std::fs::write(work.join("captures.json"), pretty(&manifest))?)
}
