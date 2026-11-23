import { TYPE_LABELS } from "./typeLabels.js";

export function flattenContacts(result, contributors, ownerLogin) {
  const rows = [];

  if (result?.mode === "contributors" && Array.isArray(result.contacts)) {
    for (const c of result.contacts) {
      rows.push({
        person: c.contributor ?? "",
        type: c.type,
        typeLabel: TYPE_LABELS[c.type] ?? c.type,
        value: c.value,
        href: c.href,
        source: c.source,
        fromRepo: c.fromRepo ?? "",
      });
    }
    return rows;
  }

  if (result?.contacts?.length) {
    const person = result.owner ?? ownerLogin ?? "";
    for (const c of result.contacts) {
      rows.push({
        person,
        type: c.type,
        typeLabel: TYPE_LABELS[c.type] ?? c.type,
        value: c.value,
        href: c.href,
        source: c.source,
      });
    }
    return rows;
  }

  for (const p of contributors ?? []) {
    for (const c of p.contacts ?? []) {
      rows.push({
        person: p.login,
        type: c.type,
        typeLabel: TYPE_LABELS[c.type] ?? c.type,
        value: c.value,
        href: c.href,
        source: c.source,
      });
    }
  }

  return rows;
}

function exportHeader(rows) {
  const hasRepo = rows.some((r) => r.fromRepo);
  return hasRepo ?
      ["Contributor", "Repository", "Type", "Contact", "Source"]
    : ["Contributor", "Type", "Contact", "Source"];
}

function rowsHaveRepoColumn(rows) {
  return rows.some((r) => r.fromRepo);
}

export function rowsToTsv(rows, includeHeader = true) {
  const header = exportHeader(rows);
  const lines = rows.map((r) =>
    (rowsHaveRepoColumn(rows) ?
      [r.person, r.fromRepo ?? "", r.typeLabel, r.value, r.source]
    : [r.person, r.typeLabel, r.value, r.source]
    )
      .map((cell) => String(cell ?? "").replace(/\t/g, " "))
      .join("\t")
  );
  return includeHeader ? [header.join("\t"), ...lines].join("\n") : lines.join("\n");
}

export function rowsToCsv(rows, includeHeader = true) {
  const esc = (v) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = exportHeader(rows);
  const lines = rows.map((r) =>
    (rowsHaveRepoColumn(rows) ?
      [r.person, r.fromRepo ?? "", r.typeLabel, r.value, r.source]
    : [r.person, r.typeLabel, r.value, r.source]
    )
      .map(esc)
      .join(",")
  );
  return includeHeader ? [header.map(esc).join(","), ...lines].join("\n") : lines.join("\n");
}

export function rowKey(r, i) {
  return `${r.person}-${r.type}-${r.value}-${r.source}-${i}`;
}

/** @returns {{ type: string, typeLabel: string, values: string[], count: number }[]} */
export function groupValuesByContactType(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.type)) {
      map.set(row.type, { type: row.type, typeLabel: row.typeLabel, values: new Set() });
    }
    map.get(row.type).values.add(row.value);
  }
  return [...map.values()]
    .map((entry) => ({
      type: entry.type,
      typeLabel: entry.typeLabel,
      values: [...entry.values],
      count: entry.values.size,
    }))
    .sort((a, b) => a.typeLabel.localeCompare(b.typeLabel));
}

export function valuesTextForType(groups, type) {
  const group = groups.find((g) => g.type === type);
  if (!group) return "";
  return group.values.join("\n");
}