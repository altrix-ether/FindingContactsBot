import { SUPPORTED_CONTACT_TYPES } from "./contacts.js";
import { contributorLimitsFromEnv, lookupRepoContributors } from "./contributorScan.js";
import { githubFetch, lookupOwnerContacts } from "./github.js";
import { runLookup } from "./lookup.js";

function batchLimitFromEnv() {
  return Math.min(Number(process.env.SCAN_MAX_BATCH_REPOS) || 10, 25);
}

function mergeContributorRows(into, person, fromRepo) {
  const existing = into.get(person.login);
  if (!existing) {
    into.set(person.login, {
      ...person,
      repos: [fromRepo],
      contacts: [...(person.contacts ?? [])],
      contactCount: person.contactCount ?? person.contacts?.length ?? 0,
    });
    return;
  }

  if (!existing.repos.includes(fromRepo)) {
    existing.repos.push(fromRepo);
  }
  const seen = new Set(existing.contacts.map((c) => `${c.type}:${c.value}`));
  for (const c of person.contacts ?? []) {
    const key = `${c.type}:${c.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    existing.contacts.push(c);
  }
  existing.contactCount = existing.contacts.length;
  if (!existing.name && person.name) existing.name = person.name;
  if (!existing.avatarUrl && person.avatarUrl) existing.avatarUrl = person.avatarUrl;
  if (!existing.profileUrl && person.profileUrl) existing.profileUrl = person.profileUrl;
}

export function mergeRepoResults(repoResults) {
  const byLogin = new Map();
  const aggregatedContacts = [];
  const contactSeen = new Set();
  const repositories = [];
  const repoErrors = [];

  for (const result of repoResults) {
    if (result.error) {
      repoErrors.push({ repository: result.repository ?? result.input, error: result.error });
      continue;
    }
    repositories.push(result.repository);
    for (const person of result.contributors ?? []) {
      mergeContributorRows(byLogin, person, result.repository);
      for (const c of person.contacts ?? []) {
        const key = `${person.login}:${c.type}:${c.value}`;
        if (contactSeen.has(key)) continue;
        contactSeen.add(key);
        aggregatedContacts.push({
          ...c,
          contributor: person.login,
          fromRepo: result.repository,
        });
      }
    }
  }

  const contributors = [...byLogin.values()].sort((a, b) => a.login.localeCompare(b.login));
  const types = new Set(aggregatedContacts.map((c) => c.type));

  return {
    mode: "contributors",
    multiRepo: true,
    repositories,
    repository: repositories.join(", "),
    contributorCount: contributors.length,
    contributorsScanned: contributors.length,
    contributorsWithContacts: contributors.filter((c) => c.contactCount > 0).length,
    contributors,
    contacts: aggregatedContacts,
    contactCount: aggregatedContacts.length,
    contactTypes: [...types].sort(),
    contactTypesFound: types.size,
    supportedContactTypes: SUPPORTED_CONTACT_TYPES,
    repoErrors: repoErrors.length ? repoErrors : null,
    note: `Merged ${repositories.length} repo scan(s). Contributors deduplicated by GitHub login; contacts deduplicated per login + type + value.`,
  };
}

export async function runLookupBatch(parsedList, token, onProgress) {
  const maxBatch = batchLimitFromEnv();
  const withRepo = parsedList.filter((p) => p.repo);
  const profiles = parsedList.filter((p) => !p.repo);

  if (!withRepo.length && profiles.length === 1) {
    return runLookup(profiles[0], token, onProgress);
  }

  if (withRepo.length > maxBatch) {
    return {
      error: `Too many repositories (max ${maxBatch}). Shorten the list or set SCAN_MAX_BATCH_REPOS.`,
      status: 400,
    };
  }

  if (!withRepo.length) {
    return {
      error: "Batch scan needs at least one repository URL (owner/repo).",
      status: 400,
    };
  }

  const repoResults = [];
  const total = withRepo.length;

  for (let i = 0; i < withRepo.length; i++) {
    const item = withRepo[i];
    const repoLabel = `${item.owner}/${item.repo}`;
    onProgress?.({
      event: "progress",
      stage: "batch",
      message: `Repository ${i + 1}/${total}: ${repoLabel}`,
      current: i,
      total,
    });

    const result = await lookupRepoContributors(
      githubFetch,
      lookupOwnerContacts,
      item.owner,
      item.repo,
      token,
      contributorLimitsFromEnv(),
      onProgress
    );

    if (result.error) {
      repoResults.push({
        error: result.error,
        repository: repoLabel,
        input: item.input,
      });
      onProgress?.({
        event: "progress",
        stage: "batch",
        message: `Failed ${repoLabel}: ${result.error}`,
        current: i + 1,
        total,
      });
      continue;
    }

    repoResults.push(result);
    onProgress?.({
      event: "progress",
      stage: "batch",
      message: `Finished ${repoLabel} (${result.contactCount} contacts)`,
      current: i + 1,
      total,
    });
  }

  if (profiles.length) {
    onProgress?.({
      event: "progress",
      stage: "batch",
      message: `Skipping ${profiles.length} profile-only URL(s) in batch mode`,
    });
  }

  const merged = mergeRepoResults(repoResults);
  if (!merged.contacts.length && merged.repoErrors?.length === repoResults.length) {
    return { error: "All repository scans failed.", status: 502, repoErrors: merged.repoErrors };
  }

  return merged;
}