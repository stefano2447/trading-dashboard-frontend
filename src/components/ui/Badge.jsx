export function Badge({ value, type }) {
  const color = type === "positive" ? "var(--accent)"
              : type === "negative" ? "var(--danger)"
              : type === "warning"  ? "var(--warning)"
              : "var(--text-secondary)";
  const bg    = type === "positive" ? "var(--accent-dim)"
              : type === "negative" ? "var(--danger-dim)"
              : type === "warning"  ? "var(--warning-dim)"
              : "var(--bg-elevated)";
  return (
    <span style={{
      color, background: bg,
      padding: "2px 8px",
      borderRadius: "4px",
      fontSize: "12px",
      fontFamily: "var(--font-data)",
      fontWeight: 500,
    }}>
      {value}
    </span>
  );
}