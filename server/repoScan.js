import { addContact, extractContactsFromText } from "./contacts.js";

const DOC_PATHS = [
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "SUPPORT.md",
  "docs/CONTRIBUTING.md",
  "docs/CONTACT.md",
];

function decodeContentPayload(data) {
  if (!data?.content) return null;
  try {
    return Buffer.from(data.content, data.encoding === "base64" ? "base64" : "utf8").toString(
      "utf8"
    );
  } catch {
    return null;
  }
}

async function fetchRepoFile(githubFetch, owner, repo, path, token) {
  const result = await githubFetch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    token
  );
  if (result.notFound || result.error) return null;
  return decodeContentPayload(result.data);
}

function collectFromPackageJson(text, repo, contacts, seen) {
  if (!text) return;
  try {
    const pkg = JSON.parse(text);
    const source = `repo_package_json:${repo}`;
    if (pkg.author) {
      const author =
        typeof pkg.author === "string"
          ? pkg.author
          : [pkg.author.name, pkg.author.email, pkg.author.url].filter(Boolean).join(" ");
      extractContactsFromText(author, source, contacts, seen);
    }
    if (pkg.bugs?.url) {
      extractContactsFromText(pkg.bugs.url, source, contacts, seen);
    }
    if (pkg.homepage) {
      extractContactsFromText(pkg.homepage, source, contacts, seen);
    }
    if (Array.isArray(pkg.maintainers)) {
      for (const m of pkg.maintainers) {
        const line = typeof m === "string" ? m : [m.name, m.email, m.url].filter(Boolean).join(" ");
        extractContactsFromText(line, source, contacts, seen);
      }
    }
  } catch {
    /* not valid json */
  }
}

function collectCommitContacts(commits, repo, contacts, seen, isLikelyRealEmail) {
  if (!Array.isArray(commits)) return;
  for (const item of commits) {
    const email = item.commit?.author?.email ?? item.author?.email;
    if (isLikelyRealEmail(email)) {
      addContact(contacts, seen, {
        type: "email",
        value: email,
        source: `repo_commit:${repo}`,
      });
    }
    const message = item.commit?.message;
    if (message) {
      extractContactsFromText(message, `repo_commit_message:${repo}`, contacts, seen);
    }
  }
}

function scanRepoMeta(repo, contacts, seen) {
  const name = repo.name;
  const source = `repo_meta:${name}`;
  if (repo.homepage) {
    extractContactsFromText(repo.homepage, source, contacts, seen);
  }
  if (repo.description) {
    extractContactsFromText(repo.description, source, contacts, seen);
  }
}

async function scanSingleRepo(githubFetch, owner, repo, token, limits, contacts, seen, isLikelyRealEmail) {
  const name = repo.name;
  scanRepoMeta(repo, contacts, seen);

  const readmeResult = await githubFetch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/readme`,
    token
  );
  if (readmeResult.data) {
    const text = decodeContentPayload(readmeResult.data);
    if (text) extractContactsFromText(text, `repo_readme:${name}`, contacts, seen);
  }

  const commitsResult = await githubFetch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits?per_page=${limits.commitsPerRepo}`,
    token
  );
  if (commitsResult.data) {
    collectCommitContacts(commitsResult.data, name, contacts, seen, isLikelyRealEmail);
  }

  for (const path of DOC_PATHS) {
    const text = await fetchRepoFile(githubFetch, owner, name, path, token);
    if (text) {
      extractContactsFromText(text, `repo_file:${name}/${path}`, contacts, seen);
    }
  }

  const pkgText = await fetchRepoFile(githubFetch, owner, name, "package.json", token);
  collectFromPackageJson(pkgText, name, contacts, seen);

  const issuesResult = await githubFetch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues?state=all&per_page=${limits.issuesPerRepo}&sort=updated`,
    token
  );
  if (issuesResult.data) {
    for (const issue of issuesResult.data) {
      if (issue.pull_request) continue;
      const blob = [issue.title, issue.body].filter(Boolean).join("\n");
      extractContactsFromText(blob, `repo_issue:${name}`, contacts, seen);
    }
  }

  const releasesResult = await githubFetch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/releases?per_page=${limits.releasesPerRepo}`,
    token
  );
  if (releasesResult.data) {
    for (const release of releasesResult.data) {
      const blob = [release.name, release.body].filter(Boolean).join("\n");
      extractContactsFromText(blob, `repo_release:${name}`, contacts, seen);
    }
  }
}

async function runPool(items, concurrency, worker) {
  let index = 0;
  async function runner() {
    while (index < items.length) {
      const i = index++;
      await worker(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, runner);
  await Promise.all(workers);
}

export async function listReposForAccount(githubFetch, owner, accountType, token, maxRepos) {
  const repos = [];
  let page = 1;
  const base =
    accountType === "Organization"
      ? `/orgs/${encodeURIComponent(owner)}/repos`
      : `/users/${encodeURIComponent(owner)}/repos`;

  while (repos.length < maxRepos) {
    const qs =
      accountType === "Organization"
        ? `?per_page=100&page=${page}&sort=updated`
        : `?per_page=100&page=${page}&sort=updated&type=owner`;

    const result = await githubFetch(`${base}${qs}`, token);
    if (result.error) {
      return { repos, error: result.error, status: result.status };
    }
    const batch = result.data ?? [];
    if (!batch.length) break;
    repos.push(...batch.filter((r) => !r.fork));
    if (batch.length < 100) break;
    page += 1;
  }

  return { repos: repos.slice(0, maxRepos) };
}

function prioritizeRepos(repos, priorityRepo) {
  if (!priorityRepo) return repos;
  const lowered = priorityRepo.toLowerCase();
  const idx = repos.findIndex((r) => r.name.toLowerCase() === lowered);
  if (idx > 0) {
    const copy = [...repos];
    const [hit] = copy.splice(idx, 1);
    copy.unshift(hit);
    return copy;
  }
  return repos;
}

export async function scanUserRepos(
  githubFetch,
  {
    owner,
    accountType,
    token,
    priorityRepo,
    limits,
    contacts,
    seen,
    isLikelyRealEmail,
    onProgress,
  }
) {
  const list = await listReposForAccount(githubFetch, owner, accountType, token, limits.maxRepos);
  let repos = list.repos;

  if (priorityRepo && !repos.some((r) => r.name.toLowerCase() === priorityRepo.toLowerCase())) {
    const one = await githubFetch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(priorityRepo)}`,
      token
    );
    if (one.data && !one.data.fork) {
      repos = [one.data, ...repos].slice(0, limits.maxRepos);
    }
  } else {
    repos = prioritizeRepos(repos, priorityRepo);
  }

  const scanErrors = [];
  if (list.error) scanErrors.push(list.error);

  const total = repos.length;
  let scanned = 0;
  onProgress?.({
    event: "progress",
    stage: "repos",
    message: `Found ${total} public repo(s) for @${owner}`,
    current: 0,
    total,
  });

  await runPool(repos, limits.concurrency, async (repo) => {
    onProgress?.({
      event: "progress",
      stage: "repos",
      message: `Scanning ${owner}/${repo.name}…`,
      current: scanned,
      total,
    });
    try {
      await scanSingleRepo(githubFetch, owner, repo, token, limits, contacts, seen, isLikelyRealEmail);
      scanned += 1;
      onProgress?.({
        event: "progress",
        stage: "repos",
        message: `Finished ${repo.name}`,
        current: scanned,
        total,
      });
    } catch (err) {
      scanErrors.push(`${repo.name}: ${err.message}`);
      scanned += 1;
      onProgress?.({
        event: "progress",
        stage: "repos",
        message: `Skipped ${repo.name}: ${err.message}`,
        current: scanned,
        total,
      });
    }
  });

  return {
    reposScanned: scanned,
    reposTotal: repos.length,
    scanErrors: scanErrors.length ? scanErrors : null,
  };
}