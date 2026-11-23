import { SUPPORTED_CONTACT_TYPES } from "./contacts.js";

const BOT_LOGIN = /^(dependabot|renovate|github-actions|codecov|greenkeeper)(\[-bot\])?$/i;

function isBotLogin(login) {
  if (!login) return true;
  if (login.endsWith("[bot]")) return true;
  return BOT_LOGIN.test(login);
}

async function runPool(items, concurrency, worker) {
  let index = 0;
  async function runner() {
    while (index < items.length) {
      const current = index++;
      await worker(items[current], current);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, runner);
  await Promise.all(workers);
}

export function contributorLimitsFromEnv() {
  return {
    maxContributors: Math.min(Number(process.env.SCAN_MAX_CONTRIBUTORS) || 50, 100),
    concurrency: Math.min(Number(process.env.SCAN_CONTRIBUTOR_CONCURRENCY) || 2, 6),
    maxReposPerContributor: Math.min(
      Number(process.env.SCAN_CONTRIBUTOR_MAX_REPOS) || 5,
      40
    ),
    commitPages: Math.min(Number(process.env.SCAN_CONTRIBUTOR_COMMIT_PAGES) || 3, 10),
  };
}

export async function listContributorLogins(githubFetch, owner, repo, token, limits, onProgress) {
  const logins = new Set();
  const sources = new Map();

  onProgress?.({
    event: "progress",
    stage: "discover",
    message: `Listing contributors for ${owner}/${repo}…`,
  });

  let page = 1;
  while (logins.size < limits.maxContributors) {
    const result = await githubFetch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contributors?per_page=100&page=${page}&anon=1`,
      token
    );
    if (result.error && page === 1) return { error: result.error, status: result.status };
    const batch = result.data ?? [];
    if (!batch.length) break;
    for (const row of batch) {
      if (!row.login || isBotLogin(row.login)) continue;
      if (!logins.has(row.login)) sources.set(row.login, "contributors_api");
      logins.add(row.login);
      if (logins.size >= limits.maxContributors) break;
    }
    if (batch.length < 100) break;
    page += 1;
  }

  onProgress?.({
    event: "progress",
    stage: "discover",
    message: `Found ${logins.size} contributor(s); scanning commit history…`,
    current: logins.size,
    total: limits.maxContributors,
  });

  for (let commitPage = 1; commitPage <= limits.commitPages && logins.size < limits.maxContributors; commitPage++) {
    onProgress?.({
      event: "progress",
      stage: "discover",
      message: `Commit history page ${commitPage}/${limits.commitPages}…`,
    });
    const commits = await githubFetch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=100&page=${commitPage}`,
      token
    );
    if (commits.error || !commits.data?.length) break;
    for (const item of commits.data) {
      const login = item.author?.login;
      if (!login || isBotLogin(login)) continue;
      if (!logins.has(login)) sources.set(login, "commit_history");
      logins.add(login);
      if (logins.size >= limits.maxContributors) break;
    }
    if (commits.data.length < 100) break;
  }

  return {
    logins: [...logins].slice(0, limits.maxContributors),
    sources,
  };
}

export async function lookupRepoContributors(
  githubFetch,
  lookupOwnerContacts,
  owner,
  repo,
  token,
  limits,
  onProgress
) {
  const listed = await listContributorLogins(githubFetch, owner, repo, token, limits, onProgress);
  if (listed.error) {
    return listed;
  }

  const total = listed.logins.length;
  onProgress?.({
    event: "progress",
    stage: "contributors",
    message: `Scanning ${total} contributor(s)…`,
    current: 0,
    total,
  });

  const contributors = [];
  const errors = [];
  let finished = 0;

  await runPool(listed.logins, limits.concurrency, async (login) => {
    const discoveredVia = listed.sources.get(login) ?? "contributors_api";
    onProgress?.({
      event: "progress",
      stage: "contributors",
      message: `Looking up @${login}…`,
      current: finished,
      total,
    });

    const profile = await lookupOwnerContacts(login, token, {
      priorityRepo: repo,
      maxRepos: limits.maxReposPerContributor,
      briefNote: true,
      onProgress,
    });

    finished += 1;

    if (profile.error) {
      errors.push({ login, error: profile.error });
      const row = {
        login,
        discoveredVia,
        error: profile.error,
        contacts: [],
        contactCount: 0,
      };
      contributors.push(row);
      onProgress?.({
        event: "contributor",
        contributor: row,
      });
      onProgress?.({
        event: "progress",
        stage: "contributors",
        message: `Failed @${login}: ${profile.error}`,
        current: finished,
        total,
      });
      return;
    }

    const row = {
      login: profile.owner,
      name: profile.name,
      profileUrl: profile.profileUrl,
      avatarUrl: profile.avatarUrl,
      bio: profile.bio,
      discoveredVia,
      contacts: profile.contacts,
      contactCount: profile.contactCount,
      contactTypes: profile.contactTypes,
      reposScanned: profile.reposScanned,
    };
    contributors.push(row);
    onProgress?.({
      event: "contributor",
      contributor: row,
    });
    onProgress?.({
      event: "progress",
      stage: "contributors",
      message: `@${profile.owner}: ${profile.contactCount} contact(s)`,
      current: finished,
      total,
    });
  });

  contributors.sort((a, b) => a.login.localeCompare(b.login));

  const aggregateSeen = new Set();
  const aggregatedContacts = [];
  for (const person of contributors) {
    for (const c of person.contacts ?? []) {
      const key = `${person.login}:${c.type}:${c.value.toLowerCase()}`;
      if (aggregateSeen.has(key)) continue;
      aggregateSeen.add(key);
      aggregatedContacts.push({
        ...c,
        contributor: person.login,
      });
    }
  }

  const withContacts = contributors.filter((c) => c.contactCount > 0).length;

  return {
    mode: "contributors",
    repository: `${owner}/${repo}`,
    repoOwner: owner,
    repoName: repo,
    contributorCount: listed.logins.length,
    contributorsScanned: contributors.length,
    contributorsWithContacts: withContacts,
    contributors,
    contacts: aggregatedContacts,
    contactCount: aggregatedContacts.length,
    contactTypes: [...new Set(aggregatedContacts.map((c) => c.type))].sort(),
    contactTypesFound: new Set(aggregatedContacts.map((c) => c.type)).size,
    supportedContactTypes: SUPPORTED_CONTACT_TYPES,
    scanLimits: limits,
    contributorErrors: errors.length ? errors : null,
    note: `Looked up ${contributors.length} contributor(s) for ${owner}/${repo} (cap ${limits.maxContributors}). Each person: profile, social accounts, events, profile README, and up to ${limits.maxReposPerContributor} public repos. Only public data.`,
  };
}