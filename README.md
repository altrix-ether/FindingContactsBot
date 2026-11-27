# GitHub Contact Finder

Express API + React (Vite) app that accepts a GitHub profile or repository URL and returns the **owner’s** publicly discoverable contacts.

## What it finds

Scans GitHub profile, linked social accounts, bio/blog, profile README, public events, and **up to 40 public repos per owner** (URL repo first): each repo’s README, recent commits (author emails + message parsing), issues, releases, `package.json`, and `CONTRIBUTING.md` / `SECURITY.md` / similar files. Parses **20 contact types**, including:

email, Telegram, Discord, LinkedIn, WhatsApp, X/Twitter, website, GitHub, Facebook, Instagram, YouTube, Mastodon, Twitch, Reddit, phone, Signal, Skype, Medium, Matrix, Bluesky.

Only data users have made public on GitHub (or embedded in public text) is returned.

### Repository URL → all contributors

If the URL includes `owner/repo` (also `owner/repo` shorthand or `git@github.com:owner/repo.git`), the API:

1. Lists contributors (`/contributors`) plus logins from commit history (bots skipped).
2. For each person (default cap **50**), runs the full public contact scan with a smaller per-user repo cap (**5** by default).

Profile-only URLs still scan a single owner.

### Multiple repositories

Send several repo URLs (UI: one per line; API: `url` with newlines or `{ "urls": ["owner/a", ...] }`). Each repo is contributor-scanned; results are **merged** with a **Repository** column (default cap **10**, `SCAN_MAX_BATCH_REPOS`).

## Setup

```bash
npm run install:all
```

Optional: copy `server/.env.example` to `server/.env` and set `GITHUB_TOKEN` (classic PAT with no special scopes is enough for public data) to increase API rate limits.

## Run

```bash
npm run dev
```

- React UI: http://localhost:5173  
- API: http://localhost:3001  

The Vite dev server proxies `/api` to Express.

### API

`POST /api/lookup`

```json
{ "url": "https://github.com/torvalds/linux" }
```

## Production

```bash
npm run install:all
npm run build
npm start
```

Express serves `client/dist` and the API on the same origin. It listens on `::` (IPv4 and IPv6) and `PORT` (default `3001`).

## Railway

There is no Dockerfile. Railway's Node builder installs the npm workspaces, runs `npm run build`, and starts the app with `npm start`. One service serves the UI and the API.

1. Push the repo to GitHub and redeploy. The service builder should be Railpack. If a previous deploy stored a Dockerfile path or start command, clear both in the service settings.
2. Add a `GITHUB_TOKEN` variable (a classic personal access token with no extra scopes is enough for public data). Without it, unauthenticated GitHub rate limits will block lookups quickly.
3. Generate a public domain. Set its target port to the port in the deploy log line `Listening on http://0.0.0.0:NNNN`. Leave the `PORT` variable unset so Railway can assign it.

From a machine that is logged in to the Railway CLI:

```bash
railway up
railway domain
railway variable set GITHUB_TOKEN
```