const { program } = require('commander');
const client = require('./client');
const { execSync } = require('child_process');
const path = require('path');

program
  .name('tabctl')
  .description('Browser tab management CLI')
  .version('1.0.0');

// --- Output formatters ---

function outputJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

function outputTable(tabs) {
  if (tabs.length === 0) {
    console.log('No tabs found.');
    return;
  }
  const maxTitle = 40;
  const maxUrl = 50;

  console.log(
    pad('ID', 8) +
    pad('Title', maxTitle) +
    pad('URL', maxUrl) +
    pad('Active', 8) +
    'Age'
  );
  console.log('-'.repeat(8 + maxTitle + maxUrl + 8 + 10));

  for (const tab of tabs) {
    console.log(
      pad(tab.id, 8) +
      pad(truncate(tab.title, maxTitle - 2), maxTitle) +
      pad(truncate(tab.url, maxUrl - 2), maxUrl) +
      pad(tab.active ? 'yes' : 'no', 8) +
      (tab.age || '-')
    );
  }
}

function pad(str, len) {
  str = String(str || '');
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

function truncate(str, len) {
  str = String(str || '');
  return str.length <= len ? str : str.slice(0, len - 1) + '\u2026';
}

function parseDuration(str) {
  const match = str.match(/^(\d+)(d|h|m)$/);
  if (!match) throw new Error(`Invalid duration: ${str}. Use format like 7d, 24h, 30m`);
  const val = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers = { d: 86400000, h: 3600000, m: 60000 };
  return val * multipliers[unit];
}

// --- Commands ---

program
  .command('install')
  .description('Register native host with browsers')
  .argument('[chrome-extension-id]', 'Chrome extension ID (optional)')
  .action((extensionId) => {
    const installScript = path.resolve(__dirname, '..', 'install.js');
    const args = extensionId ? ` ${extensionId}` : '';
    try {
      execSync(`node "${installScript}"${args}`, { stdio: 'inherit' });
    } catch {
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List all tabs')
  .option('-b, --browser <browser>', 'Filter by browser (chrome, firefox)')
  .option('-f, --format <format>', 'Output format (json, table)', 'json')
  .action(async (opts) => {
    try {
      const data = await client.listTabs(opts.browser);
      if (opts.format === 'table') {
        outputTable(data.tabs);
      } else {
        outputJson(data);
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('close [tab-id]')
  .description('Close a tab or batch of tabs')
  .option('-d, --domain <domain>', 'Close all tabs from a domain')
  .option('--older-than <duration>', 'Close tabs older than duration (e.g. 7d, 24h, 30m)')
  .option('--duplicates', 'Close duplicate URLs (keep oldest)')
  .action(async (tabId, opts) => {
    try {
      if (opts.domain) {
        const data = await client.listTabs();
        const toClose = data.tabs.filter((t) => t.domain === opts.domain);
        if (toClose.length === 0) {
          console.log('No tabs found for that domain.');
          return;
        }
        const result = await client.closeTabs(toClose.map((t) => t.id));
        outputJson(result);
      } else if (opts.olderThan) {
        const ms = parseDuration(opts.olderThan);
        const cutoff = new Date(Date.now() - ms).toISOString();
        const data = await client.listTabs();
        const toClose = data.tabs.filter((t) => t.createdAt && t.createdAt < cutoff);
        if (toClose.length === 0) {
          console.log('No tabs older than that duration.');
          return;
        }
        const result = await client.closeTabs(toClose.map((t) => t.id));
        outputJson(result);
      } else if (opts.duplicates) {
        const data = await client.listTabs();
        const seen = {};
        const toClose = [];
        for (const tab of data.tabs) {
          if (!tab.url) continue;
          if (seen[tab.url]) {
            toClose.push(tab);
          } else {
            seen[tab.url] = tab;
          }
        }
        if (toClose.length === 0) {
          console.log('No duplicate tabs found.');
          return;
        }
        const result = await client.closeTabs(toClose.map((t) => t.id));
        outputJson(result);
      } else if (tabId) {
        const data = await client.closeTab(tabId);
        outputJson(data);
      } else {
        console.error('Error: provide a tab ID or use --domain, --older-than, or --duplicates');
        process.exit(1);
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('activate <tab-id>')
  .description('Activate (focus) a tab')
  .action(async (tabId) => {
    try {
      const data = await client.activateTab(tabId);
      outputJson(data);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('move <tab-id>')
  .description('Move a tab to a different window')
  .requiredOption('-w, --window <window-id>', 'Target window ID')
  .action(async (tabId, opts) => {
    try {
      const data = await client.moveTab(tabId, opts.window);
      outputJson(data);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('open <url>')
  .description('Open a new tab')
  .option('-b, --browser <browser>', 'Target browser')
  .action(async (url, opts) => {
    try {
      const data = await client.openTab(url, opts.browser);
      outputJson(data);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('windows')
  .description('List all windows')
  .option('-b, --browser <browser>', 'Filter by browser')
  .action(async (opts) => {
    try {
      const data = await client.listWindows(opts.browser);
      outputJson(data);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('domains')
  .description('Group tabs by domain')
  .option('-s, --sort <sort>', 'Sort by count or name', 'count')
  .action(async (opts) => {
    try {
      const data = await client.listTabs();
      const domainMap = {};
      for (const tab of data.tabs) {
        const domain = tab.domain || '(no domain)';
        if (!domainMap[domain]) {
          domainMap[domain] = { domain, tabCount: 0, tabs: [], oldestTab: null, newestTab: null };
        }
        const d = domainMap[domain];
        d.tabCount++;
        d.tabs.push(tab.id);
        const created = tab.createdAt || null;
        if (created) {
          if (!d.oldestTab || created < d.oldestTab) d.oldestTab = created;
          if (!d.newestTab || created > d.newestTab) d.newestTab = created;
        }
      }

      let domains = Object.values(domainMap);
      if (opts.sort === 'name') {
        domains.sort((a, b) => a.domain.localeCompare(b.domain));
      } else {
        domains.sort((a, b) => b.tabCount - a.tabCount);
      }

      outputJson({ domains });
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show connected browsers')
  .action(async () => {
    try {
      const data = await client.getStatus();
      outputJson(data);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

program.parse();
