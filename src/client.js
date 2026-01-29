'use strict';

const net = require('net');
const fs = require('fs');

const SOCKET_PATH = '/tmp/browsercli.sock';
const TIMEOUT = 10000;

function request(msg) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(SOCKET_PATH)) {
      reject(new Error(
        'Native host is not running. Make sure:\n' +
        '  1. Run "node install.js" to register the native host\n' +
        '  2. Open your browser with the BrowserCLI extension installed\n' +
        '  3. The extension will auto-launch the native host'
      ));
      return;
    }

    const conn = net.connect(SOCKET_PATH);
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
        if (err.code === 'ECONNREFUSED' || err.code === 'ENOENT') {
          reject(new Error(
            'Cannot connect to native host. Make sure your browser is open with the BrowserCLI extension.'
          ));
        } else {
          reject(err);
        }
      }
    });
  });
}

async function listTabs(browser) {
  const tabs = await request({ action: 'listTabs' });
  return { tabs: tabs.map((t) => formatTab(t, browser)) };
}

async function listWindows(browser) {
  const windows = await request({ action: 'listWindows' });
  return {
    windows: windows.map((w) => ({
      id: `w${w.id}`,
      focused: w.focused,
      incognito: w.incognito,
      tabCount: w.tabs ? w.tabs.length : 0,
    })),
  };
}

async function closeTab(id) {
  const tabId = parseTabId(id);
  await request({ action: 'closeTab', tabId });
  return { success: true, closed: id };
}

async function closeTabs(tabIds) {
  const ids = tabIds.map(parseTabId);
  await request({ action: 'closeTabs', tabIds: ids });
  return { success: true, closed: tabIds, count: tabIds.length };
}

async function activateTab(id) {
  const tabId = parseTabId(id);
  await request({ action: 'activateTab', tabId });
  return { success: true, activated: id };
}

async function moveTab(id, windowId) {
  const tabId = parseTabId(id);
  const winId = parseWindowId(windowId);
  await request({ action: 'moveTab', tabId, windowId: winId });
  return { success: true, moved: id, windowId };
}

async function openTab(url) {
  const tab = await request({ action: 'openTab', url });
  return { success: true, tab: formatTab(tab) };
}

async function getStatus() {
  return request({ action: 'status' });
}

// --- Helpers ---

function formatTab(tab, filterBrowser) {
  let domain = null;
  try {
    domain = new URL(tab.url).hostname;
  } catch {}

  const result = {
    id: String(tab.id),
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
};
