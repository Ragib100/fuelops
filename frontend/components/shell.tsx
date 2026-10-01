'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { fmtTickPadded } from '@/lib/format';

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

type ShellProps = {
  tick: number | null;
  simStatus: string;
  degraded: boolean;
  stale: boolean;
  alertCount: number;
  children: React.ReactNode;
};

export function Shell({ tick, simStatus, degraded, stale, alertCount, children }: ShellProps) {
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const isLive = simStatus === 'LIVE' || simStatus === 'RUNNING';
  const simTone = simStatus === 'PAUSED' ? 'amber' : isLive ? 'green' : 'neutral';
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
                  {href === '/alerts' && alertCount > 0 ? (
                    <span className="nav-count">{alertCount > 99 ? '99+' : alertCount}</span>
                  ) : null}
                </Link>
              ))}
            </section>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sim-card">
            <span className={`pulse ${isLive ? 'pulse-live' : 'pulse-idle'}`} />
            <div>
              <b>{simStatus === 'PAUSED' ? 'Simulator paused' : isLive ? 'Simulator online' : 'Simulator offline'}</b>
              <small>Last sync · just now</small>
            </div>
            <span className="tiny-check">{simStatus === 'PAUSED' ? '⏸' : '✓'}</span>
          </div>
          <div className="user-card">
            <div className="avatar">AR</div>
            <div>
              <b>Operator</b>
              <small>Demo controls · /api/admin/demo/*</small>
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
            <span className={`sim-pill sim-pill-${simTone}`}>
              <i /> {stale ? 'STALE DATA' : 'LIVE'}
            </span>
            <span className="tick-pill">
              TICK <b>{fmtTickPadded(tick)}</b>
            </span>
            <button className="icon-button" aria-label="Notifications">
              ♧
              {alertCount > 0 ? <i className="notify-dot" /> : null}
            </button>
            <div className="top-avatar">OP</div>
          </div>
        </header>
        <div className="page-wrap">
          {degraded ? (
            <div className="degraded-banner">
              <span className="banner-icon">↻</span>
              <span>
                <b>{stale ? 'Cached simulator snapshot · real-time updates paused.' : 'Decision engine degraded.'}</b>{' '}
                {stale
                  ? 'Showing the last known good state.'
                  : 'Threshold fallback policy is active. Showing the last known good snapshot.'}
              </span>
              <Link href="/status">
                View status <span>→</span>
              </Link>
            </div>
          ) : null}
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