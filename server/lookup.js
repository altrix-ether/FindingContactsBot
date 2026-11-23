import { contributorLimitsFromEnv, lookupRepoContributors } from "./contributorScan.js";
import { githubFetch, lookupOwnerContacts } from "./github.js";
import { runLookupBatch } from "./multiLookup.js";
import { noopProgress } from "./progress.js";

export async function runLookup(parsed, token, onProgress = noopProgress) {
  if (parsed.repo) {
    onProgress({
      event: "progress",
      stage: "start",
      message: `Contributor scan for ${parsed.owner}/${parsed.repo}`,
    });
    return lookupRepoContributors(
      githubFetch,
      lookupOwnerContacts,
      parsed.owner,
      parsed.repo,
      token,
      contributorLimitsFromEnv(),
      onProgress
    );
  }

  onProgress({
    event: "progress",
    stage: "start",
    message: `Contact scan for @${parsed.owner}`,
  });
  return lookupOwnerContacts(parsed.owner, token, { onProgress });
}

export async function runLookups(parsedList, token, onProgress = noopProgress) {
  if (parsedList.length === 1) {
    const single = parsedList[0];
    const result = await runLookup(single, token, onProgress);
    return { result, parsed: parsedList };
  }
  const result = await runLookupBatch(parsedList, token, onProgress);
  return { result, parsed: parsedList };
}