#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const NATIVE_HOST_PATH = path.resolve(__dirname, 'src', 'native-host.sh');
const HOST_NAME = 'browsercli';

const CHROME_EXTENSION_ID = process.argv[2] || null;

const manifests = {
  chrome: {
    dir: path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts'),
    content: () => ({
      name: HOST_NAME,
      description: 'BrowserCLI native messaging host',
      path: NATIVE_HOST_PATH,
      type: 'stdio',
      allowed_origins: CHROME_EXTENSION_ID
        ? [`chrome-extension://${CHROME_EXTENSION_ID}/`]
        : [],
    }),
  },
  firefox: {
    dir: path.join(os.homedir(), 'Library', 'Application Support', 'Mozilla', 'NativeMessagingHosts'),
    content: () => ({
      name: HOST_NAME,
      description: 'BrowserCLI native messaging host',
      path: NATIVE_HOST_PATH,
      type: 'stdio',
      allowed_extensions: ['browsercli@browsercli'],
    }),
  },
};

// Linux paths
if (process.platform === 'linux') {
  manifests.chrome.dir = path.join(os.homedir(), '.config', 'google-chrome', 'NativeMessagingHosts');
  manifests.firefox.dir = path.join(os.homedir(), '.mozilla', 'native-messaging-hosts');
}

function install() {
  // Ensure native host is executable
  try {
    fs.chmodSync(NATIVE_HOST_PATH, 0o755);
  } catch (err) {
    console.error(`Warning: Could not chmod native host: ${err.message}`);
  }

  for (const [browser, manifest] of Object.entries(manifests)) {
    const content = manifest.content();

    // Skip Chrome if no extension ID provided
    if (browser === 'chrome' && content.allowed_origins.length === 0) {
      console.log(`Skipping Chrome (no extension ID provided). Usage: node install.js <chrome-extension-id>`);
      continue;
    }

    const dir = manifest.dir;
    const filePath = path.join(dir, `${HOST_NAME}.json`);

    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(content, null, 2) + '\n');
      console.log(`Installed ${browser} native host manifest: ${filePath}`);
    } catch (err) {
      console.error(`Failed to install ${browser} manifest: ${err.message}`);
    }
  }
}

install();
