# BrowserCLI

Manage browser tabs from the command line. Works with Firefox and Chrome simultaneously.

```
$ browsercli list --format table
ID              Title                                   URL                                               Active  Age
----------------------------------------------------------------------------------------------------------------------------
firefox:2       Why LLMs Can't Really Build Software …  https://zed.dev/blog/why-llms-cant-build-softwa…  yes     2d 3h
chrome:41       Cognition | Don't Build Multi-Agents    https://cognition.ai/blog/dont-build-multi-agen…  no      5d 1h
```

```
$ browsercli status
{
  "browsers": ["firefox", "chrome"]
}
```

## Architecture

```
                                ┌──────────────┐  stdin/stdout   ┌───────────┐
                         ┌────▶│ Native Host  │◀────────────────│  Firefox  │
┌───────────┐            │     │  (node.js)   │────────────────▶│ Extension │
│           │  Unix      │     └──────────────┘  length-prefix  └───────────┘
│    CLI    │  sockets   │      /tmp/browsercli   JSON msgs
│           │────────────┤       -firefox.sock
└───────────┘            │
                         │     ┌──────────────┐  stdin/stdout   ┌───────────┐
                         └────▶│ Native Host  │◀────────────────│  Chrome   │
                               │  (node.js)   │────────────────▶│ Extension │
                               └──────────────┘  length-prefix  └───────────┘
                                /tmp/browsercli   JSON msgs
                                 -chrome.sock
```

Each browser launches its own native host process via `browser.runtime.connectNative()`. Each host listens on a separate Unix socket. The CLI queries all sockets and aggregates results.

No HTTP servers, no ports, no CORS, no TLS.

## Setup

```bash
npm install
browsercli install                      # register native host with Firefox
browsercli install <chrome-extension-id> # also register with Chrome
```

The install step detects your node path and generates the shell wrappers automatically, so it works across macOS and Linux regardless of how node is installed (homebrew, nvm, etc.).

Then load the extension:

- **Firefox**: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → select `extension/manifest.json`
- **Chrome**: `chrome://extensions` → Developer mode → Load unpacked → select `extension/`

The extension console should show `Connected to native host`.

## Commands

Tab IDs are prefixed with the browser name (e.g. `firefox:123`, `chrome:456`).

```
browsercli status                       # show connected browsers
browsercli list [--format table|json]   # list all tabs (both browsers)
browsercli list --browser firefox       # filter by browser
browsercli close <id>                   # close a tab
browsercli close --domain <domain>      # close all tabs from a domain
browsercli close --older-than <dur>     # close tabs older than 7d, 24h, 30m
browsercli close --duplicates           # close duplicate URLs
browsercli activate <id>                # focus a tab
browsercli open <url>                   # open a new tab
browsercli move <id> -w <window-id>     # move tab to another window
browsercli windows                      # list windows
browsercli domains [--sort count|name]  # group tabs by domain
```

## How it works

- **`src/native-host.js`** — The native messaging host. Reads/writes length-prefixed JSON on stdin/stdout (browser protocol). Listens on `/tmp/browsercli-<browser>.sock` for CLI connections. One instance per browser.
- **`src/client.js`** — Discovers all browser sockets, sends commands, aggregates results. Routes tab-specific commands to the correct browser based on the ID prefix.
- **`src/cli.js`** — CLI interface built with Commander. Batch operations (close by domain, close duplicates, domain aggregation) run client-side.
- **`extension/background.js`** — Calls `connectNative("browsercli")`, handles tab commands, tracks tab metadata (creation time, activation count, navigation count).
- **`install.js`** — Detects the current node path, generates per-browser shell wrappers, and writes native host manifests to browser-specific directories.

## Requirements

- Node.js
- Firefox and/or Chrome
- macOS or Linux
