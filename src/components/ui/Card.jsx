export function Card({ children, className = "", onClick }) {
  return (
    <div
      onClick={onClick}
      className={className}
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        padding: "1.25rem",
        ...(onClick ? { cursor: "pointer" } : {}),
      }}
    >
      {children}
    </div>
  );
}