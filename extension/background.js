// BrowserCLI Extension - Background Script
// Uses native messaging to communicate with the native host process

const api = globalThis.browser || globalThis.chrome;
const RECONNECT_DELAY = 3000;
const STORAGE_KEY = 'tabTracking';

let port = null;
let browserName = 'unknown';

// Detect browser
if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.getBrowserInfo) {
  browserName = 'firefox';
} else {
  browserName = 'chrome';
}

// --- Tab Tracking ---

async function loadTracking() {
  try {
    const result = await api.storage.local.get(STORAGE_KEY);
    return result[STORAGE_KEY] || {};
  } catch {
    return {};
  }
}

async function saveTracking(data) {
  await api.storage.local.set({ [STORAGE_KEY]: data });
}

async function updateTracking(tabId, updates) {
  const data = await loadTracking();
  data[tabId] = { ...(data[tabId] || {}), ...updates };
  await saveTracking(data);
}

async function removeTracking(tabId) {
  const data = await loadTracking();
  delete data[tabId];
  await saveTracking(data);
}

async function initTracking() {
  const tabs = await api.tabs.query({});
  const data = await loadTracking();
  const now = Date.now();
  let changed = false;

  for (const tab of tabs) {
    if (!data[tab.id]) {
      data[tab.id] = {
        createdAt: now,
        activationCount: 0,
        navigationCount: 0,
      };
      changed = true;
    }
  }

  const tabIds = new Set(tabs.map((t) => t.id));
  for (const id of Object.keys(data)) {
    if (!tabIds.has(parseInt(id, 10))) {
      delete data[id];
      changed = true;
    }
  }

  if (changed) await saveTracking(data);
}

// --- Event Listeners ---

api.tabs.onCreated.addListener(async (tab) => {
  await updateTracking(tab.id, {
    createdAt: Date.now(),
    activationCount: 0,
    navigationCount: 0,
  });
});

api.tabs.onActivated.addListener(async (activeInfo) => {
  const data = await loadTracking();
  const existing = data[activeInfo.tabId] || {};
  await updateTracking(activeInfo.tabId, {
    lastActivated: Date.now(),
    activationCount: (existing.activationCount || 0) + 1,
  });
});

api.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.url) {
    const data = await loadTracking();
    const existing = data[tabId] || {};
    await updateTracking(tabId, {
      lastUpdated: Date.now(),
      navigationCount: (existing.navigationCount || 0) + 1,
    });
  }
});

api.tabs.onRemoved.addListener(async (tabId) => {
  await removeTracking(tabId);
});

// --- Command Handlers ---

async function handleCommand(msg) {
  switch (msg.action) {
    case 'listTabs': {
      const tabs = await api.tabs.query({});
      const tracking = await loadTracking();
      return tabs.map((t) => ({
        id: t.id,
        windowId: t.windowId,
        index: t.index,
        title: t.title,
        url: t.url,
        active: t.active,
        pinned: t.pinned,
        audible: t.audible,
        discarded: t.discarded,
        status: t.status,
        openerTabId: t.openerTabId,
        tracking: tracking[t.id] || null,
      }));
    }

    case 'closeTab': {
      await api.tabs.remove(msg.tabId);
      return { success: true };
    }

    case 'closeTabs': {
      await api.tabs.remove(msg.tabIds);
      return { success: true };
    }

    case 'activateTab': {
      await api.tabs.update(msg.tabId, { active: true });
      const tab = await api.tabs.get(msg.tabId);
      await api.windows.update(tab.windowId, { focused: true });
      return { success: true };
    }

    case 'moveTab': {
      await api.tabs.move(msg.tabId, { windowId: msg.windowId, index: -1 });
      return { success: true };
    }

    case 'openTab': {
      const tab = await api.tabs.create({ url: msg.url });
      const tracking = await loadTracking();
      return {
        id: tab.id,
        windowId: tab.windowId,
        index: tab.index,
        title: tab.title,
        url: tab.url,
        active: tab.active,
        pinned: tab.pinned,
        status: tab.status,
        tracking: tracking[tab.id] || null,
      };
    }

    case 'listWindows': {
      const windows = await api.windows.getAll({ populate: true });
      return windows.map((w) => ({
        id: w.id,
        focused: w.focused,
        incognito: w.incognito,
        tabs: w.tabs ? w.tabs.map((t) => t.id) : [],
      }));
    }

    case 'getTrackingData': {
      return await loadTracking();
    }

    default:
      throw new Error(`Unknown action: ${msg.action}`);
  }
}

// --- Native Messaging Connection ---

function connectNative() {
  try {
    port = api.runtime.connectNative('browsercli');
  } catch (err) {
    console.error('[browsercli] Failed to connect to native host:', err);
    scheduleReconnect();
    return;
  }

  console.log('[browsercli] Connected to native host');

  // Send hello message so native host knows which browser we are
  port.postMessage({ type: 'hello', browser: browserName });

  port.onMessage.addListener(async (msg) => {
    if (msg.type !== 'command') return;

    try {
      const data = await handleCommand(msg);
      port.postMessage({ requestId: msg.requestId, data });
    } catch (err) {
      port.postMessage({ requestId: msg.requestId, error: err.message });
    }
  });

  port.onDisconnect.addListener(() => {
    const error = api.runtime.lastError;
    console.log('[browsercli] Disconnected from native host', error ? error.message : '');
    port = null;
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  setTimeout(() => {
    connectNative();
  }, RECONNECT_DELAY);
}

// --- Startup ---

console.log('[browsercli] Background script starting...');
initTracking().then(() => {
  console.log('[browsercli] Tracking initialized, connecting to native host...');
  connectNative();
}).catch((err) => {
  console.error('[browsercli] Init error:', err);
  connectNative();
});
