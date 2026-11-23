import {
  addContact,
  collectFromSocialAccounts,
  collectFromUserProfile,
  extractContactsFromText,
  summarizeContacts,
} from "./contacts.js";
import { scanUserRepos } from "./repoScan.js";

const GITHUB_API = "https://api.github.com";

function scanLimitsFromEnv() {
  return {
    maxRepos: Math.min(Number(process.env.SCAN_MAX_REPOS) || 40, 100),
    commitsPerRepo: Math.min(
      Number(process.env.SCAN_COMMITS_PER_REPO) || 30,
      100,
    ),
    issuesPerRepo: Math.min(Number(process.env.SCAN_ISSUES_PER_REPO) || 8, 30),
    releasesPerRepo: Math.min(
      Number(process.env.SCAN_RELEASES_PER_REPO) || 5,
      20,
    ),
    concurrency: Math.min(Number(process.env.SCAN_CONCURRENCY) || 4, 8),
  };
}

export function parseGithubUrl(input) {
  const trimmed = input.trim();

  const gitMatch = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (gitMatch) {
    return { owner: gitMatch[1], repo: gitMatch[2].replace(/\.git$/i, "") };
  }

  const slashMatch = trimmed.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (slashMatch && !trimmed.includes("://")) {
    return { owner: slashMatch[1], repo: slashMatch[2] };
  }

  let url;
  try {
    url = trimmed.startsWith("http")
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`);
  } catch {
    return { error: "Invalid URL" };
  }

  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    return { error: "URL must be a github.com link" };
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return { error: "Could not find a GitHub username in this URL" };
  }

  const owner = segments[0];
  const repo = segments[1]?.replace(/\.git$/i, "") ?? null;

  return { owner, repo };
}

export function parseGithubUrlList(input) {
  const raw = Array.isArray(input)
    ? input
    : String(input ?? "")
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);

  const parsed = [];
  const parseErrors = [];
  const seen = new Set();

  for (const part of raw) {
    const p = parseGithubUrl(part);
    if (p.error) {
      parseErrors.push({ input: part, error: p.error });
      continue;
    }
    const key = p.repo
      ? `${p.owner}/${p.repo}`.toLowerCase()
      : `user:${p.owner.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push({ ...p, input: part });
  }

  return { parsed, parseErrors };
}

function githubHeaders(token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "github-email-bot",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export function rateLimitFromResponse(res, tokenConfigured) {
  const limit = res.headers.get("x-ratelimit-limit");
  const remaining = res.headers.get("x-ratelimit-remaining");
  const reset = res.headers.get("x-ratelimit-reset");
  const used = res.headers.get("x-ratelimit-used");
  const resource = res.headers.get("x-ratelimit-resource");
  if (limit == null && remaining == null && reset == null) return null;
  const resetSec = reset != null ? Number(reset) : null;
  return {
    resource: resource || "core",
    limit: limit != null ? Number(limit) : null,
    remaining: remaining != null ? Number(remaining) : null,
    used: used != null ? Number(used) : null,
    resetAt: Number.isFinite(resetSec) ? new Date(resetSec * 1000).toISOString() : null,
    tokenConfigured: Boolean(tokenConfigured),
  };
}

export function rateLimitErrorMessage(rateLimit) {
  const limit = rateLimit?.limit ?? "the hourly";
  const used = rateLimit?.used ?? rateLimit?.limit ?? "all";
  if (rateLimit?.tokenConfigured) {
    return `GitHub token rate limit is used up (${used} of ${limit} core requests).`;
  }
  return `GitHub unauthenticated rate limit is used up (${used} of ${limit} requests this hour).`;
}

export async function fetchGithubQuota(token) {
  const tokenConfigured = Boolean(token && String(token).trim());
  const res = await fetch(`${GITHUB_API}/rate_limit`, {
    headers: githubHeaders(tokenConfigured ? token : undefined),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      if (body?.message) detail = `: ${body.message}`;
    } catch {
      /* ignore */
    }
    return {
      error:
        res.status === 401
          ? `GitHub rejected the token (401)${detail}. Check GITHUB_TOKEN in server/.env.`
          : `GitHub API error (${res.status})${detail}`,
      status: res.status,
      tokenConfigured,
      ...(rateLimitFromResponse(res, tokenConfigured) ?? {}),
    };
  }
  const body = await res.json();
  const core = body?.resources?.core ?? {};
  return {
    tokenConfigured,
    resource: "core",
    limit: core.limit ?? null,
    remaining: core.remaining ?? null,
    used: core.used ?? null,
    resetAt: core.reset ? new Date(core.reset * 1000).toISOString() : null,
  };
}

export async function githubFetch(path, token) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: githubHeaders(token),
  });

  if (res.status === 404) {
    return {
      error: "GitHub user or repository not found",
      status: 404,
      notFound: true,
    };
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      if (body?.message) detail = `: ${body.message}`;
    } catch {
      /* ignore */
    }
    if (res.status === 403) {
      const rateLimit = rateLimitFromResponse(res, token);
      if (rateLimit?.remaining === 0) {
        return {
          error: rateLimitErrorMessage(rateLimit),
          status: 403,
          rateLimit,
        };
      }
    }
    if (res.status === 401) {
      return {
        error: `GitHub rejected the token (401)${detail}. Check GITHUB_TOKEN in server/.env.`,
        status: 401,
      };
    }
    return {
      error: `GitHub API error (${res.status})${detail}`,
      status: res.status,
    };
  }

  return { data: await res.json() };
}

function isLikelyRealEmail(email) {
  if (!email || typeof email !== "string") return false;
  if (email.endsWith("@users.noreply.github.com")) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function collectEmailsFromEvents(events) {
  const emails = new Set();
  for (const event of events) {
    const commits = event.payload?.commits;
    if (!Array.isArray(commits)) continue;
    for (const commit of commits) {
      const email = commit.author?.email;
      if (isLikelyRealEmail(email)) emails.add(email);
    }
  }
  return [...emails];
}

async function fetchProfileReadmeText(owner, token) {
  const result = await githubFetch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(owner)}/readme`,
    token,
  );
  if (result.error || !result.data?.content) return null;
  try {
    return Buffer.from(result.data.content, "base64").toString("utf8");
  } catch {
    return null;
  }
}

export async function lookupOwnerContacts(owner, token, options = {}) {
  const priorityRepo = options.priorityRepo ?? null;
  const briefNote = options.briefNote ?? false;
  const onProgress = options.onProgress;
  const limits = { ...scanLimitsFromEnv(), ...(options.limits ?? {}) };
  if (options.maxRepos != null) {
    limits.maxRepos = Math.min(Number(options.maxRepos), 100);
  }

  onProgress?.({
    event: "progress",
    stage: "profile",
    message: `Loading GitHub profile @${owner}…`,
  });

  const userResult = await githubFetch(
    `/users/${encodeURIComponent(owner)}`,
    token,
  );
  if (userResult.error) {
    return userResult;
  }

  const user = userResult.data;
  const contacts = [];
  const seen = new Set();

  collectFromUserProfile(user, contacts, seen);

  if (isLikelyRealEmail(user.email)) {
    addContact(contacts, seen, {
      type: "email",
      value: user.email,
      source: "profile_email",
    });
  }

  onProgress?.({
    event: "progress",
    stage: "profile",
    message: `Fetching social accounts for @${user.login}…`,
  });

  const socialResult = await githubFetch(
    `/users/${encodeURIComponent(owner)}/social_accounts`,
    token,
  );
  if (socialResult.data) {
    collectFromSocialAccounts(socialResult.data, contacts, seen);
  }

  onProgress?.({
    event: "progress",
    stage: "profile",
    message: `Loading recent activity for @${user.login}…`,
  });

  const eventsResult = await githubFetch(
    `/users/${encodeURIComponent(owner)}/events/public?per_page=30`,
    token,
  );
  if (eventsResult.data) {
    for (const email of collectEmailsFromEvents(eventsResult.data)) {
      addContact(contacts, seen, {
        type: "email",
        value: email,
        source: "public_events",
      });
    }
  }

  const readme = await fetchProfileReadmeText(owner, token);
  if (readme) {
    extractContactsFromText(readme, "profile_readme", contacts, seen);
  }

  const repoScan = await scanUserRepos(githubFetch, {
    owner: user.login,
    accountType: user.type,
    token,
    priorityRepo,
    limits,
    contacts,
    seen,
    isLikelyRealEmail,
    onProgress,
  });

  const summary = summarizeContacts(contacts);
  const emails = contacts.filter((c) => c.type === "email").map((c) => c.value);

  let note = null;
  if (!briefNote) {
    const notes = [];
    if (contacts.length === 0) {
      notes.push(
        "No public contacts found across profile and scanned repositories.",
      );
    }
    notes.push(
      `Scanned ${repoScan.reposScanned} public repo(s) (cap ${limits.maxRepos}): README, commits, issues, releases, package.json, and common doc files.`,
    );
    if (repoScan.scanErrors?.length) {
      notes.push(
        "Some repo API calls failed (rate limit or missing resources).",
      );
    }
    note = notes.join(" ");
  }

  return {
    owner: user.login,
    name: user.name,
    profileUrl: user.html_url,
    avatarUrl: user.avatar_url,
    bio: user.bio,
    accountType: user.type,
    ...summary,
    ...repoScan,
    scanLimits: limits,
    emails,
    sources: contacts.map((c) => ({
      type: c.type,
      value: c.value,
      source: c.source,
    })),
    note,
  };
}

/** @deprecated use lookupOwnerContacts */
export const lookupOwnerEmail = lookupOwnerContacts;
