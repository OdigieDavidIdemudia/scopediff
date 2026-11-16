import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useApp } from "../state/AppStore";
import { cn, formatDate, initials } from "../lib/format";
import { Logo, ToastView } from "./ui";
import {
  LayersIcon,
  ListIcon,
  MoonIcon,
  SlidersIcon,
  StarIcon,
  SunIcon,
} from "./Icons";

const navItems = [
  { to: "/", label: "Feed", icon: ListIcon, match: (path: string) => path === "/" || path.startsWith("/changes") },
  { to: "/programs", label: "Programs", icon: LayersIcon, match: (path: string) => path.startsWith("/programs") },
  { to: "/watchlist", label: "Watchlist", icon: StarIcon, match: (path: string) => path.startsWith("/watchlist") },
  { to: "/admin", label: "Admin", icon: SlidersIcon, match: (path: string) => path.startsWith("/admin") },
];

export function AppShell() {
  const { mode, setMode, canUseLive, theme, toggleTheme, user, data } = useApp();
  const location = useLocation();

  useEffect(() => {
    if (location.hash) {
      const id = location.hash.slice(1);
      const timer = window.setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
      return () => window.clearTimeout(timer);
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [location.pathname, location.hash]);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      {mode === "live" ? (
        <div className="mode-strip mode-strip--live">
          <span className="mode-strip__tag">Live worker</span>
          <span className="mode-strip__text">
            Live bootstrap connected. Alerts obey the materiality floor and the worker never scans a target.
          </span>
          <Link className="mode-strip__link" to="/admin">
            Worker status →
          </Link>
        </div>
      ) : (
        <div className="mode-strip">
          <span className="mode-strip__tag">Demo data</span>
          <span className="mode-strip__text">
            Sandbox targets use RFC 2606 domains and RFC 5737 ranges. Nothing is scanned.
          </span>
          <Link className="mode-strip__link" to="/admin">
            How this works →
          </Link>
        </div>
      )}

      <header className="topbar">
        <div className="topbar__inner">
          <Logo />
          <nav className="nav" aria-label="Primary">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={cn("nav__link", item.match(location.pathname) && "is-active")}
                  aria-current={item.match(location.pathname) ? "page" : undefined}
                >
                  <Icon size={12} />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>
          <div className="topbar__actions">
            <div className="mode-toggle" role="group" aria-label="Data mode">
              <button
                type="button"
                aria-pressed={mode === "demo"}
                onClick={() => setMode("demo")}
                title="View the bundled fictional dataset"
              >
                Demo
              </button>
              <button
                type="button"
                aria-pressed={mode === "live"}
                onClick={() => setMode("live")}
                disabled={!canUseLive}
                title={
                  canUseLive
                    ? "Use the live worker and your watched programs"
                    : "Live mode needs VITE_API_URL"
                }
              >
                Live
              </button>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            >
              {theme === "dark" ? <SunIcon size={15} /> : <MoonIcon size={15} />}
            </button>
            {user ? (
              <Link className="user-chip" to="/login" title="Account and sign out">
                <span className="user-chip__avatar" aria-hidden="true">
                  {initials(user.name)}
                </span>
                <span className="user-chip__name">{user.name}</span>
                <span className="user-chip__mode">{mode}</span>
              </Link>
            ) : (
              <Link className="button button--sm" to="/login">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="page">
        <Outlet />
      </main>

      <footer className="footer">
        <div className="footer__inner">
          <div>
            <div className="footer__brand">ScopeDiff</div>
            <div>Know what changed before you test.</div>
          </div>
          <div className="footer__note">
            No scanning. No exploitation. ScopeDiff only compares published scope revisions.
            This build is a hackathon demo; seeded programs are fictional and use reserved
            example domains. Dataset generated {formatDate(data.meta.generated_at)}.
          </div>
          <div>
            <Link to="/admin">Worker admin</Link>
            {" · "}
            <Link to="/watchlist">Alert settings</Link>
          </div>
        </div>
      </footer>

      <ToastView />
    </div>
  );
}
