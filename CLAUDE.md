# CLAUDE.md

Working notes for Claude when developing this repo. Read before making changes.

## What this is

Aether_Core (a.k.a. ISK02) — a single-page React/TypeScript workshop for authoring
USCS story-instruction packages. The app is `src/App.tsx` (large, single file) plus
`src/lib/capture.ts` (deliverable capture, unit-tested). Served by `server.ts`
(Express). Built with Vite + esbuild.

## Before every push — verify the build

Run all three and make sure they pass. Do not push red.

```bash
npm run lint    # tsc --noEmit — type check
npm test        # vitest — capture.ts unit tests
npm run build   # vite build + esbuild server bundle
```

## Version every user-facing change

When a change is visible to users, bump the version AND record it in-app. All three
must move together:

1. `APP_VERSION` in `src/App.tsx` (search for `const APP_VERSION`).
2. `version` in `package.json`.
3. A new entry at the TOP of the `releases` array in the `VersionHistoryModal`
   component in `src/App.tsx` (newest first). Match the existing voice: a short
   `title`, then `items[]` explaining WHAT changed and WHY in plain language.

Use patch bumps (0.12.x) for fixes/small features, minor (0.x.0) for larger ones.
Pure infra/script changes that users never see (e.g. the deploy script) don't need
a version entry.

## Branching & deploy

- Push directly to `main`. No feature branches, no PRs unless explicitly asked.
- The deploy server (Lazarus/Kiracy) pulls `main` and rebuilds Docker at the top of
  every hour via `scripts/aether-update.sh` (systemd timer). So merging to `main` is
  the deploy. To deploy immediately, SSH in and run
  `sudo systemctl start aether-update.service`.
- `.env` holds server secrets and is never committed or touched by the update script.

## Conventions

- Token counts go through `estimateTokens()` in `src/App.tsx`, which uses
  `gpt-tokenizer` (cl100k_base). Everything (budget gauge, caps) routes through it.
- Commit messages: clear and descriptive. Do not include any model identifier.
