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
    let field = bytes.get(*at..*at + extra).ok_or("car header is cut short")?;
    *at += extra;
    Ok((first >> 5, field.iter().fold(0, |sum, byte| sum << 8 | u64::from(*byte))))
}

/// The roots of a CARv1 header `{"roots": [links], "version": 1}`.
fn roots(header: &[u8]) -> Result<Vec<Cid>, Fail> {
    let mut at = 0;
    let (5, fields) = head(header, &mut at)? else {
        return Err("car header is not a map".into());
    };
    let mut roots = None;
    for _ in 0..fields {
        let (3, length) = head(header, &mut at)? else {
            return Err("car header key is not text".into());
        };
        let key = header.get(at..at + length as usize).ok_or("car header is cut short")?;
        at += length as usize;
        if key != b"roots" {
            // `version`, a small number: nothing follows its head
            head(header, &mut at)?;
            continue;
        }
        let (4, count) = head(header, &mut at)? else {
            return Err("car header roots is not a list".into());
        };
        let mut listed = Vec::new();
        for _ in 0..count {
            let ((6, 42), (2, size)) = (head(header, &mut at)?, head(header, &mut at)?) else {
                return Err("car header root is not a link".into());
            };
            // one identity-multibase byte, then the CID
            let bytes = header.get(at + 1..at + size as usize).ok_or("car header is cut short")?;
            listed.push(Cid::try_from(bytes)?);
            at += size as usize;
        }
        roots = Some(listed);
    }
    roots.ok_or_else(|| "car header has no roots".into())
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
                Ok(u64::from_le_bytes(bytes.try_into()?) as usize)
            };
            span = (field(27)?, field(27)? + field(35)?);
        }
        if span.1 > map.len() {
            return Err("car is shorter than its header says".into());
        }
        let mut at = span.0;
        let length = varint(&map[..span.1], &mut at)? as usize;
        let header = map.get(at..at + length).filter(|_| length > 0).ok_or("car header is cut short")?;
        let roots = roots(header)?;
        Ok(Car { map, roots, span: (at + length, span.1) })
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

#[allow(dead_code)] // used by `hash --output-car`
fn leb(mut value: usize, into: &mut Vec<u8>) {
    while value >= 0x80 {
        into.push((value as u8 & 0x7f) | 0x80);
        value >>= 7;
    }
    into.push(value as u8);
}

/// The bytes of a CARv1 header naming `roots`.
#[allow(dead_code)]
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
    leb(body.len(), &mut out);
    out.extend(body);
    out
}

/// Append one block section to a CAR being written.
#[allow(dead_code)]
pub fn put(out: &mut impl Write, cid: &Cid, bytes: &[u8]) -> Result<(), Fail> {
    let id = cid.to_bytes();
    let mut length = Vec::new();
    leb(id.len() + bytes.len(), &mut length);
    out.write_all(&length)?;
    out.write_all(&id)?;
    out.write_all(bytes)?;
    Ok(())
}
