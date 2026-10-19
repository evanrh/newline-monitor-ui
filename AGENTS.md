# AGENTS.md

## Project Overview

Web UI + backend for remotely controlling [NewLine interactive monitors](https://newline-interactive.com/usa/products/stv-plus-series/) (STV+ series) over their TCP-based remote control protocol. Node.js, no frameworks beyond Express. Work in progress: the device control library is functional, but the Express server and web UI are still scaffold-level.

## Stack

- **Runtime:** Node.js 26+, pure ES modules (`"type": "module"` in package.json — no CommonJS)
- **Web:** Express 5 (entry `main.js`, listens on `127.0.0.1:3000`) with EJS templates in `views/`
- **Types:** JavaScript with JSDoc annotations; `jsconfig.json` (currently empty) exists for TypeScript LSP support. There is no build step, no linter, no tests.

## Key Files

| Path | Purpose |
|---|---|
| `main.js` | Express entry point. Renders `views/index.ejs` at `/`. Does **not** import the device controller yet. |
| `lib/newline-controls.js` | `NewLineDeviceController` class — connects to a monitor via TCP port **6688**, sends control codes and parses responses. Power-on uses Wake-on-LAN (`wake_on_lan` pkg) instead of TCP. |
| `test-server/server.js` | Standalone mock monitor. A `net` server on port 6688 that simulates the protocol and keeps `DeviceState` so commands/queries can be exercised end-to-end without hardware. |
| `views/index.ejs` | Placeholder page ("Hello world!") with Bootstrap 5.3 loaded from CDN. |
| `config.json` | Device list: `{ devices: [{ ip, mac, name }] }`. Untracked in git — treat user-added entries as real data, don't commit. |

## Protocol Reference

Every message (request and response alike) is wrapped:

- **Prefix (8 bytes):** `7F 08 99 A2 B3 C4 02 FF`
- **Command (2 bytes):** `[type, value]` — e.g. power off is `[0x01, 0x01]`
- **Ending byte:** `0xCF`

Requests are 11 bytes total; responses are 12 bytes: prefix, the echoed command, a **status/result byte**, then the ending byte. The result byte position is `prefix.length + command.length` (index 10).

Rules of thumb:

- For most *control* commands the response echoes the command with `0x01` in the result byte — that's what `#simpleControl` compares against.
- For *queries* the result byte carries the value (volume, power state, etc.).
- **Backlight toggle (`[0x01, 0x15]`)** is the exception: its result byte is the new state (`0x01` = on, `0x00` = off), handled separately in `backlightToggle()`.
- Note the inconsistent-looking conventions baked into the real device: `queryBacklightStatus` and the toggle treat `0x00` as "on", while power/sleep/mute queries treat `0x01` as "on" — keep those quirks when touching query code.
- `powerOn()` does **not** send a TCP command; it sends a Wake-on-LAN magic packet to the device's MAC.
- `setVolume` and `setDisplayMode` pass the value directly as the second command byte.

When adding a command or query, update **both** `lib/newline-controls.js` and `test-server/server.js` so the mock stays in sync (the test server's `handleCommand` / `handleQuery` / `queryCodes` mirror the controller).

## Commands

```bash
npm start                 # start the Express UI server (http://127.0.0.1:3000)
npm run start:test-server # start the mock monitor on TCP port 6688
```

To test device logic without hardware: run the test server first, then instantiate `NewLineDeviceController` with `ipAddress: "127.0.0.1"` and any MAC. `config.json` is already set up to point at the test server.

## Conventions

- ESM imports only; no `.js` extension needed on relative imports in current usage.
- JSDoc types on public methods (`@param`/`@type`) — keep this up since it's the main "typing" mechanism.
- Private class methods use the `#` prefix (`#simpleControl`, `#query`).
- Protocol byte constants live at the top of each file rather than in a shared module (currently duplicated between controller and test server).
- Commit style: conventional commits with scope, e.g. `feat(backend):`, `feat(frontend):`.

## Known TODOs / Open Ends

- `main.js` doesn't wire up the controller, config.json, or any device API routes yet — only the index page renders.
- `lib/newline-controls.js` has an empty exported `QUERYING_CODES` object (a code registry was intended; see commit `f8a1465`).
- `restorePreviousOptions()` sends the command but doesn't parse the response (marked TODO in code).
- `signalSource()` command meaning is unclear (marked TODO in code).
- Useful reference docs (user manual + control codes cheat sheet PDFs) are linked in `README.md`.