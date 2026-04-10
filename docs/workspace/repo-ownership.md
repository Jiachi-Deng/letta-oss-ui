# Repo Ownership

This document explains which repo owns which part of the desktop product.

## Primary repo

`/Users/jachi/Desktop/letta-workspace/app/letta-desktop`

Owns:

- Electron main process
- React UI
- settings flow
- packaged app assembly
- bundled Letta server startup
- bundled CodeIsland startup
- release verification scripts

If you are changing app behavior first, start here.

## Vendor repos

### `/Users/jachi/Desktop/letta-workspace/vendor/letta-monorepo`

Owns:

- Python Letta server code
- provider logic
- agent / tools / server APIs

Touch this repo when the bundled Python server itself needs changes.

### `/Users/jachi/Desktop/letta-workspace/vendor/letta-code`

Owns:

- Node CLI runtime used by the desktop app
- compatible provider CLI behavior
- custom BYOK base URL support

Touch this repo when the Node-side runner or CLI integration needs changes.

### `/Users/jachi/Desktop/letta-workspace/vendor/code-island`

Owns:

- notch UI
- Letta status display
- Letta mascot / source handling
- socket self-healing

Touch this repo when the notch app or session display behavior needs changes.

### `/Users/jachi/Desktop/letta-workspace/vendor/letta-code-sdk`

Owns:

- Letta Code SDK fork
- Electron transport compatibility patch

Touch this repo only for SDK-level transport / packaging glue changes.

## Runtime and releases

`/Users/jachi/Desktop/letta-workspace/runtime`

- local Python runtime
- local caches
- not source of truth

`/Users/jachi/Desktop/letta-workspace/releases`

- final `.zip` / `.dmg` outputs
- not source of truth

## Rule of thumb

1. App wiring or packaging issue: change `app/letta-desktop`
2. Python server behavior issue: change `vendor/letta-monorepo`
3. Node CLI behavior issue: change `vendor/letta-code`
4. Notch / CodeIsland issue: change `vendor/code-island`
5. SDK transport / packaged runtime issue: change `vendor/letta-code-sdk`
