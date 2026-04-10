# Update Playbook

This is the recommended maintenance flow for future updates.

## Daily development

1. Start from `/Users/jachi/Desktop/letta-workspace`
2. Run `./scripts/doctor.sh`
3. Work mainly in `/Users/jachi/Desktop/letta-workspace/app/letta-desktop`
4. Use `./scripts/repo-status.sh` to see all repo changes

## Before building a release

1. Make sure the intended vendor repo patches are committed
2. Run:
   - `./scripts/build-release.sh`
3. Run:
   - `./scripts/verify-release.sh`

## When to change each repo

- Change `app/letta-desktop` for:
  - UI
  - Electron
  - packaging
  - startup orchestration
  - release checks

- Change `vendor/letta-monorepo` for:
  - Python Letta server behavior
  - provider server logic
  - API/server internals

- Change `vendor/letta-code` for:
  - Node CLI runtime behavior
  - BYOK CLI support
  - custom base URL support

- Change `vendor/code-island` for:
  - notch visuals
  - session display
  - activation logic

- Change `vendor/letta-code-sdk` only for:
  - SDK transport behavior
  - packaged Electron runtime glue

## Important constraints

1. Do not use `/Users/jachi/Desktop/letta-archive` as the normal development home anymore.
2. Do not treat `runtime/` or `releases/` as source repos.
3. Rebuild and re-verify after any vendor patch that affects packaging.
4. Prefer root helper scripts over memorizing deep commands.

## Current remote caveat

The new workspace now uses:

- `origin` for your GitHub forks
- `upstream` for the official upstream repos

That means:

1. normal upstream inspection should use `upstream`
2. normal push targets should use `origin`
3. the old archive workspace exists only as a manual filesystem backup

## Current fork nuance

The three vendor forks that previously had conflicting `origin/main` history were aligned by:

1. backing up the old fork `main` to `archive/pre-sync-main-20260408-211439`
2. force-updating fork `main` to the current local working state with `--force-with-lease`

This now applies cleanly to:

- `vendor/letta-monorepo`
- `vendor/letta-code`
- `vendor/code-island`
