#!/usr/bin/env node
'use strict';

const net = require('net');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SOCKET_PATH = '/tmp/browsercli.sock';
const REQUEST_TIMEOUT = 10000;

// --- Native Messaging (stdin/stdout, length-prefixed JSON) ---

function writeNativeMessage(msg) {
  const json = JSON.stringify(msg);
  const buf = Buffer.alloc(4 + json.length);
  buf.writeUInt32LE(json.length, 0);
  buf.write(json, 4);
  process.stdout.write(buf);
}

let stdinBuf = Buffer.alloc(0);

function processStdin() {
  while (true) {
    if (stdinBuf.length < 4) return;
    const msgLen = stdinBuf.readUInt32LE(0);
    if (stdinBuf.length < 4 + msgLen) return;
    const json = stdinBuf.slice(4, 4 + msgLen).toString('utf8');
    stdinBuf = stdinBuf.slice(4 + msgLen);
    let msg;
    try {
      msg = JSON.parse(json);
    } catch {
      continue;
    }
    handleBrowserMessage(msg);
  }
}

process.stdin.on('data', (chunk) => {
  stdinBuf = Buffer.concat([stdinBuf, chunk]);
  processStdin();
});

process.stdin.on('end', () => {
  cleanup();
  process.exit(0);
});

// --- State ---

let browserConnected = false;
let browserName = null;

// Pending requests from CLI waiting for browser response: { requestId: { resolve, reject, timer } }
const pending = {};

// --- Handle messages from browser extension ---

function handleBrowserMessage(msg) {
  // Extension sends hello on connect
  if (msg.type === 'hello') {
    browserConnected = true;
    browserName = msg.browser || 'unknown';
    log(`Browser connected: ${browserName}`);
    return;
  }

  // Extension sends response to a command
  if (msg.requestId && pending[msg.requestId]) {
    const p = pending[msg.requestId];
    clearTimeout(p.timer);
    delete pending[msg.requestId];
    if (msg.error) {
      p.reject(new Error(msg.error));
    } else {
      p.resolve(msg.data);
    }
    return;
  }
}

// --- Send command to browser extension ---

function sendToBrowser(action, params = {}) {
  return new Promise((resolve, reject) => {
    if (!browserConnected) {
      return reject(new Error('No browser connected'));
    }

    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      delete pending[requestId];
      reject(new Error('Request timed out'));
    }, REQUEST_TIMEOUT);

    pending[requestId] = { resolve, reject, timer };
    writeNativeMessage({ type: 'command', requestId, action, ...params });
  });
}

// --- Unix Socket Server (for CLI connections) ---

const server = net.createServer((conn) => {
  let buf = '';

  conn.on('data', (chunk) => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop(); // keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        conn.write(JSON.stringify({ error: 'Invalid JSON' }) + '\n');
        continue;
      }
      handleCliRequest(msg, conn);
    }
  });

  conn.on('error', () => {});
});

async function handleCliRequest(msg, conn) {
  try {
    const { action, ...params } = msg;

    if (action === 'status') {
      const result = {
        browsers: browserConnected ? [browserName] : [],
      };
      conn.write(JSON.stringify(result) + '\n');
      return;
    }

    const data = await sendToBrowser(action, params);
    conn.write(JSON.stringify({ data }) + '\n');
  } catch (err) {
    conn.write(JSON.stringify({ error: err.message }) + '\n');
  }
}

// --- Cleanup ---

function cleanup() {
  try {
    server.close();
  } catch {}
  try {
    fs.unlinkSync(SOCKET_PATH);
  } catch {}
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

process.on('exit', () => {
  try {
    fs.unlinkSync(SOCKET_PATH);
  } catch {}
});

// --- Logging (stderr only, stdout is for native messaging) ---

const LOG_FILE = '/tmp/browsercli-native.log';

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stderr.write(`[native-host] ${msg}\n`);
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {}
}

// --- Start ---

log('Native host starting...');
log(`node ${process.version}, pid ${process.pid}`);

// Ensure stdin stays open and keeps event loop alive
process.stdin.resume();

// Catch uncaught errors so the process doesn't silently die
process.on('uncaughtException', (err) => {
  log(`Uncaught exception: ${err.message}\n${err.stack}`);
});

// Remove stale socket
try {
  fs.unlinkSync(SOCKET_PATH);
} catch {}

server.listen(SOCKET_PATH, () => {
  log(`Listening on ${SOCKET_PATH}`);
  try {
    fs.chmodSync(SOCKET_PATH, 0o600);
  } catch {}
});
