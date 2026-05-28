export function Spinner() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "3rem" }}>
      <div style={{
        width: 32, height: 32,
        border: "2px solid var(--border)",
        borderTop: "2px solid var(--accent)",
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}