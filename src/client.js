'use strict';

const net = require('net');
const fs = require('fs');

const KNOWN_BROWSERS = ['firefox', 'chrome'];
const TIMEOUT = 10000;

function socketPath(browser) {
  return `/tmp/tabctl-${browser}.sock`;
}

function findSockets(filterBrowser) {
  const browsers = filterBrowser ? [filterBrowser] : KNOWN_BROWSERS;
  return browsers
    .map((b) => ({ browser: b, path: socketPath(b) }))
    .filter((s) => fs.existsSync(s.path));
}

function requestOne(socketFile, msg) {
  return new Promise((resolve, reject) => {
    const conn = net.connect(socketFile);
    let buf = '';
    let done = false;

    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        conn.destroy();
        reject(new Error('Request timed out'));
      }
    }, TIMEOUT);

    conn.on('connect', () => {
      conn.write(JSON.stringify(msg) + '\n');
    });

    conn.on('data', (chunk) => {
      buf += chunk.toString();
      const idx = buf.indexOf('\n');
      if (idx !== -1) {
        done = true;
        clearTimeout(timer);
        const line = buf.slice(0, idx);
        conn.destroy();
        try {
          const resp = JSON.parse(line);
          if (resp.error) {
            reject(new Error(resp.error));
          } else {
            resolve(resp.data !== undefined ? resp.data : resp);
          }
        } catch {
          reject(new Error('Invalid response from native host'));
        }
      }
    });

    conn.on('error', (err) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

function request(msg, filterBrowser) {
  const sockets = findSockets(filterBrowser);
  if (sockets.length === 0) {
    throw new Error(
      'No browsers connected. Make sure:\n' +
      '  1. Run "tabctl install" to register the native host\n' +
      '  2. Open your browser with the tabctl extension installed\n' +
      '  3. The extension will auto-launch the native host'
    );
  }
  // Use first available socket for single-browser commands
  return requestOne(sockets[0].path, msg);
}

async function requestAll(msg, filterBrowser) {
  const sockets = findSockets(filterBrowser);
  if (sockets.length === 0) {
    throw new Error(
      'No browsers connected. Make sure:\n' +
      '  1. Run "tabctl install" to register the native host\n' +
      '  2. Open your browser with the tabctl extension installed\n' +
      '  3. The extension will auto-launch the native host'
    );
  }
  const results = await Promise.allSettled(
    sockets.map((s) => requestOne(s.path, msg).then((data) => ({ browser: s.browser, data })))
  );
  return results
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value);
}

async function listTabs(browser) {
  const results = await requestAll({ action: 'listTabs' }, browser);
  const tabs = [];
  for (const r of results) {
    for (const t of r.data) {
      tabs.push(formatTab(t, r.browser));
    }
  }
  return { tabs };
}

async function listWindows(browser) {
  const results = await requestAll({ action: 'listWindows' }, browser);
  const windows = [];
  for (const r of results) {
    for (const w of r.data) {
      windows.push({
        id: `w${w.id}`,
        browser: r.browser,
        focused: w.focused,
        incognito: w.incognito,
        tabCount: w.tabs ? w.tabs.length : 0,
      });
    }
  }
  return { windows };
}

async function closeTab(id) {
  const { browser, tabId } = parsePrefixedId(id);
  await request({ action: 'closeTab', tabId }, browser);
  return { success: true, closed: id };
}

async function closeTabs(tabIds) {
  // Group by browser
  const groups = {};
  for (const id of tabIds) {
    const { browser, tabId } = parsePrefixedId(id);
    if (!groups[browser]) groups[browser] = [];
    groups[browser].push(tabId);
  }
  for (const [browser, ids] of Object.entries(groups)) {
    await request({ action: 'closeTabs', tabIds: ids }, browser);
  }
  return { success: true, closed: tabIds, count: tabIds.length };
}

async function activateTab(id) {
  const { browser, tabId } = parsePrefixedId(id);
  await request({ action: 'activateTab', tabId }, browser);
  return { success: true, activated: id };
}

async function moveTab(id, windowId) {
  const { browser, tabId } = parsePrefixedId(id);
  const winId = parseWindowId(windowId);
  await request({ action: 'moveTab', tabId, windowId: winId }, browser);
  return { success: true, moved: id, windowId };
}

async function openTab(url, browser) {
  const tab = await request({ action: 'openTab', url }, browser);
  return { success: true, tab: formatTab(tab, browser) };
}

async function getStatus() {
  const sockets = findSockets();
  if (sockets.length === 0) {
    return { browsers: [] };
  }
  const results = await Promise.allSettled(
    sockets.map((s) => requestOne(s.path, { action: 'status' }).then((data) => ({ browser: s.browser, data })))
  );
  const browsers = results
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value.browser);
  return { browsers };
}

// --- Helpers ---

function formatTab(tab, browser) {
  let domain = null;
  try {
    domain = new URL(tab.url).hostname;
  } catch {}

  const prefix = browser ? `${browser}:` : '';

  const result = {
    id: `${prefix}${tab.id}`,
    browser: browser || null,
    windowId: `w${tab.windowId}`,
    index: tab.index,
    title: tab.title || '',
    url: tab.url || '',
    domain,
    active: tab.active || false,
    pinned: tab.pinned || false,
    audible: tab.audible || false,
    discarded: tab.discarded || false,
    status: tab.status || 'unknown',
  };

  if (tab.openerTabId != null) {
    result.openerTabId = String(tab.openerTabId);
  }

  if (tab.tracking) {
    const t = tab.tracking;
    result.createdAt = t.createdAt ? new Date(t.createdAt).toISOString() : null;
    result.lastActivated = t.lastActivated ? new Date(t.lastActivated).toISOString() : null;
    result.lastUpdated = t.lastUpdated ? new Date(t.lastUpdated).toISOString() : null;
    result.activationCount = t.activationCount || 0;
    result.navigationCount = t.navigationCount || 0;
    if (t.createdAt) {
      result.age = formatAge(Date.now() - t.createdAt);
    }
  }

  return result;
}

function formatAge(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

function parsePrefixedId(id) {
  const str = String(id);
  const colonIdx = str.indexOf(':');
  if (colonIdx !== -1) {
    const browser = str.slice(0, colonIdx);
    const tabId = parseInt(str.slice(colonIdx + 1), 10);
    if (isNaN(tabId)) throw new Error(`Invalid tab ID: ${id}`);
    return { browser, tabId };
  }
  // No prefix — find which browser has this tab by trying all sockets
  const tabId = parseInt(str, 10);
  if (isNaN(tabId)) throw new Error(`Invalid tab ID: ${id}`);
  const sockets = findSockets();
  return { browser: sockets.length === 1 ? sockets[0].browser : null, tabId };
}

function parseTabId(id) {
  const n = parseInt(id, 10);
  if (isNaN(n)) throw new Error(`Invalid tab ID: ${id}`);
  return n;
}

function parseWindowId(id) {
  const match = String(id).match(/^w?(\d+)$/);
  if (!match) throw new Error(`Invalid window ID: ${id}`);
  return parseInt(match[1], 10);
}

module.exports = {
  listTabs,
  listWindows,
  closeTab,
  closeTabs,
  activateTab,
  moveTab,
  openTab,
  getStatus,
  _internal: {
    formatAge,
    formatTab,
    parsePrefixedId,
    parseTabId,
    parseWindowId,
  },
};
