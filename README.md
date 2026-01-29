# BrowserCLI

Manage browser tabs from the command line.

```
$ browsercli list --format table
ID      Title                                   URL                                               Active  Age
--------------------------------------------------------------------------------------------------------------------
2       Why LLMs Can't Really Build Software …  https://zed.dev/blog/why-llms-cant-build-softwa…  yes     2d 3h
633     Cognition | Don't Build Multi-Agents    https://cognition.ai/blog/dont-build-multi-agen…  no      5d 1h
```

```
$ browsercli domains --sort count
{
  "domains": [
    { "domain": "x.com", "tabCount": 367 },
    { "domain": "github.com", "tabCount": 60 },
    ...
  ]
}
```

## Architecture

```
┌───────────┐   Unix socket    ┌──────────────┐  stdin/stdout   ┌───────────┐
│    CLI    │ ───────────────▶ │ Native Host  │ ◀────────────── │ Extension │
│           │ ◀─────────────── │  (node.js)   │ ───────────────▶│           │
└───────────┘ /tmp/browsercli  └──────────────┘  length-prefix  └───────────┘
                  .sock         launched by       JSON msgs
                                browser on
                                demand
```

The browser extension connects to a native messaging host via `browser.runtime.connectNative()`. The browser launches the host process automatically. The host listens on a Unix socket for CLI connections, and forwards commands to/from the extension over stdin/stdout.

No HTTP servers, no ports, no CORS, no TLS.

## Setup

```bash
npm install
browsercli install          # register native host with Firefox
browsercli install <ext-id> # also register with Chrome (pass your extension ID)
```

Then load the extension:

- **Firefox**: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → select `extension/manifest.json`
- **Chrome**: `chrome://extensions` → Developer mode → Load unpacked → select `extension/`

The extension console should show `Connected to native host`.

## Commands

```
browsercli status                       # show connected browsers
browsercli list [--format table|json]   # list all tabs
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

- **`src/native-host.js`** — The native messaging host. Reads/writes length-prefixed JSON on stdin/stdout (browser protocol). Listens on `/tmp/browsercli.sock` for CLI connections.
- **`src/client.js`** — Connects to the Unix socket, sends a command as newline-delimited JSON, reads the response.
- **`src/cli.js`** — CLI interface built with Commander. Batch operations (close by domain, close duplicates, domain aggregation) run client-side.
- **`extension/background.js`** — Calls `connectNative("browsercli")`, handles tab commands, tracks tab metadata (creation time, activation count, navigation count).
- **`install.js`** — Writes native host manifests to the browser-specific directories.

## Requirements

- Node.js
- Firefox and/or Chrome
- macOS or Linux
