'use client';
import { useState } from 'react';
import { PageHeading, Tag } from '@/components/ui';

type Alert = {
  id: string;
  severity: string;
  kind: string;
  title: string;
  detail: string;
  station: string | null;
  time: string;
  color: string;
  tick: number | null;
};

type Counts = { critical: number; warning: number; info: number; total: number };

export function AlertsClient({ initial, counts }: { initial: Alert[]; counts: Counts }) {
  const [filter, setFilter] = useState('All alerts');
  const rows =
    filter === 'All alerts' ? initial : initial.filter((a) => a.severity === filter);
  return (
    <>
      <PageHeading
        eyebrow="OPERATIONS / MONITORING"
        title="Alerts"
        description="Shortage risks, disruptions, and system signals from across the simulated network."
        action={<button className="button button-secondary" type="button">✓ &nbsp; Acknowledge all</button>}
      />
      <div className="alert-summary">
        <Summary value={String(counts.critical)} label="Critical" tone="red" />
        <Summary value={String(counts.warning)} label="Warnings" tone="amber" />
        <Summary value={String(counts.info)} label="Information" tone="blue" />
        <Summary value={String(counts.total)} label="Total signals" tone="neutral" />
      </div>
      <div className="panel list-panel">
        <div className="list-toolbar">
          <div>
            <h2>Alert feed</h2>
            <span>Latest first · Updated just now</span>
          </div>
          <div className="filter-group">
            {['All alerts', 'Critical', 'Warning', 'Info'].map((f) => (
              <button
                className={filter === f ? 'filter-active' : ''}
                onClick={() => setFilter(f)}
                key={f}
                type="button"
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="muted">No alerts in this category.</div>
        ) : (
          rows.map((a) => (
            <article className="feed-alert" key={a.id}>
              <span className={`alert-marker marker-${a.color}`}>
                {a.color === 'red' ? '!' : a.color === 'amber' ? '△' : 'i'}
              </span>
              <div className="feed-copy">
                <div className="feed-title">
                  <Tag
                    tone={
                      a.severity === 'Critical'
                        ? 'HIGH'
                        : a.severity === 'Warning'
                          ? 'MEDIUM'
                          : 'blue'
                    }
                  >
                    {a.severity}
                  </Tag>
                  <span>{a.kind}</span>
                  <small>{a.time}</small>
                </div>
                <h3>{a.title}</h3>
                <p>{a.detail}</p>
                <div className="feed-meta">
                  {a.id}
                  <i>·</i>
                  {a.station ?? '—'}
                  <i>·</i>
                  {a.tick != null ? `Tick ${a.tick}` : 'Tick —'}
                </div>
              </div>
              <button className="icon-button small-icon" type="button" aria-label="More">···</button>
            </article>
          ))
        )}
      </div>
    </>
  );
}

function Summary({ value, label, tone }: { value: string; label: string; tone: string }) {
  return (
    <div className="summary-card">
      <span className={`summary-dot ${tone}`} />
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}