#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOST_NAME = 'browsercli';
const SRC_DIR = path.resolve(__dirname, 'src');
const NODE_PATH = process.execPath;

const CHROME_EXTENSION_ID = process.argv[2] || null;

function manifestDirs() {
  if (process.platform === 'darwin') {
    return {
      chrome: path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts'),
      firefox: path.join(os.homedir(), 'Library', 'Application Support', 'Mozilla', 'NativeMessagingHosts'),
    };
  }
  if (process.platform === 'linux') {
    return {
      chrome: path.join(os.homedir(), '.config', 'google-chrome', 'NativeMessagingHosts'),
      firefox: path.join(os.homedir(), '.mozilla', 'native-messaging-hosts'),
    };
  }
  console.error(`Unsupported platform: ${process.platform}`);
  process.exit(1);
}

function generateWrapper(browser) {
  const script = path.join(SRC_DIR, 'native-host.js');
  return `#!/bin/bash\nexec "${NODE_PATH}" "${script}" ${browser}\n`;
}

function chromeManifest(hostPath) {
  return {
    name: HOST_NAME,
    description: 'BrowserCLI native messaging host',
    path: hostPath,
    type: 'stdio',
    allowed_origins: CHROME_EXTENSION_ID
      ? [`chrome-extension://${CHROME_EXTENSION_ID}/`]
      : [],
  };
}

function firefoxManifest(hostPath) {
  return {
    name: HOST_NAME,
    description: 'BrowserCLI native messaging host',
    path: hostPath,
    type: 'stdio',
    allowed_extensions: ['browsercli@browsercli'],
  };
}

function install() {
  const dirs = manifestDirs();

  console.log(`Using node: ${NODE_PATH}`);

  const browsers = {
    chrome: { dir: dirs.chrome, manifest: chromeManifest },
    firefox: { dir: dirs.firefox, manifest: firefoxManifest },
  };

  for (const [browser, config] of Object.entries(browsers)) {
    // Skip Chrome if no extension ID
    if (browser === 'chrome' && !CHROME_EXTENSION_ID) {
      console.log('Skipping Chrome (no extension ID provided). Usage: browsercli install <chrome-extension-id>');
      continue;
    }

    // Generate wrapper script with absolute node path
    const wrapperPath = path.join(SRC_DIR, `native-host-${browser}.sh`);
    fs.writeFileSync(wrapperPath, generateWrapper(browser));
    fs.chmodSync(wrapperPath, 0o755);

    // Write native host manifest
    const content = config.manifest(wrapperPath);
    fs.mkdirSync(config.dir, { recursive: true });
    const manifestPath = path.join(config.dir, `${HOST_NAME}.json`);
    fs.writeFileSync(manifestPath, JSON.stringify(content, null, 2) + '\n');

    console.log(`Installed ${browser}: ${manifestPath}`);
  }
}

install();
