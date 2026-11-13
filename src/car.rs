//! CAR files: read one through a memory map, write one block by block.
//!
//! Reading never copies block bytes: a block is a range of the mapped file,
//! and the operating system decides how much of the file stays in memory.

use crate::Fail;
use cid::Cid;
use memmap2::Mmap;
use std::fs::File;
use std::io::Write;
use std::path::Path;

/// Where a block's bytes sit in the file.
pub type Place = (usize, usize);

pub struct Car {
    map: Mmap,
    pub roots: Vec<Cid>,
    /// The first block section and the end of the last one.
    span: Place,
}

fn varint(bytes: &[u8], at: &mut usize) -> Result<u64, Fail> {
    let mut value = 0u64;
    for shift in (0..64).step_by(7) {
        let byte = *bytes.get(*at).ok_or("car ends inside a length")?;
        *at += 1;
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Ok(value);
        }
    }
    Err("length does not fit in 64 bits".into())
}

/// `length` bytes of `bytes` from `at`, when it holds that many; a length no file could hold is none.
fn take(bytes: &[u8], at: usize, length: u64) -> Option<&[u8]> {
    bytes.get(at..at.checked_add(usize::try_from(length).ok()?)?)
}

/// The head of a dag-cbor item: its major type and argument.
fn head(bytes: &[u8], at: &mut usize) -> Result<(u8, u64), Fail> {
    let first = *bytes.get(*at).ok_or("car header is cut short")?;
    *at += 1;
    let extra = match first & 0x1f {
        short @ 0..=23 => return Ok((first >> 5, u64::from(short))),
        24 => 1,
        25 => 2,
        26 => 4,
        27 => 8,
        _ => return Err("car header is not dag-cbor".into()),
    };
    let field = take(bytes, *at, extra).ok_or("car header is cut short")?;
    *at += field.len();
    Ok((first >> 5, field.iter().fold(0, |sum, byte| sum << 8 | u64::from(*byte))))
}

/// The roots of a CARv1 header, which is exactly `{"roots": [links], "version": 1}`:
/// other readers refuse anything else, so an archive with another header cannot be published.
fn roots(header: &[u8]) -> Result<Vec<Cid>, Fail> {
    let mut at = 0;
    let (5, fields) = head(header, &mut at)? else {
        return Err("car header is not a map".into());
    };
    let (mut roots, mut version) = (None, None);
    for _ in 0..fields {
        let (3, length) = head(header, &mut at)? else {
            return Err("car header key is not text".into());
        };
        let key = take(header, at, length).ok_or("car header is cut short")?;
        at += key.len();
        match key {
            b"version" => {
                let (0, number) = head(header, &mut at)? else {
                    return Err("car header version is not a number".into());
                };
                version = Some(number);
            }
            b"roots" => {
                let (4, count) = head(header, &mut at)? else {
                    return Err("car header roots is not a list".into());
                };
                let mut listed = Vec::new();
                for _ in 0..count {
                    let ((6, 42), (2, size)) = (head(header, &mut at)?, head(header, &mut at)?) else {
                        return Err("car header root is not a link".into());
                    };
                    // one zero byte (the identity multibase), then the CID
                    let Some([0, cid @ ..]) = take(header, at, size) else {
                        return Err("car header root is not a link".into());
                    };
                    listed.push(Cid::try_from(cid).map_err(|error| format!("car header root is not a CID: {error}"))?);
                    at += cid.len() + 1;
                }
                roots = Some(listed);
            }
            other => return Err(format!("car header has an unknown field `{}`", String::from_utf8_lossy(other)).into()),
        }
    }
    if at != header.len() {
        return Err("car header has bytes after its end".into());
    }
    match version {
        Some(1) => roots.ok_or_else(|| "car header has no roots".into()),
        Some(other) => Err(format!("car header version is {other}, not 1").into()),
        None => Err("car header has no version".into()),
    }
}

const V2_PRAGMA: [u8; 11] = [0x0a, 0xa1, 0x67, b'v', b'e', b'r', b's', b'i', b'o', b'n', 0x02];

impl Car {
    pub fn open(path: &Path) -> Result<Car, Fail> {
        let file = File::open(path)?;
        // SAFETY: the map is read-only and the archive is not written while it
        // is checked; a file truncated underneath would fault, as with any map.
        let map = unsafe { Mmap::map(&file)? };
        let mut span = (0, map.len());
        if map.starts_with(&V2_PRAGMA) {
            // CARv2: 16 bytes of characteristics, then where the CARv1 inside starts and how long it is.
            let field = |at: usize| -> Result<usize, Fail> {
                let bytes = map.get(at..at + 8).ok_or("carv2 header is cut short")?;
                Ok(usize::try_from(u64::from_le_bytes(bytes.try_into()?))?)
            };
            span = (field(27)?, field(27)?.checked_add(field(35)?).ok_or("car is shorter than its header says")?);
        }
        if span.1 > map.len() || span.0 > span.1 {
            return Err("car is shorter than its header says".into());
        }
        let mut at = span.0;
        let length = varint(&map[..span.1], &mut at)?;
        let header = take(&map[..span.1], at, length).filter(|header| !header.is_empty()).ok_or("car header is cut short")?;
        let (roots, blocks) = (roots(header)?, at + header.len());
        Ok(Car { map, roots, span: (blocks, span.1) })
    }

    pub fn size(&self) -> u64 {
        self.map.len() as u64
    }

    pub fn bytes(&self, place: Place) -> &[u8] {
        &self.map[place.0..place.1]
    }

    /// Every block in file order: its CID and where its bytes sit.
    pub fn blocks(&self) -> Blocks<'_> {
        Blocks { data: &self.map[..self.span.1], at: self.span.0 }
    }
}

pub struct Blocks<'a> {
    data: &'a [u8],
    at: usize,
}

impl Blocks<'_> {
    fn read(&mut self) -> Result<(Cid, Place), Fail> {
        let length = varint(self.data, &mut self.at)? as usize;
        let end = self.at.checked_add(length).filter(|end| *end <= self.data.len()).ok_or("car ends inside a block")?;
        let mut section = &self.data[self.at..end];
        let cid = Cid::read_bytes(&mut section)?;
        let place = (end - section.len(), end);
        self.at = end;
        Ok((cid, place))
    }
}

impl Iterator for Blocks<'_> {
    type Item = Result<(Cid, Place), Fail>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.at >= self.data.len() {
            return None;
        }
        let block = self.read();
        if block.is_err() {
            self.at = self.data.len();
        }
        Some(block)
    }
}

/// Append an unsigned LEB128 number.
pub fn leb(mut value: u64, into: &mut Vec<u8>) {
    while value >= 0x80 {
        into.push((value as u8 & 0x7f) | 0x80);
        value >>= 7;
    }
    into.push(value as u8);
}

/// The bytes of a CARv1 header naming `roots`.
pub fn header(roots: &[Cid]) -> Vec<u8> {
    let mut body = vec![0xa2, 0x65];
    body.extend(b"roots");
    // ponytail: up to 23 roots, the short dag-cbor list form; every archive here has one
    body.push(0x80 + roots.len() as u8);
    for root in roots {
        let bytes = root.to_bytes();
        body.extend([0xd8, 0x2a, 0x58, bytes.len() as u8 + 1, 0x00]);
        body.extend(bytes);
    }
    body.push(0x67);
    body.extend(b"version");
    body.push(0x01);
    let mut out = Vec::new();
    leb(body.len() as u64, &mut out);
    out.extend(body);
    out
}

/// Append one block section to a CAR being written.
pub fn put(out: &mut impl Write, cid: &Cid, bytes: &[u8]) -> Result<(), Fail> {
    let id = cid.to_bytes();
    let mut length = Vec::new();
    leb((id.len() + bytes.len()) as u64, &mut length);
    out.write_all(&length)?;
    out.write_all(&id)?;
    out.write_all(bytes)?;
    Ok(())
}
