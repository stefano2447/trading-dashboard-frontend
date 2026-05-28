import { Sidebar } from "./Sidebar";
import { Outlet } from "react-router-dom";

export function Layout() {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar />
      <main style={{
        flex: 1,
        padding: "2rem",
        overflowY: "auto",
        paddingBottom: "5rem", // spazio per mobile nav
      }}>
        <Outlet />
      </main>
    </div>
  );
}