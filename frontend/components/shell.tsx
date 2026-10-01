'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const nav = [
  {
    title: 'OPERATIONS',
    links: [
      ['Overview', '/', '◫'],
      ['Alerts', '/alerts', '◇'],
      ['Recommendations', '/recommendations', '✳'],
    ],
  },
  {
    title: 'NETWORK',
    links: [
      ['Network map', '/network', '⌘'],
      ['Decision history', '/history', '↗'],
    ],
  },
  {
    title: 'SYSTEM',
    links: [
      ['System status', '/status', '◉'],
      ['Demo controls', '/demo', '▶'],
    ],
  },
];
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  return (
    <div className="app-shell">
      <aside className={`sidebar ${menu ? 'sidebar-open' : ''}`}>
        <Link className="brand" href="/">
          <span className="brand-mark">F</span>
          <span>
            <b>
              fuel<span>ops</span>
            </b>
            <small>SUPPLY INTELLIGENCE</small>
          </span>
        </Link>
        <div className="workspace">
          <span className="workspace-dot" /> BUP CSE FEST 2026 <span className="chevron">⌄</span>
        </div>
        <nav>
          {nav.map((group) => (
            <section className="nav-group" key={group.title}>
              <div className="nav-label">{group.title}</div>
              {group.links.map(([label, href, icon]) => (
                <Link
                  onClick={() => setMenu(false)}
                  className={`nav-link ${path === href || (href !== '/' && path.startsWith(href)) ? 'active' : ''}`}
                  href={href}
                  key={href}
                >
                  <span className="nav-icon">{icon}</span>
                  {label}
                  {href === '/alerts' && <span className="nav-count">3</span>}
                </Link>
              ))}
            </section>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sim-card">
            <span className="pulse" />
            <div>
              <b>Simulator online</b>
              <small>Last sync · 12 sec ago</small>
            </div>
            <span className="tiny-check">✓</span>
          </div>
          <div className="user-card">
            <div className="avatar">AR</div>
            <div>
              <b>Arif Rahman</b>
              <small>Operations lead</small>
            </div>
            <span className="more">···</span>
          </div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <button aria-label="Toggle menu" className="mobile-menu" onClick={() => setMenu(!menu)}>
            ☰
          </button>
          <div className="crumb">
            Fuel Operations <span>/</span> <b>{pageName(path)}</b>
          </div>
          <div className="top-actions">
            <span className="sim-pill">
              <i /> SIMULATED DATA
            </span>
            <span className="tick-pill">
              TICK <b>042</b>
            </span>
            <button className="icon-button" aria-label="Notifications">
              ♧<i className="notify-dot" />
            </button>
            <div className="top-avatar">AR</div>
          </div>
        </header>
        <div className="page-wrap">
          <div className="degraded-banner">
            <span className="banner-icon">↻</span>
            <span>
              <b>Decision engine degraded.</b> Threshold fallback policy is active. Cached simulator
              snapshot is current as of tick 42.
            </span>
            <Link href="/status">
              View status <span>→</span>
            </Link>
          </div>
          {children}
          <footer>
            FuelOps Control Room <span>·</span> BUP CSE Fest 2026 <span>·</span> All figures are
            simulated
          </footer>
        </div>
      </main>
    </div>
  );
}
function pageName(path: string) {
  if (path.startsWith('/stations/')) return 'Station detail';
  return (
    (
      {
        '/': 'Overview',
        '/alerts': 'Alerts',
        '/recommendations': 'Recommendations',
        '/network': 'Network map',
        '/history': 'Decision history',
        '/status': 'System status',
        '/demo': 'Demo controls',
      } as Record<string, string>
    )[path] || 'Overview'
  );
}
