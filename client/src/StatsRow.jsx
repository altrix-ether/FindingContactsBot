export default function StatsRow({ items }) {
  if (!items?.length) return null;
  return (
    <div className="stats-grid">
      {items.map((item) => (
        <div key={item.label} className="stat-card">
          <span className="stat-value">{item.value}</span>
          <span className="stat-label">{item.label}</span>
          {item.hint && <span className="stat-hint">{item.hint}</span>}
        </div>
      ))}
    </div>
  );
}