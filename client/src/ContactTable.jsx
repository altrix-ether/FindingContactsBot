import { useMemo, useState } from "react";
import {
  flattenContacts,
  groupValuesByContactType,
  rowKey,
  rowsToCsv,
  rowsToTsv,
  valuesTextForType,
} from "./contactsExport.js";
import TypeBadge from "./TypeBadge.jsx";
import { TYPE_CHIP_CLASS, TYPE_LABELS } from "./typeLabels.js";

async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

export default function ContactTable({
  result,
  contributors,
  showContributorColumn = true,
  showRepoColumn = false,
}) {
  const allRows = flattenContacts(result, contributors, result?.owner);
  const showRepo = showRepoColumn || allRows.some((r) => r.fromRepo);
  const [copied, setCopied] = useState(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  const typesInData = useMemo(
    () =>
      [...new Set(allRows.map((r) => r.type))].sort((a, b) =>
        (TYPE_LABELS[a] ?? a).localeCompare(TYPE_LABELS[b] ?? b)
      ),
    [allRows]
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allRows.filter((r) => {
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (!q) return true;
      return (
        r.value.toLowerCase().includes(q) ||
        r.person.toLowerCase().includes(q) ||
        r.source.toLowerCase().includes(q) ||
        r.typeLabel.toLowerCase().includes(q) ||
        (r.fromRepo && r.fromRepo.toLowerCase().includes(q))
      );
    });
  }, [allRows, query, typeFilter]);

  async function flashCopy(key, text) {
    await copyText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1600);
  }

  if (!allRows.length) {
    return (
      <div className="empty-state">
        <p className="empty-title">No contacts yet</p>
        <p className="empty-desc">Results will fill this table as the scan completes.</p>
      </div>
    );
  }

  const byType = groupValuesByContactType(allRows);

  return (
    <div className="table-section">
      <div className="table-toolbar">
        <div>
          <h3 className="table-title">Contact directory</h3>
          <p className="table-subtitle">
            Showing {rows.length} of {allRows.length} rows
          </p>
        </div>
        <div className="copy-actions">
          <button type="button" className="btn-secondary" onClick={() => flashCopy("tsv", rowsToTsv(rows))}>
            {copied === "tsv" ? "Copied!" : "TSV"}
          </button>
          <button type="button" className="btn-secondary" onClick={() => flashCopy("csv", rowsToCsv(rows))}>
            {copied === "csv" ? "Copied!" : "CSV"}
          </button>
        </div>
      </div>

      <div className="table-filters">
        <div className="search-wrap">
          <span className="search-icon" aria-hidden>
            ⌕
          </span>
          <input
            type="search"
            className="search-input"
            placeholder="Filter by contact, user, or source…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          className="filter-select"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          aria-label="Filter by contact type"
        >
          <option value="all">All types</option>
          {typesInData.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t] ?? t}
            </option>
          ))}
        </select>
      </div>

      <div className="copy-by-type">
        <span className="copy-by-type-label">Copy all by type</span>
        <div className="copy-by-type-actions">
          {byType.map((group) => {
            const copyKey = `type-${group.type}`;
            return (
              <button
                key={group.type}
                type="button"
                className={`btn-type ${TYPE_CHIP_CLASS[group.type] ?? "type-default"}`}
                onClick={() => flashCopy(copyKey, valuesTextForType(byType, group.type))}
              >
                {copied === copyKey ? "Copied!" : `${group.typeLabel} · ${group.count}`}
              </button>
            );
          })}
        </div>
      </div>

      <div className="table-wrap">
        <table className="contacts-table">
          <thead>
            <tr>
              {showContributorColumn && <th>Contributor</th>}
              {showRepo && <th>Repository</th>}
              <th>Type</th>
              <th>Contact</th>
              <th>Source</th>
              <th className="col-copy" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const key = rowKey(row, i);
              return (
                <tr key={key}>
                  {showContributorColumn && (
                    <td className="mono user-cell">{row.person ? `@${row.person}` : "—"}</td>
                  )}
                  {showRepo && (
                    <td className="mono repo-cell">{row.fromRepo || "—"}</td>
                  )}
                  <td>
                    <TypeBadge type={row.type} />
                  </td>
                  <td className="contact-cell">
                    {row.href ? (
                      <a href={row.href} target="_blank" rel="noreferrer">
                        {row.value}
                      </a>
                    ) : (
                      <span className="mono">{row.value}</span>
                    )}
                  </td>
                  <td className="source-cell">{row.source?.replace(/_/g, " ")}</td>
                  <td className="col-copy">
                    <button
                      type="button"
                      className="btn-icon"
                      title="Copy contact"
                      onClick={() => flashCopy(key, row.value)}
                    >
                      {copied === key ? "✓" : "⧉"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && (
          <p className="table-no-match">No rows match your filters.</p>
        )}
      </div>
    </div>
  );
}