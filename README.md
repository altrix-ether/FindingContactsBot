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
npm run build --prefix client
npm start --prefix server
```

Serve the `client/dist` folder from Express or your host of choice and point the frontend at the same origin for `/api`.