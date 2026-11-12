//! A throwaway HTTP server on localhost for tests: it records every request
//! and answers with whatever the test's handler returns.
#![allow(dead_code)]

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug)]
pub struct Request {
    pub method: String,
    /// Path and query, as sent.
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Request {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(key, _)| key.eq_ignore_ascii_case(name)).map(|(_, value)| value.as_str())
    }
}

pub struct Reply {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

pub fn ok(body: impl Into<Vec<u8>>) -> Reply {
    Reply { status: 200, headers: Vec::new(), body: body.into() }
}

pub fn status(status: u16) -> Reply {
    Reply { status, headers: Vec::new(), body: Vec::new() }
}

pub struct Server {
    /// `http://127.0.0.1:<port>`
    pub url: String,
    seen: Arc<Mutex<Vec<Request>>>,
}

impl Server {
    pub fn requests(&self) -> Vec<Request> {
        self.seen.lock().unwrap().clone()
    }
}

fn read(stream: &mut impl Read) -> Option<Request> {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    let (method, path) = (parts.next()?.to_string(), parts.next()?.to_string());
    let mut headers = Vec::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).ok()?;
        let Some((name, value)) = line.trim_end().split_once(':') else {
            break;
        };
        headers.push((name.trim().to_string(), value.trim().to_string()));
    }
    let named = |name: &str| headers.iter().find(|(key, _)| key.eq_ignore_ascii_case(name)).map(|(_, value)| value.clone());
    let mut body = Vec::new();
    if named("transfer-encoding").is_some_and(|value| value.contains("chunked")) {
        loop {
            let mut size = String::new();
            reader.read_line(&mut size).ok()?;
            let size = usize::from_str_radix(size.trim(), 16).ok()?;
            let mut chunk = vec![0; size + 2];
            reader.read_exact(&mut chunk).ok()?;
            if size == 0 {
                break;
            }
            body.extend(&chunk[..size]);
        }
    } else if let Some(length) = named("content-length") {
        body = vec![0; length.parse().ok()?];
        reader.read_exact(&mut body).ok()?;
    }
    Some(Request { method, path, headers, body })
}

/// Start a server; it lives until the test process ends.
pub fn serve(handler: impl Fn(&Request) -> Reply + Send + 'static) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let seen = Arc::new(Mutex::new(Vec::new()));
    let record = seen.clone();
    std::thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            let Some(request) = read(&mut stream) else {
                continue;
            };
            let reply = handler(&request);
            record.lock().unwrap().push(request);
            let mut head = format!("HTTP/1.1 {} X\r\ncontent-length: {}\r\nconnection: close\r\n", reply.status, reply.body.len());
            for (name, value) in &reply.headers {
                head += &format!("{name}: {value}\r\n");
            }
            let _ = stream.write_all(format!("{head}\r\n").as_bytes());
            let _ = stream.write_all(&reply.body);
        }
    });
    Server { url, seen }
}
