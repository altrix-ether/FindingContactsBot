import { useEffect, useMemo, useState } from "react";
import "./App.css";
import ContactTable from "./ContactTable.jsx";
import { lookupWithProgress } from "./lookupStream.js";
import StatsRow from "./StatsRow.jsx";
import { flattenContacts, groupValuesByContactType } from "./contactsExport.js";

const EXAMPLES = [
  {
    label: "Multi-repo",
    url: "octocat/Hello-World\ntorvalds/linux",
  },
  { label: "One repo", url: "https://github.com/octocat/Hello-World" },
  { label: "Profile", url: "https://github.com/octocat" },
];

function formatCountdown(resetAt, now) {
  if (!resetAt) return null;
  const ms = new Date(resetAt).getTime() - now;
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return "now";
  const totalSec = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function quotaTone(quota) {
  if (!quota || quota.remaining == null || quota.limit == null) return "unknown";
  if (quota.remaining === 0) return "empty";
  if (quota.remaining / Math.max(quota.limit, 1) <= 0.1 || quota.remaining <= 50) return "low";
  return "ok";
}

function formatResetClock(resetAt) {
  if (!resetAt) return null;
  return new Date(resetAt).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function QuotaBadge({ quota, now }) {
  if (!quota) {
    return (
      <div className="quota-badge" data-tone="unknown" title="Loading GitHub REST quota…">
        <span className="quota-label">REST</span>
        <span className="quota-value">…</span>
      </div>
    );
  }

  if (quota.error && quota.remaining == null) {
    return (
      <div className="quota-badge" data-tone="empty" title={quota.error}>
        <span className="quota-label">REST</span>
        <span className="quota-value">error</span>
      </div>
    );
  }

  const remaining = quota.remaining ?? "—";
  const limit = quota.limit ?? "—";
  const used =
    quota.used ??
    (quota.limit != null && quota.remaining != null ? quota.limit - quota.remaining : null);
  const auth = quota.tokenConfigured ? "token" : "no token";
  const resetClock = formatResetClock(quota.resetAt);
  const countdown = formatCountdown(quota.resetAt, now);
  const resetFull = quota.resetAt
    ? new Date(quota.resetAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "medium",
      })
    : "unknown";

  return (
    <div
      className="quota-badge"
      data-tone={quotaTone(quota)}
      title={`${auth} · used ${used ?? "—"} · resets ${resetFull}`}
    >
      <span className="quota-label">REST</span>
      <span className="quota-value">
        {remaining}
        <span className="quota-sep">/</span>
        {limit}
      </span>
      <span className="quota-auth">{quota.tokenConfigured ? "token" : "anon"}</span>
      {resetClock && (
        <span className="quota-reset">
          <span className="quota-meta-label">reset</span>
          <span className="quota-meta-value">{resetClock}</span>
        </span>
      )}
      {countdown && (
        <span className="quota-countdown">
          <span className="quota-meta-label">in</span>
          <span className="quota-meta-value">{countdown}</span>
        </span>
      )}
    </div>
  );
}

function RateLimitPanel({ quota, now }) {
  const resetLabel = quota.resetAt
    ? new Date(quota.resetAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "medium",
      })
    : "unknown";
  const countdown = formatCountdown(quota.resetAt, now);
  const used =
    quota.used ??
    (quota.limit != null && quota.remaining != null ? quota.limit - quota.remaining : null);

  return (
    <section className="panel rate-limit-panel" role="alert">
      <h2>GitHub rate limit used up</h2>
      <p className="rate-limit-lead">
        {quota.tokenConfigured
          ? "The token in server/.env has no core REST requests left for this hour."
          : "This app is calling GitHub without a token, and the unauthenticated hourly limit is used up."}
      </p>
      <dl className="rate-limit-grid">
        <div>
          <dt>Auth</dt>
          <dd>{quota.tokenConfigured ? "GitHub token" : "No token"}</dd>
        </div>
        <div>
          <dt>Limit</dt>
          <dd>{quota.limit ?? "—"} / hour</dd>
        </div>
        <div>
          <dt>Used</dt>
          <dd>{used ?? "—"}</dd>
        </div>
        <div>
          <dt>Remaining</dt>
          <dd>{quota.remaining ?? 0}</dd>
        </div>
        <div>
          <dt>Resets</dt>
          <dd>{resetLabel}</dd>
        </div>
        <div>
          <dt>Available in</dt>
          <dd>{countdown ?? "—"}</dd>
        </div>
      </dl>
    </section>
  );
}

const STAGE_LABELS = {
  start: "Starting",
  discover: "Discovery",
  contributors: "Contributors",
  repos: "Repositories",
  profile: "Profile",
  batch: "Batch",
};

export default function App() {
  const [url, setUrl] = useState("https://github.com/octocat/Hello-World");
  const lineCount = url.split(/\n/).filter((l) => l.trim()).length;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState(null);
  const [partialContributors, setPartialContributors] = useState([]);
  const [quota, setQuota] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const quotaExhausted = quota?.remaining === 0;

  async function refreshQuota() {
    try {
      const res = await fetch("/api/quota");
      const data = await res.json();
      setQuota(data);
      return data;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadQuota() {
      try {
        const res = await fetch("/api/quota");
        const data = await res.json();
        if (!cancelled) setQuota(data);
      } catch {
        /* leave the last quota snapshot */
      }
    }

    loadQuota();
    const poll = setInterval(loadQuota, 15000);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!quotaExhausted || !quota?.resetAt) return undefined;
    const wait = new Date(quota.resetAt).getTime() - Date.now() + 1500;
    if (wait <= 0) return undefined;
    const timer = setTimeout(() => {
      refreshQuota();
    }, wait);
    return () => clearTimeout(timer);
  }, [quotaExhausted, quota?.resetAt]);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setProgress({ message: "Starting…", stage: "start", current: 0, total: 0, logs: [] });
    setPartialContributors([]);

    try {
      await lookupWithProgress(url, (payload) => {
        if (payload.event === "progress") {
          setProgress((prev) => {
            const logs = [...(prev?.logs ?? []), payload.message].slice(-40);
            return {
              message: payload.message,
              stage: payload.stage ?? prev?.stage,
              current: payload.current ?? prev?.current ?? 0,
              total: payload.total ?? prev?.total ?? 0,
              logs,
            };
          });
        }
        if (payload.event === "contributor" && payload.contributor) {
          setPartialContributors((prev) => {
            const login = payload.contributor.login;
            const existing = prev.find((p) => p.login === login);
            if (!existing) return [...prev, payload.contributor];
            const seen = new Set(
              existing.contacts?.map((c) => `${c.type}:${c.value}`) ?? []
            );
            const mergedContacts = [...(existing.contacts ?? [])];
            for (const c of payload.contributor.contacts ?? []) {
              const key = `${c.type}:${c.value}`;
              if (seen.has(key)) continue;
              seen.add(key);
              mergedContacts.push(c);
            }
            return prev.map((p) =>
              p.login === login ?
                {
                  ...payload.contributor,
                  contacts: mergedContacts,
                  contactCount: mergedContacts.length,
                }
              : p
            );
          });
        }
        if (payload.event === "done" && payload.result) {
          setResult(payload.result);
        }
      });
    } catch (err) {
      setError(err.message);
      if (err.rateLimit) setQuota(err.rateLimit);
    } finally {
      setLoading(false);
      setProgress(null);
      refreshQuota();
    }
  }

  const displayResult = result;
  const isContributorsFinal = displayResult?.mode === "contributors";
  const isContributors =
    isContributorsFinal || (loading && partialContributors.length > 0);
  const contributors =
    displayResult?.contributors ?? (loading ? partialContributors : []);

  const progressPct =
    progress?.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : null;

  const showTable =
    (displayResult && (displayResult.contacts?.length || isContributorsFinal)) ||
    (loading && contributors.some((p) => p.contacts?.length));

  const flatRows = useMemo(
    () => flattenContacts(displayResult, contributors, displayResult?.owner),
    [displayResult, contributors]
  );
  const emailCount = useMemo(
    () => groupValuesByContactType(flatRows).find((g) => g.type === "email")?.count ?? 0,
    [flatRows]
  );

  const stats = useMemo(() => {
    if (isContributorsFinal && displayResult) {
      return [
        {
          label: "Repositories",
          value: displayResult.multiRepo ?
            displayResult.repositories?.length
          : 1,
          hint: displayResult.multiRepo ? "in batch" : displayResult.repository,
        },
        { label: "Contributors", value: displayResult.contributorCount, hint: "deduped" },
        {
          label: "With contacts",
          value: displayResult.contributorsWithContacts,
          hint: "public data",
        },
        { label: "Total rows", value: displayResult.contactCount, hint: `${emailCount} emails` },
      ];
    }
    if (displayResult && !isContributorsFinal) {
      return [
        { label: "Contacts", value: displayResult.contactCount, hint: "all types" },
        { label: "Types", value: displayResult.contactTypesFound, hint: "unique" },
        { label: "Repos scanned", value: displayResult.reposScanned ?? 0, hint: "public" },
        { label: "Emails", value: emailCount, hint: "deduped in copy" },
      ];
    }
    if (loading && flatRows.length) {
      return [
        { label: "Rows so far", value: flatRows.length, hint: "live" },
        { label: "Contributors", value: contributors.length, hint: "scanned" },
        { label: "Emails", value: emailCount, hint: "found" },
        {
          label: "Progress",
          value: progressPct != null ? `${progressPct}%` : "…",
          hint: progress?.stage,
        },
      ];
    }
    return null;
  }, [displayResult, isContributorsFinal, emailCount, flatRows.length, contributors.length, loading, progressPct, progress?.stage]);

  return (
    <div className="shell">
      <div className="bg-orb bg-orb-a" aria-hidden />
      <div className="bg-orb bg-orb-b" aria-hidden />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ◈
          </span>
          <span className="brand-text">
            GitHub Contact Finder
            <small>Public OSINT for repos &amp; contributors</small>
          </span>
        </div>
        <div className="topbar-meta">
          <QuotaBadge quota={quota} now={now} />
          <div className="topbar-pill">
            <span className="dot" data-live={loading ? "true" : "false"} />
            {loading ? "Scanning" : "Ready"}
          </div>
        </div>
      </header>

      <main className="main">
        <section className="panel hero-panel">
          <h1>Find every public contact on GitHub</h1>
          <p className="hero-copy">
            Enter <strong>one repo per line</strong> to scan contributors across multiple
            repositories (merged, deduplicated). A single profile URL still works for one owner.
          </p>

          <form className="search-form" onSubmit={handleSubmit}>
            <label htmlFor="github-url" className="field-label">
              GitHub URLs {lineCount > 1 && <span className="line-count">{lineCount} repos</span>}
            </label>
            <div className="search-stack">
              <textarea
                id="github-url"
                className="url-textarea"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={
                  "https://github.com/owner/repo\nowner/other-repo\ngit@github.com:org/project.git"
                }
                required
                autoComplete="off"
                disabled={loading || quotaExhausted}
                rows={Math.min(8, Math.max(3, lineCount))}
              />
              <button type="submit" className="btn-primary btn-block" disabled={loading || quotaExhausted}>
                {loading ? (
                  <span className="btn-loading">
                    <span className="spinner" /> Running
                  </span>
                ) : lineCount > 1 ? (
                  `Scan ${lineCount} repos`
                ) : (
                  "Scan"
                )}
              </button>
            </div>
          </form>

          <div className="examples">
            <span className="examples-label">Try</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.url}
                type="button"
                className="example-chip"
                disabled={loading}
                onClick={() => setUrl(ex.url)}
              >
                {ex.label}
              </button>
            ))}
          </div>
        </section>

        {quotaExhausted && <RateLimitPanel quota={quota} now={now} />}

        {error && !quotaExhausted && (
          <section className="panel alert-panel" role="alert">
            <p className="alert-error">{error}</p>
          </section>
        )}

        <div className="content-grid">
          {loading && progress && (
            <section className="panel progress-panel live-panel" aria-live="polite">
              <div className="panel-head">
                <h2>Live scan</h2>
                <span className="stage-pill">
                  {STAGE_LABELS[progress.stage] ?? progress.stage}
                </span>
              </div>
              <p className="progress-message">{progress.message}</p>
              <div
                className={`progress-bar${progressPct == null ? " indeterminate" : ""}`}
                role="progressbar"
              >
                {progressPct != null && (
                  <span className="progress-fill" style={{ width: `${progressPct}%` }} />
                )}
              </div>
              {progressPct != null && <p className="progress-pct">{progressPct}% complete</p>}
              <ul className="progress-log">
                {[...progress.logs].reverse().map((line, i) => (
                  <li key={`${line}-${i}`}>{line}</li>
                ))}
              </ul>
            </section>
          )}

          {(displayResult || showTable || stats) && (
            <section className="panel results-panel">
              <div className="panel-head">
                <div>
                  <h2>Results</h2>
                  {isContributorsFinal && !displayResult.multiRepo && (
                    <p className="result-target">
                      <a
                        href={`https://github.com/${displayResult.repository}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {displayResult.repository}
                      </a>
                    </p>
                  )}
                  {isContributorsFinal && displayResult.multiRepo && (
                    <ul className="repo-list">
                      {(displayResult.repositories ?? []).map((repo) => (
                        <li key={repo}>
                          <a
                            href={`https://github.com/${repo}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {repo}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                  {displayResult && !isContributorsFinal && (
                    <p className="result-target">
                      <a href={displayResult.profileUrl} target="_blank" rel="noreferrer">
                        @{displayResult.owner}
                      </a>
                      {displayResult.name && ` · ${displayResult.name}`}
                    </p>
                  )}
                </div>
                {displayResult?.avatarUrl && !isContributorsFinal && (
                  <img
                    src={displayResult.avatarUrl}
                    alt=""
                    className="avatar result-avatar"
                    width={48}
                    height={48}
                  />
                )}
              </div>

              {stats && <StatsRow items={stats} />}

              {displayResult?.parseErrors?.length > 0 && (
                <p className="note warn-list">
                  Skipped invalid URLs:{" "}
                  {displayResult.parseErrors.map((e) => e.input).join(", ")}
                </p>
              )}

              {showTable && (
                <ContactTable
                  result={displayResult}
                  contributors={contributors}
                  showContributorColumn={isContributors}
                  showRepoColumn={Boolean(displayResult?.multiRepo)}
                />
              )}

              {!showTable && displayResult && (
                <div className="empty-state">
                  <p className="empty-title">No public contacts</p>
                  <p className="empty-desc">This user may hide emails and social links.</p>
                </div>
              )}

              {displayResult?.note && <p className="note">{displayResult.note}</p>}
            </section>
          )}

          {!loading && !displayResult && !error && (
            <section className="panel feature-panel">
              <h2 className="feature-heading">What gets scanned</h2>
              <div className="feature-grid">
                <article className="feature-card">
                  <h3>Contributors</h3>
                  <p>Repo URL → every contributor profile + their public repos.</p>
                </article>
                <article className="feature-card">
                  <h3>20+ contact types</h3>
                  <p>Email, Telegram, Discord, LinkedIn, WhatsApp, and more.</p>
                </article>
                <article className="feature-card">
                  <h3>Deep repo crawl</h3>
                  <p>README, commits, issues, releases, and package.json.</p>
                </article>
              </div>
            </section>
          )}
        </div>
      </main>

      <footer className="footer">
        Public GitHub data only · Respect privacy and Terms of Service
      </footer>
    </div>
  );
}