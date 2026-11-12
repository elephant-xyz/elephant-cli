//! Property inputs: one property's files, from a directory or a ZIP, and the
//! children of a batch directory.

use std::borrow::Cow;
use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};

enum Files {
    Dir(PathBuf),
    Zip(BTreeMap<String, Vec<u8>>),
}

/// The files of one property. Names are relative to the property, with `/` separators.
pub struct Property {
    /// The directory name, or the ZIP name without `.zip`.
    pub name: String,
    /// Where the input is, for the paths written to reports.
    base: PathBuf,
    files: Files,
}

fn hidden(name: &str) -> bool {
    name.starts_with('.') || name.starts_with("__")
}

/// The properties of a batch directory: its visible subdirectories and ZIPs,
/// sorted by name. Empty when `dir` is a single property or not a directory.
pub fn children(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut found: Vec<PathBuf> = entries
        .flatten()
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let kind = entry.file_type();
            let zipped = kind.as_ref().is_ok_and(|kind| kind.is_file()) && name.to_lowercase().ends_with(".zip");
            !hidden(&name) && (kind.is_ok_and(|kind| kind.is_dir()) || zipped)
        })
        .map(|entry| entry.path())
        .collect();
    // ponytail: byte order; elephant-cli 1.x used locale collation, which only
    // differs for names that mix case or punctuation
    found.sort();
    found
}

/// The name a batch child is reported under.
pub fn stem(path: &Path) -> String {
    let name = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
    match path.is_file() && name.to_lowercase().ends_with(".zip") {
        true => name[..name.len() - 4].to_string(),
        false => name,
    }
}

/// The names of a batch's children; two that differ only by case or by `.zip` are refused.
pub fn stems(children: &[PathBuf], input: &Path) -> Result<Vec<String>, String> {
    let names: Vec<String> = children.iter().map(|child| stem(child)).collect();
    let mut seen = std::collections::HashSet::new();
    let repeated: Vec<&str> = names.iter().filter(|name| !seen.insert(name.to_lowercase())).map(String::as_str).collect();
    if !repeated.is_empty() {
        return Err(format!("Duplicate property names in {}: {}", input.display(), repeated.join(", ")));
    }
    Ok(names)
}

impl Property {
    pub fn open(path: &Path) -> Result<Property, String> {
        let base = std::path::absolute(path).map_err(|error| format!("{}: {error}", path.display()))?;
        let base = base.canonicalize().unwrap_or(base);
        if base.is_dir() {
            return Ok(Property { name: stem(&base), files: Files::Dir(base.clone()), base });
        }
        let bytes = std::fs::read(&base).map_err(|error| format!("cannot read {}: {error}", path.display()))?;
        let zipped = base.to_string_lossy().to_lowercase().ends_with(".zip") || bytes.starts_with(b"PK");
        if !zipped {
            return Err(format!("{} is not a directory or a ZIP file", path.display()));
        }
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
            .map_err(|error| format!("Failed to extract ZIP file {}: {error}", path.display()))?;
        let mut entries = BTreeMap::new();
        for at in 0..archive.len() {
            let mut entry = archive.by_index(at).map_err(|error| format!("{}: {error}", path.display()))?;
            let name = entry.name().map_err(|error| format!("{}: {error}", path.display()))?.replace('\\', "/");
            if entry.is_dir() || name.split('/').any(hidden) {
                continue;
            }
            let mut content = Vec::new();
            entry.read_to_end(&mut content).map_err(|error| format!("{}: {name}: {error}", path.display()))?;
            entries.insert(name, content);
        }
        // Files may sit at the root or inside one wrapping folder.
        let top = |name: &str| name.split_once('/').map(|(folder, _)| folder.to_string());
        let wrapper = entries.keys().next().and_then(|name| top(name));
        if let Some(folder) = wrapper.filter(|folder| entries.keys().all(|name| top(name).as_ref() == Some(folder))) {
            entries = entries.into_iter().map(|(name, content)| (name[folder.len() + 1..].to_string(), content)).collect();
        }
        Ok(Property { name: stem(&base), base, files: Files::Zip(entries) })
    }

    /// The files directly in the property, by name in byte order.
    pub fn names(&self) -> Vec<String> {
        match &self.files {
            Files::Zip(entries) => entries.keys().filter(|name| !name.contains('/')).cloned().collect(),
            Files::Dir(dir) => {
                let mut names: Vec<String> = std::fs::read_dir(dir)
                    .into_iter()
                    .flatten()
                    .flatten()
                    .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
                    .map(|entry| entry.file_name().to_string_lossy().into_owned())
                    .collect();
                names.sort();
                names
            }
        }
    }

    /// A file of the property by its name or `./relative/path`; nothing outside the property is read.
    pub fn read(&self, name: &str) -> Option<Cow<'_, [u8]>> {
        let name = name.strip_prefix("./").unwrap_or(name);
        if name.starts_with('/') || name.split('/').any(|part| part == ".." || part.is_empty()) {
            return None;
        }
        match &self.files {
            Files::Zip(entries) => entries.get(name).map(|bytes| Cow::Borrowed(bytes.as_slice())),
            Files::Dir(dir) => std::fs::read(dir.join(name)).ok().map(Cow::Owned),
        }
    }

    /// The path a file is reported under.
    pub fn path(&self, name: &str) -> String {
        self.base.join(name).to_string_lossy().into_owned()
    }
}
