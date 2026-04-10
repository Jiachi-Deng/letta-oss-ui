# Current State

This document is a snapshot of the reorganized workspace after migration and cleanup.

## Primary workspace

- Workspace root:
  - `/Users/jachi/Desktop/letta-workspace`
- Main app repo:
  - `/Users/jachi/Desktop/letta-workspace/app/letta-desktop`
- Vendor repos:
  - `/Users/jachi/Desktop/letta-workspace/vendor/letta-monorepo`
  - `/Users/jachi/Desktop/letta-workspace/vendor/letta-code`
  - `/Users/jachi/Desktop/letta-workspace/vendor/code-island`
  - `/Users/jachi/Desktop/letta-workspace/vendor/letta-code-sdk`
- Runtime:
  - `/Users/jachi/Desktop/letta-workspace/runtime/python/venv`
- Releases:
  - `/Users/jachi/Desktop/letta-workspace/releases/Letta-0.1.2-arm64-mac.zip`
  - `/Users/jachi/Desktop/letta-workspace/releases/Letta-0.1.2-arm64.dmg`

## Legacy archive workspace

- Archive/source backup:
  - `/Users/jachi/Desktop/letta-archive`
- This old workspace should no longer be used as the normal development home.

## Repo roles

- `app/letta-desktop`
  - desktop product
  - Electron
  - UI
  - packaging
  - bundled server and CodeIsland startup

- `vendor/letta-monorepo`
  - Python Letta server source

- `vendor/letta-code`
  - Node CLI runtime source

- `vendor/code-island`
  - notch app source

- `vendor/letta-code-sdk`
  - standard SDK fork with minimal Electron transport patch
- archived legacy SDK repo retained only on GitHub:
  - `https://github.com/Jiachi-Deng/letta-code-sdk-local`

## Current remote situation

The new workspace remotes have been cleaned up.

Current remotes:

- `app/letta-desktop`
  - origin -> `https://github.com/Jiachi-Deng/letta-oss-ui.git`
  - upstream -> `https://github.com/letta-ai/letta-oss-ui.git`
- `vendor/letta-monorepo`
  - origin -> `https://github.com/Jiachi-Deng/letta.git`
  - upstream -> `https://github.com/letta-ai/letta`
- `vendor/letta-code`
  - origin -> `https://github.com/Jiachi-Deng/letta-code.git`
  - upstream -> `https://github.com/letta-ai/letta-code.git`
- `vendor/code-island`
  - origin -> `https://github.com/Jiachi-Deng/CodeIsland.git`
  - upstream -> `https://github.com/wxtsky/CodeIsland.git`
- `vendor/letta-code-sdk`
  - origin -> `https://github.com/Jiachi-Deng/letta-code-sdk.git`
  - upstream -> `https://github.com/letta-ai/letta-code-sdk.git`

The new workspace no longer depends on local-path `origin` remotes.

## Current push strategy

- `app/letta-desktop`
  - local `main` tracks `origin/main`
- `vendor/letta-code-sdk`
  - local `main` tracks `origin/main`
- `vendor/letta-monorepo`
  - local `main` tracks `origin/main`
- `vendor/letta-code`
  - local `main` tracks `origin/main`
- `vendor/code-island`
  - local `main` tracks `origin/main`

Before aligning these forks, the previous remote `main` tips were backed up to `archive/pre-sync-main-20260408-211439` on each repo.

## Current repo cleanliness snapshot

At the time of writing:

- `app/letta-desktop`
  - clean
- `vendor/letta-monorepo`
  - no tracked modifications shown in the normal short status
- `vendor/letta-code`
  - clean
- `vendor/code-island`
  - clean
- `vendor/letta-code-sdk`
  - clean

## Size snapshot

- new workspace:
  - about `4.8G`
- old archive workspace:
  - about `452M`

## What is already validated

- new workspace can build the desktop app
- new workspace can rebuild bundled CodeIsland
- new workspace can rebuild the bundled Python Letta server
- staged server verification passes
- server smoke test passes
- release check passes against the new-workspace-built app bundle

## What remains as future cleanup

1. decide how long to keep the old archive workspace around
2. decide whether the root workspace docs should remain duplicated outside the repo-managed copies
