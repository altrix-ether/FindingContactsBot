import { TYPE_CHIP_CLASS, TYPE_LABELS } from "./typeLabels.js";

export default function TypeBadge({ type }) {
  const label = TYPE_LABELS[type] ?? type;
  const cls = TYPE_CHIP_CLASS[type] ?? "type-default";
  return <span className={`type-badge ${cls}`}>{label}</span>;
}