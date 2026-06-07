# Aether_Core — ISK0 / USCS v6.1 Story Workshop

A step-by-step workshop for building complete, copy-paste-ready story packages for
the **ISK0 platform**, using the **USCS v6.1** framework under the hood. You
collaborate with an AI co-author through the pipeline (concept → setting → characters
→ guidelines → reminders → export); finished deliverables are captured into a
structured package with token-budget tracking, then exported as a single `.txt`.

The AI engine is your choice of:

- **Google Gemini** — has a free tier.
- **Anthropic Claude** — paid.
- **Mistral** — has a free tier (`console.mistral.ai`); recommended model `mistral-medium-latest`.
- **OpenRouter** — one key for GPT, Claude, Gemini, Grok, Llama and more (incl. free models).
- **Local Ollama** — runs models on your own machine, free and offline (self-host only — see below).

For the four cloud providers you supply an API key in the in-app **Settings** panel.
The **? (Help)** button in the app explains how to get each key.

---

## Run locally

**Prerequisites:** Node.js 20+

```bash
npm install
npm run dev
```

Open http://localhost:3010. Enter an API key in Settings and start building. No keys
are required to launch — you add them in the UI.

You can also set keys via a `.env` file (copy `.env.example` → `.env`), but for normal
use the in-app Settings panel is enough.

---

## Run with Docker (self-hosting)

```bash
docker compose up --build
```

Open http://localhost:3010.

### Local models (Ollama) — two ways

**A. Server-side (you self-host the app).** The app's *server* calls Ollama, so this works
when Ollama runs on the same machine as the app:

1. Install [Ollama](https://ollama.com) and pull a model: `ollama pull llama3`
2. Start Ollama so the container can reach it: `OLLAMA_HOST=0.0.0.0 ollama serve`
3. Enable it by setting `OLLAMA_BASE_URL` in a local `.env` (it's **empty by default**):
   `OLLAMA_BASE_URL=http://host.docker.internal:11434`

> ⚠️ Leave `OLLAMA_BASE_URL` empty on any **public or shared** deploy. The server makes the
> call, so `localhost` means the *server* — a non-empty value lets every visitor use the
> host's Ollama and hardware.

**B. Your own machine, via a hosted instance ("Use my own machine").** Anyone using a hosted
copy of Aether can run models on their *own* hardware — the browser connects straight to
their local Ollama, no server Ollama required. In **Settings → Ollama**, toggle **"Use my own
machine"**, then start Ollama allowing the site's origin (browsers block cross-origin requests
otherwise):

```bash
OLLAMA_ORIGINS="https://your-aether-site.example" ollama serve
```

The prompt is still assembled on the server (it injects the USCS spec), but the model runs
locally and your generated text never passes through the server. No API key needed.

---

## Deploy a public instance (Render)

This repo includes a `render.yaml` blueprint.

1. Push the repo to GitHub (already done if you cloned from there).
2. On [render.com](https://render.com): **New → Blueprint** → connect this repo.
3. Render builds the `Dockerfile` and gives you a public URL. It auto-redeploys on every push.

**Do NOT set any API keys** (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`)
on a public instance — leave them empty so each visitor supplies their own key in Settings.
Otherwise strangers would spend your credits.

> **Note for visitors:** because the app proxies AI calls, a key you enter passes *through*
> this server (used per request, never stored). If you don't want your key to transit a
> third-party server, self-host instead (it's open source).

**Server-side** Ollama doesn't work on a cloud deploy (there's no Ollama next to the server) —
keep `OLLAMA_BASE_URL` empty. But visitors who run Ollama locally can still use their *own*
models via **Settings → Ollama → "Use my own machine"** (the browser connects directly to
their machine); everyone else uses the four cloud providers.

---

## Environment variables

All are **optional** — the app works with keys entered in the UI. See `.env.example`.

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Default Gemini key (omit on public deploys). |
| `ANTHROPIC_API_KEY` | Default Claude key (omit on public deploys). |
| `MISTRAL_API_KEY` | Default Mistral key (omit on public deploys). |
| `OPENROUTER_API_KEY` | Default OpenRouter key (omit on public deploys). |
| `OLLAMA_BASE_URL` | Enables **server-side** Ollama (server calls it; `localhost` = the server). Empty by default — keep empty on public deploys. Self-host only; visitors use "Use my own machine" instead. |
| `OLLAMA_ALLOW_ANY` | Set `true` only on a trusted self-host to allow a non-local Ollama URL. Leave unset on public deploys (SSRF guard). |
| `PORT` | Listen port. Cloud hosts set this automatically. |
| `NODE_ENV` | `production` serves the built app. |

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server + API on port 3010. Client hot-reloads (Vite HMR); the USCS doc hot-reloads on change. |
| `npm run dev:watch` | Same as `dev`, plus auto-restart on server-side edits (`server.ts`, `uscs.ts`). |
| `npm run build` | Build client + bundle server to `dist/`. |
| `npm start` | Run the production build. |
| `npm run lint` | TypeScript type-check (`tsc --noEmit`). |
| `npm test` | Run the capture-layer unit tests (Vitest). |

---

## License & credits

- **Application code** — [MIT](./LICENSE) © 2026 **Shegs**. Use, modify, and
  redistribute freely; just keep the copyright notice.
- **USCS v6.1 framework** (`docs/USCS_v6.1.txt`) — a community effort by the
  **Isekai Zero community**, released into the public domain under **CC0 1.0**.
  No conditions, no attribution required — but credit the community anyway. ✨

Built by **@Shegs** — find me in the [ISK0 Discord](https://discord.com/servers/isekai-zero-1415040517594550282)
for feedback and ideas.

