//! Shared test support: a scratch directory, the CLI under test, and builders
//! for blocks and CAR files. The builders are written independently of the
//! crate's own CAR code so a test never checks the code against itself.
#![allow(dead_code)]

pub mod county;
pub mod http;

use cid::multihash::Multihash;
use cid::Cid;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU32, Ordering};

pub const DAG_JSON: u64 = 0x0129;
pub const RAW: u64 = 0x55;

/// A scratch directory, removed when dropped.
pub struct Scratch(pub PathBuf);

static NEXT: AtomicU32 = AtomicU32::new(0);

impl Scratch {
    pub fn new() -> Scratch {
        let name = format!("elephant-cli-test-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed));
        let path = std::env::temp_dir().join(name);
        std::fs::create_dir_all(&path).unwrap();
        Scratch(path)
    }

    pub fn path(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }

    pub fn text(&self, name: &str) -> String {
        std::fs::read_to_string(self.path(name)).unwrap()
    }

    /// Run the CLI offline, with this directory as cwd and `schemas/` as the schema cache.
    pub fn run(&self, args: &[&str]) -> Ran {
        self.run_with(args, &[])
    }

    /// As `run`, with extra environment variables (which may switch the network back on).
    pub fn run_with(&self, args: &[&str], env: &[(&str, &str)]) -> Ran {
        let output = Command::new(env!("CARGO_BIN_EXE_elephant-cli"))
            .args(args)
            .current_dir(&self.0)
            .env("ELEPHANT_SCHEMA_CACHE_DIR", self.path("schemas"))
            .env("ELEPHANT_OFFLINE", "1")
            .env("NO_COLOR", "1")
            .envs(env.iter().copied())
            .output()
            .unwrap();
        Ran::from(output)
    }

    /// The data rows of a CSV the CLI wrote.
    pub fn rows(&self, name: &str) -> Vec<Vec<String>> {
        csv(&self.text(name))
    }

    /// Copy a directory of fixtures (relative to `tests/fixtures`) into this scratch directory.
    pub fn copy(&self, fixture: &str, name: &str) {
        fn tree(from: &Path, to: &Path) {
            std::fs::create_dir_all(to).unwrap();
            for entry in std::fs::read_dir(from).unwrap() {
                let entry = entry.unwrap();
                let target = to.join(entry.file_name());
                if entry.file_type().unwrap().is_dir() {
                    tree(&entry.path(), &target);
                } else {
                    std::fs::copy(entry.path(), target).unwrap();
                }
            }
        }
        tree(&fixtures().join(fixture), &self.path(name));
    }

    /// Fill the schema cache with the lexicon snapshot the fixtures were made against.
    pub fn lexicon(&self) {
        self.copy("lexicon", "schemas");
    }
}

/// Entry names and contents of a ZIP file.
pub fn entries(file: &Path) -> std::collections::BTreeMap<String, Vec<u8>> {
    use std::io::Read;
    let mut archive = zip::ZipArchive::new(std::fs::File::open(file).unwrap()).unwrap();
    (0..archive.len())
        .map(|at| {
            let mut entry = archive.by_index(at).unwrap();
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).unwrap();
            (entry.name().unwrap().to_string(), bytes)
        })
        .collect()
}

/// Pack a directory as a ZIP; its files sit at the root of the archive.
pub fn zip_dir(dir: &Path, to: &Path) {
    use std::io::Write;
    fn add(writer: &mut zip::ZipWriter<std::fs::File>, dir: &Path, prefix: &str) {
        let mut found: Vec<_> = std::fs::read_dir(dir).unwrap().map(|entry| entry.unwrap().path()).collect();
        found.sort();
        for path in found {
            let name = format!("{prefix}{}", path.file_name().unwrap().to_string_lossy());
            if path.is_dir() {
                add(writer, &path, &format!("{name}/"));
                continue;
            }
            writer.start_file(name, zip::write::SimpleFileOptions::default()).unwrap();
            writer.write_all(&std::fs::read(path).unwrap()).unwrap();
        }
    }
    let mut writer = zip::ZipWriter::new(std::fs::File::create(to).unwrap());
    add(&mut writer, dir, "");
    writer.finish().unwrap();
}

/// Pack a fixture directory (relative to `tests/fixtures`) as a ZIP.
pub fn pack(fixture: &str, to: &Path) {
    zip_dir(&fixtures().join(fixture), to);
}

/// Pack files given as (name, content) pairs as a ZIP.
pub fn zip_of(files: &[(&str, &str)], to: &Path) {
    use std::io::Write;
    let mut writer = zip::ZipWriter::new(std::fs::File::create(to).unwrap());
    for (name, content) in files {
        writer.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
        writer.write_all(content.as_bytes()).unwrap();
    }
    writer.finish().unwrap();
}

pub fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures")
}

/// The data rows of CSV text: fields may be quoted, with `""` for a quote.
pub fn csv(text: &str) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(next) = chars.next() {
        match next {
            '"' if quoted && chars.peek() == Some(&'"') => {
                field.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            ',' if !quoted => row.push(std::mem::take(&mut field)),
            '\n' if !quoted => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            other => field.push(other),
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    rows.into_iter().skip(1).collect()
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub struct Ran {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

impl From<Output> for Ran {
    fn from(output: Output) -> Ran {
        Ran {
            code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        }
    }
}

impl Ran {
    /// stdout parsed as the single JSON document `--json` prints.
    pub fn json(&self) -> Value {
        serde_json::from_str(&self.stdout)
            .unwrap_or_else(|error| panic!("stdout is not JSON ({error}):\n{}\nstderr:\n{}", self.stdout, self.stderr))
    }
}

#[derive(Clone)]
pub struct Block {
    pub cid: Cid,
    pub bytes: Vec<u8>,
}

fn block(codec: u64, bytes: Vec<u8>) -> Block {
    let hash = Multihash::<64>::wrap(0x12, &Sha256::digest(&bytes)).unwrap();
    Block { cid: Cid::new_v1(codec, hash), bytes }
}

/// A dag-json block holding `value`; links are written as `{"/": "<cid>"}`.
pub fn node(value: &Value) -> Block {
    block(DAG_JSON, serde_json::to_vec(value).unwrap())
}

/// A raw block holding text.
pub fn text(value: &str) -> Block {
    block(RAW, value.as_bytes().to_vec())
}

pub fn link(cid: &Cid) -> Value {
    json!({ "/": cid.to_string() })
}

fn varint(mut value: usize, into: &mut Vec<u8>) {
    while value >= 0x80 {
        into.push((value as u8 & 0x7f) | 0x80);
        value >>= 7;
    }
    into.push(value as u8);
}

/// Write a CARv1 file with one root and the blocks in the order given.
pub fn write_car(file: &Path, root: &Cid, blocks: &[Block]) {
    let root = root.to_bytes();
    let mut header = vec![0xa2, 0x65];
    header.extend(b"roots");
    header.extend([0x81, 0xd8, 0x2a, 0x58, root.len() as u8 + 1, 0x00]);
    header.extend(&root);
    header.push(0x67);
    header.extend(b"version");
    header.push(0x01);
    let mut out = Vec::new();
    varint(header.len(), &mut out);
    out.extend(header);
    for block in blocks {
        let cid = block.cid.to_bytes();
        varint(cid.len() + block.bytes.len(), &mut out);
        out.extend(cid);
        out.extend(&block.bytes);
    }
    std::fs::write(file, out).unwrap();
}
