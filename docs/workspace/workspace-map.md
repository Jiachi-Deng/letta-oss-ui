# Letta Workspace Map

This document describes the current workspace layout under `/Users/jachi/Desktop/letta-archive`, what each directory is used for, what should be kept, what is rebuildable, and the recommended future structure for long-term maintenance.

## Current Situation

The current workspace mixes four different concerns in one place:

1. Product source code
2. Forked upstream repositories
3. Build/runtime caches
4. Release artifacts

That is why the workspace is hard to understand and maintain.

## Current Directory Map

### Core source repositories

These are the directories that matter most and should be treated as real source-of-truth repositories.

| Path | Role | Keep? | Notes |
|---|---|---:|---|
| `/Users/jachi/Desktop/letta-archive/letta-ui` | Main desktop product repo | Yes | Electron app, React UI, packaging scripts, bundled server + CodeIsland integration |
| `/Users/jachi/Desktop/letta-archive/letta` | Python Letta server source package | Yes | Root `letta` repo contains server/backend code used for bundled local server |
| `/Users/jachi/Desktop/letta-archive/letta-code` | Fork of `letta-code` | Yes | Local CLI/runtime fork with compatible provider changes |
| `/Users/jachi/Desktop/letta-archive/code-island` | Fork of CodeIsland | Yes | Bundled notch companion app |
| `/Users/jachi/Desktop/letta-archive/letta-code-sdk-local` | Local SDK fork | Archived legacy only | Small patched SDK fork formerly used by desktop app before `vendor/letta-code-sdk` replaced it |

### Build/runtime/cache directories

These are large and rebuildable. They should not be mentally treated as source code.

| Path | Role | Keep long-term? | Notes |
|---|---|---:|---|
| `/Users/jachi/Desktop/letta-archive/venv` | Local Python build/dev environment | No, as source | Rebuildable; should move under runtime/cache area |
| `/Users/jachi/Desktop/letta-archive/letta-ui/node_modules` | Desktop app JS dependencies | No, as source | Reinstallable |
| `/Users/jachi/Desktop/letta-archive/letta-ui/dist` | Packaged app outputs | No, as source | Release/build output only |
| `/Users/jachi/Desktop/letta-archive/letta-ui/build-resources` | Staged packaging resources | No, as source | Temporary packaging artifacts |
| `/Users/jachi/Desktop/letta-archive/code-island/.build` | Swift build output | No, as source | Rebuildable |
| `/Users/jachi/Desktop/letta-archive/letta-code/node_modules` | `letta-code` dependencies | No, as source | Reinstallable |
| `/Users/jachi/Desktop/letta-archive/letta-ui/letta-code` | Local nested install helper | No | Should not be treated as canonical source |

### Local configuration / machine-specific data

These may be useful locally, but they are not part of the clean product layout.

| Path | Role | Keep? | Notes |
|---|---|---:|---|
| `/Users/jachi/Desktop/letta-archive/.env` | Local secrets/config | Yes, locally | Do not treat as portable source |
| `/Users/jachi/Desktop/letta-archive/.letta` | Local Letta config | Maybe | Machine-local, not core source |
| `/Users/jachi/Desktop/letta-archive/certs` | Local TLS certs | Maybe | Machine-specific |
| `/Users/jachi/Desktop/letta-archive/db` | DB helper scripts | Maybe | Small utility folder |

### Secondary upstream/project directories

These are part of the larger upstream repo but are not first-line desktop product code.

| Path | Role | Keep for now? | Notes |
|---|---|---:|---|
| `/Users/jachi/Desktop/letta-archive/examples` | Examples | Optional | Can be archived later |
| `/Users/jachi/Desktop/letta-archive/tests` | Python tests | Yes for backend work | Valuable, but not day-to-day desktop code |
| `/Users/jachi/Desktop/letta-archive/assets` | Upstream assets | Optional | Keep unless proven unused |
| `/Users/jachi/Desktop/letta-archive/fern` | API tooling/assets | Optional | Keep unless migration confirms unused |
| `/Users/jachi/Desktop/letta-archive/otel` | Observability-related files | Optional | Keep for now |
| `/Users/jachi/Desktop/letta-archive/sandbox` | Sandbox tooling | Optional | Keep for now |
| `/Users/jachi/Desktop/letta-archive/scripts` | Utility scripts | Optional | Keep for now |
| `/Users/jachi/Desktop/letta-archive/alembic` | Database migrations | Yes | Backend migration support |

## Git Layout

The current workspace contains multiple nested standalone repositories, not submodules.

### Real repositories

- `/Users/jachi/Desktop/letta-archive/.git`
- `/Users/jachi/Desktop/letta-archive/letta-ui/.git`
- `/Users/jachi/Desktop/letta-archive/letta-code/.git`
- `/Users/jachi/Desktop/letta-archive/code-island/.git`
- `/Users/jachi/Desktop/letta-archive/letta-code-sdk-local/.git`

### Repository that should not be treated as a real project

- `/Users/jachi/Desktop/letta-archive/letta-ui/node_modules/@letta-ai/letta-code-sdk/.git`

That `.git` only exists because a local repo was installed into `node_modules`. It should disappear whenever dependencies are reinstalled or cleaned. It is not a true workspace repo.

## Recommended Future Structure

The recommended maintenance structure is:

```text
/Users/jachi/Desktop/letta-workspace
  app/
    letta-desktop/
  vendor/
    letta-server/
    letta-code/
    code-island/
    letta-code-sdk/
  runtime/
    python/
    node/
    build-cache/
  releases/
    Letta-0.1.2-arm64.dmg
    Letta-0.1.2-arm64-mac.zip
  docs/
    workspace-map.md
```

## Maintenance Model

### `app/letta-desktop`

This should become the single main product repo.

It owns:

- Electron main process
- React UI
- packaging
- settings UX
- startup orchestration
- bundled server lifecycle
- bundled CodeIsland lifecycle
- release validation scripts

### `vendor/*`

These are upstream forks and should stay separate from the main product repo.

- `vendor/letta-server`: Python backend fork
- `vendor/letta-code`: CLI/runtime fork
- `vendor/code-island`: notch companion fork
- `vendor/letta-code-sdk`: SDK fork

This separation makes upstream updates much easier.

### `runtime/*`

This is rebuildable machine state, not product source.

- Python virtualenvs
- `node_modules`
- staging resources
- compiler output
- temporary bundles

### `releases/*`

Only final user-facing installable artifacts go here.

## What Can Be Deleted Later

These are safe to delete only after the new workspace layout is working and builds pass from the new structure:

- `/Users/jachi/Desktop/letta-archive/venv`
- `/Users/jachi/Desktop/letta-archive/letta-ui/node_modules`
- `/Users/jachi/Desktop/letta-archive/letta-ui/dist`
- `/Users/jachi/Desktop/letta-archive/letta-ui/build-resources`
- `/Users/jachi/Desktop/letta-archive/code-island/.build`
- `/Users/jachi/Desktop/letta-archive/letta-code/node_modules`
- `/Users/jachi/Desktop/letta-archive/letta-ui/letta-code`

Do **not** delete them before the new workspace has been migrated and validated.

## Migration Strategy

### Phase 1: Freeze current state

Before restructuring:

- make sure all current repos are committed
- keep the current working setup intact
- treat current packaged app as a known-good baseline

### Phase 2: Create a clean new workspace

Do not clean in place first.

Instead:

- create a fresh workspace root
- move or clone source repos into `app/` and `vendor/`
- leave the old workspace untouched as rollback

### Phase 3: Update path assumptions

The desktop app currently relies on many relative sibling paths.

These scripts/files will need path updates during migration:

- `/Users/jachi/Desktop/letta-archive/letta-ui/package.json`
- `/Users/jachi/Desktop/letta-archive/letta-ui/electron-builder.json`
- `/Users/jachi/Desktop/letta-archive/letta-ui/scripts/build-codeisland.mjs`
- `/Users/jachi/Desktop/letta-archive/letta-ui/scripts/build-letta-server.mjs`
- `/Users/jachi/Desktop/letta-archive/letta-ui/scripts/sync-letta-code.mjs`
- `/Users/jachi/Desktop/letta-archive/letta-ui/src/electron/libs/bundled-codeisland.ts`
- `/Users/jachi/Desktop/letta-archive/letta-ui/src/electron/libs/bundled-letta-server.ts`
- `/Users/jachi/Desktop/letta-archive/letta-ui/src/electron/libs/provider-bootstrap.ts`

### Phase 4: Separate caches from source

Once the new workspace builds successfully:

- relocate Python runtime/build artifacts
- relocate JS dependency caches
- relocate packaging staging directories
- keep releases in their own folder

### Phase 5: Remove old rebuildable artifacts

Only after the new workspace has passed:

- build
- package
- release validation
- install smoke tests

then old caches and build outputs can be deleted safely from the current workspace.

## Recommended Immediate Next Step

The next practical step is **not** deleting anything.

The next practical step is:

1. create a new clean workspace root
2. move/copy source repos into the `app/` + `vendor/` structure
3. fix path assumptions
4. rebuild
5. only then clean old caches

## Summary

The workspace is currently confusing because it mixes:

- product code
- forked upstream code
- caches
- build outputs
- release outputs

The long-term fix is to separate them into:

- `app`
- `vendor`
- `runtime`
- `releases`

That is the structure that will make future upgrades, packaging, and maintenance much easier.
