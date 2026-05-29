import { NavLink } from "react-router-dom";
import { BarChart2, Search, GitBranch, Briefcase, Radio, Newspaper } from "lucide-react";

const navItems = [
  { path: "/",             icon: BarChart2,  label: "EA Overview"  },
  { path: "/analisi",      icon: Search,     label: "Analisi EA"   },
  { path: "/correlazioni", icon: GitBranch,  label: "Correlazioni" },
  { path: "/portafogli",   icon: Briefcase,  label: "Portafogli"   },
  { path: "/conti",        icon: Radio,      label: "Conti Live"   },
  { path: "/news",         icon: Newspaper,  label: "News"         },
];

export function Sidebar() {
  return (
    <>
      {/* Desktop sidebar */}
      <aside style={{
        width: 220,
        minHeight: "100vh",
        background: "var(--bg-surface)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        padding: "1.5rem 0",
        position: "sticky",
        top: 0,
      }}
      className="desktop-sidebar"
      >
        {/* Logo */}
        <div style={{ padding: "0 1.5rem 2rem", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontFamily: "var(--font-data)", fontSize: 13, color: "var(--text-muted)", marginBottom: 4 }}>
            TRADING
          </div>
          <div style={{ fontFamily: "var(--font-data)", fontSize: 18, fontWeight: 600, color: "var(--accent)", letterSpacing: 1 }}>
            DASHBOARD
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "1rem 0" }}>
          {navItems.map(({ path, icon: Icon, label }) => (
            <NavLink
              key={path}
              to={path}
              end={path === "/"}
              style={({ isActive }) => ({
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.65rem 1.5rem",
                color: isActive ? "var(--accent)" : "var(--text-secondary)",
                background: isActive ? "var(--accent-dim)" : "transparent",
                borderLeft: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                textDecoration: "none",
                fontSize: 14,
                fontWeight: isActive ? 500 : 400,
                transition: "all 0.15s",
              })}
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div style={{ padding: "1rem 1.5rem", borderTop: "1px solid var(--border)" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-data)" }}>
            v1.0.0
          </div>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="mobile-nav" style={{
        display: "none",
        position: "fixed",
        bottom: 0, left: 0, right: 0,
        background: "var(--bg-surface)",
        borderTop: "1px solid var(--border)",
        zIndex: 100,
        padding: "0.5rem 0",
      }}>
        {navItems.map(({ path, icon: Icon, label }) => (
          <NavLink
            key={path}
            to={path}
            end={path === "/"}
            style={({ isActive }) => ({
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "3px",
              flex: 1,
              padding: "0.4rem",
              color: isActive ? "var(--accent)" : "var(--text-muted)",
              textDecoration: "none",
              fontSize: 10,
            })}
          >
            <Icon size={18} />
            {label.split(" ")[0]}
          </NavLink>
        ))}
      </nav>

      <style>{`
        @media (max-width: 768px) {
          .desktop-sidebar { display: none !important; }
          .mobile-nav { display: flex !important; }
        }
      `}</style>
    </>
  );
}