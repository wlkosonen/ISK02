# Aether_Core (ISK02) — project guide

Working notes for Claude when developing this repo. Read before making changes.

A workshop UI (React + Vite client, Express/`tsx` server) that walks a creator
through building a USCS v6.1 story package — and, via the Dungeon Mind track
(USCS §27), a separate game-mechanics config — for the ISK0 platform. The server
proxies model calls to Gemini / Anthropic / OpenRouter / local Ollama. The app is
`src/App.tsx` (large, single file) plus `src/lib/capture.ts` (deliverable capture,
unit-tested). Built with Vite + esbuild.

## Environment
This is a Windows environment using PowerShell 5.1. Use PowerShell-native syntax
(e.g., `;` instead of `&&` for chaining commands); avoid bash-style separators.

## Working principles
- **Think before coding.** Don't assume, don't hide confusion — surface
  tradeoffs. When a request has multiple reasonable readings (which track/step
  it touches, whether to amend the verbatim USCS doc vs. the injected per-step
  directive in `uscs.ts`), present the options and ask rather than silently
  picking one.
- **Simplicity first.** Minimum code that solves the problem; nothing
  speculative. No unrequested features, premature abstractions, or defensive
  error handling the task doesn't need. The deployed package has a hard
  20k-token ceiling, so leaner output is a feature, not a compromise.
- **Surgical changes.** Touch only what the task requires; clean up only your
  own mess. `src/App.tsx` is large — match its existing patterns (components,
  Tailwind classes, `<<<USCS_BLOCK …>>>` capture conventions, sync tags) and
  don't refactor unrelated code unless asked.
- **Goal-driven execution.** Turn the request into verifiable success criteria,
  then loop until met (see *Before every push*). "Make it work" is not a
  checkpoint; "the DM step captures and its cap meter updates" is.

## Before every push — verify the build
Run all three and make sure they pass. Do not push red.

```bash
npm run lint    # tsc --noEmit — type check
npm test        # vitest — capture.ts unit tests (src/lib/*.test.ts)
npm run build   # vite build + esbuild server bundle
```

When the change is user-visible, also confirm the behaviour in the running
preview (port 3010), not just that it compiles.

## Version every user-facing change
When a change is visible to users, bump the version AND record it in-app. All
must move together:

1. `APP_VERSION` in `src/App.tsx` (search for `const APP_VERSION`).
2. `version` in `package.json` and `package-lock.json` (×2 — the root `version`
   and the `packages."".version` entry).
3. A new entry at the TOP of the `releases` array in the `VersionHistoryModal`
   component in `src/App.tsx` (newest first). Match the existing voice: a short
   `title`, then `items[]` explaining WHAT changed and WHY in plain language.

Use patch bumps (0.12.x) for fixes/small features, minor (0.x.0) for larger ones.
Pure infra/script changes that users never see (e.g. the deploy script) don't
need a version entry.

## Ollama / LLM Integration
- **Local models are SLOW on this hardware — wait at least 2 minutes before
  checking a result.** This is a personal machine, not a datacenter: a larger
  model (e.g. 26B) loading and then generating a big field like Game Rules can
  take well over a minute. Fire the request, then wait a single ~2-minute
  stretch (longer for the first call while the model loads, or for large
  fields) before reading the output **once**. Do NOT poll the screen/state
  every few seconds — repeatedly checking mid-generation just reads
  half-finished output and burns turns.
- **Context window:** Ollama defaults to a **4096-token** `num_ctx`, but our
  system prompts inject verbatim USCS sections (a single DM step is ~4,400
  tokens on its own). The bridge now sizes `num_ctx` to fit the prompt — if you
  ever see empty or single-character (`[`) responses, suspect prompt size vs.
  the context window first.
- **Reasoning models:** the bridge sends **`think: false`** so hybrid reasoning
  models (qwen3, deepseek-r1, gpt-oss…) answer directly. Without it they spend
  the whole budget in a `message.thinking` stream we don't read, which surfaces
  as a bogus "empty response". A safe retry drops the flag for models that
  reject it.
- **Temperature:** smaller local models ramble or break the `<<<USCS_BLOCK …>>>`
  capture formatting at the default temperature 1.0 — **~0.6** is the sweet spot
  for local models (cloud models are fine at 1.0).

## Development / Local Setup
- `npm run dev` runs `tsx server.ts` (no watch). `npm run dev:watch`
  (`tsx watch server.ts`) auto-restarts the process on server-side edits
  (`server.ts`, `uscs.ts`). **Use plain `dev` when launching through the
  Claude_Preview MCP** — that tool can't track `tsx watch`'s nested child
  (`npm → tsx watch → server`), so it hangs before the bind; single-process
  `dev` boots in ~2s. Use `dev:watch` in a manual terminal when iterating on
  server code. Vite runs as middleware in-process either way, so client edits
  (`src/App.tsx`) hot-reload via HMR without a restart.
- The **USCS master doc (`docs/USCS_v6.1.txt`) hot-reloads in dev**: `uscs.ts`
  `load()` re-reads it when its mtime changes, so doc edits — card HTML rules,
  §27, step ranges — take effect on the next AI call with no restart. In
  production it's parsed once and cached for the process lifetime.
- **Restarting the preview server clears the browser session** (sessionStorage
  is wiped), so any test state you seeded — provider/key, a captured character,
  a jumped-to step — is lost on restart. Re-seed it (write
  `aether_core_state_v1` to sessionStorage + reload) *after* the restart, not
  before, when validating doc/server changes against a live model.
- Dev/preview server listens on **port 3010**.

## Branching & deploy
- **Push ONLY when the user explicitly says to.** A push is a deploy (Render +
  Kiracy), so the user controls timing. Commit locally as work is verified, but
  never `git push` right after an iteration — wait to be told, then push the batch.
- When you do push, push directly to `main`. No feature branches, no PRs unless explicitly asked.
- The deploy server (Lazarus/Kiracy) pulls `main` and rebuilds Docker at the top
  of every hour via `scripts/aether-update.sh` (systemd timer). So merging to
  `main` is the deploy. To deploy immediately, SSH in and run
  `sudo systemctl start aether-update.service`.
- `.env` holds server secrets and is never committed or touched by the update
  script.

## Conventions
- TypeScript project — prefer typed interfaces for LLM request/response payloads
  and validate JSON config shapes (missing config fields should fail loudly, not
  silently produce empty output).
- Token counts go through `estimateTokens()` in `src/App.tsx`, which uses
  `gpt-tokenizer` (cl100k_base). Everything (budget gauge, caps) routes through
  it.
- Commit messages: clear and descriptive. Do not include any model identifier.

## Grok-Specific Rules (for this project)
- **Explicit confirmation required before code changes**: When the user is discussing ideas, feedback, or analysis, do **not** assume this is an instruction to implement. Before performing any code edits (search_replace, write, delete, etc.), always send a clear message such as "Implement the changes? (y/n)" or "Shall I proceed with these edits?" and wait for explicit affirmative confirmation from the user. Discussion points are discussion only until confirmed.
