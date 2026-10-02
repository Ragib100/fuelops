'use client';
import { useState, useTransition } from 'react';
import { PageHeading, SectionTitle, Tag } from '@/components/ui';

type ServiceHealth = { name: string; status: string; detail?: string | null };

export function DemoClient({
  initialStatus,
  initialTick,
  simulatorService,
  stale,
}: {
  initialStatus: string;
  initialTick: number | null;
  simulatorService: ServiceHealth | null;
  stale: boolean;
}) {
  const [sim, setSim] = useState(initialStatus);
  const [tick, setTick] = useState(initialTick);
  const [fault, setFault] = useState('None');
  const [event, setEvent] = useState('Demand spike');
  const [duration, setDuration] = useState('12');
  const [scope, setScope] = useState('All regions');
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Simulator event-type enum → slug.
  // Supply shortfall isn't in the default UI but is reachable via the
  // generic dropdown below.
  const EVENT_OPTIONS = [
    { label: 'Demand spike',     slug: 'demand_spike' },
    { label: 'Route disruption',  slug: 'route_disruption' },
    { label: 'Shipment delay',   slug: 'shipment_delay' },
    { label: 'Depot constraint', slug: 'depot_constraint' },
    { label: 'Station outage',   slug: 'station_outage' },
    { label: 'Supply shortfall', slug: 'supply_shortfall' },
  ];

  const REGION_ID = scope === 'Dhaka Division' ? 'region-dhaka'
    : scope === 'Chattogram Division' ? 'region-chattogram'
    : null;

  const callAction = async (path: string, body?: Record<string, unknown>) => {
    setFeedback(null);
    startTransition(async () => {
      try {
        const res = await fetch(path, {
          method: 'POST',
          headers: {
            ...(body ? { 'content-type': 'application/json' } : {}),
            'X-Operator-Token': process.env.NEXT_PUBLIC_OPERATOR_TOKEN ?? '',
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setFeedback({
            kind: 'err',
            message: data?.detail?.message ?? data?.message ?? `${res.status}`,
          });
          return;
        }
        setFeedback({ kind: 'ok', message: data?.message ?? 'ok' });
        // Refresh sim status + tick for run/pause/toggle/step/reset
        if (
          [
            '/api/admin/demo/run',
            '/api/admin/demo/pause',
            '/api/admin/demo/toggle',
            '/api/admin/demo/step',
            '/api/admin/demo/reset',
          ].includes(path)
        ) {
          try {
            const ov = await fetch('/api/overview').then((r) => r.json());
            if (ov?.status) setSim(ov.status);
            if (typeof ov?.tick === 'number') setTick(ov.tick);
          } catch {
            // ignore
          }
        }
      } catch (err: unknown) {
        setFeedback({
          kind: 'err',
          message: err instanceof Error ? err.message : 'request failed',
        });
      }
    });
  };

  const isRunning = sim === 'RUNNING' || sim === 'LIVE';

  return (
    <>
      <PageHeading
        eyebrow="SIMULATOR / OPERATOR TOOLS"
        title="Demo controls"
        description="Rehearse simulator events and dependency failures using the demo environment."
        action={<Tag tone="amber">RESTRICTED · DEMO ONLY</Tag>}
      />
      {simulatorService && simulatorService.status !== 'Healthy' ? (
        <div className="demo-warning">
          ⚠ &nbsp;{' '}
          <span>
            <b>Simulator service degraded.</b> {simulatorService.detail ?? simulatorService.status}.
          </span>
        </div>
      ) : null}
      {feedback ? (
        <div className={feedback.kind === 'ok' ? 'demo-warning ok-banner' : 'demo-warning'}>
          {feedback.kind === 'ok' ? '✓' : '⚠'} &nbsp;{' '}
          <span>
            <b>{feedback.kind === 'ok' ? 'OK' : 'Error'}.</b> {feedback.message}
          </span>
        </div>
      ) : null}
      <div className="content-grid demo-grid">
        <section className="panel demo-panel">
          <SectionTitle title="Simulation controls" detail="Current simulated world" />
          <div className="sim-state-row">
            <span>
              <i className={`pulse ${isRunning ? 'pulse-live' : 'pulse-idle'}`} /> Simulation status
            </span>
            <Tag tone={isRunning ? 'green' : 'neutral'}>{sim}</Tag>
          </div>
          <div className="sim-state-row">
            <span>Current tick</span>
            <b>{tick != null ? String(tick).padStart(3, '0') : '—'}</b>
          </div>
          <div className="sim-state-row">
            <span>Data freshness</span>
            <b>{stale ? 'STALE' : 'LIVE'}</b>
          </div>
          <div className="demo-button-row">
            <button
              className="button button-secondary"
              onClick={() => callAction('/api/admin/demo/step')}
              type="button"
              disabled={isPending}
            >
              ← Step back
            </button>
            <button
              className="button button-primary"
              onClick={() => callAction('/api/admin/demo/step')}
              type="button"
              disabled={isPending}
            >
              Step simulation →
            </button>
          </div>
          <div className="demo-button-row">
            <button
              className="button button-secondary"
              onClick={() => callAction('/api/admin/demo/toggle')}
              type="button"
              disabled={isPending}
            >
              {isRunning ? 'Ⅱ Pause' : '▶ Run simulation'}
            </button>
            <button
              className="button button-quiet"
              onClick={() => callAction('/api/admin/demo/reset')}
              type="button"
              disabled={isPending}
            >
              ⟲ Reset run
            </button>
          </div>
        </section>
        <section className="panel demo-panel">
          <SectionTitle title="Inject a crisis event" detail="Simulator domain event" />
          <label className="field-label">
            EVENT TYPE
            <select value={event} onChange={(e) => setEvent(e.target.value)} disabled={isPending}>
              {EVENT_OPTIONS.map((o) => (
                <option key={o.slug}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="field-label">
            AFFECTED AREA
            <select value={scope} onChange={(e) => setScope(e.target.value)} disabled={isPending}>
              <option>All regions</option>
              <option>Dhaka Division</option>
              <option>Chattogram Division</option>
            </select>
          </label>
          <label className="field-label">
            DURATION (ticks)
            <select value={duration} onChange={(e) => setDuration(e.target.value)} disabled={isPending}>
              <option value="3">3 ticks (45 min sim)</option>
              <option value="12">12 ticks (3 h sim)</option>
              <option value="48">48 ticks (12 h sim)</option>
            </select>
          </label>
          <p className="field-help">
            Event injection calls <code>POST /api/admin/demo/events</code>. The next ingest poll will
            surface the active event on <code>/alerts</code> and recompute recommendations.
          </p>
          <div className="demo-button-row">
            <button
              className="button button-primary"
              type="button"
              disabled={isPending}
              onClick={async () => {
                // Fetch the current tick so the event activates on the next
                // simulator step. Fall back to the page's initial tick if
                // /api/overview is unavailable.
                let startTick = tick ?? 0;
                try {
                  const ov = await fetch('/api/overview').then((r) => r.json());
                  if (typeof ov?.tick === 'number') {
                    startTick = ov.tick + 1;
                    setTick(startTick);
                  }
                } catch {
                  /* ignore */
                }
                const slug = EVENT_OPTIONS.find((o) => o.label === event)?.slug ?? 'demand_spike';
                const parameters: Record<string, unknown> = {};
                if (REGION_ID) {
                  // Region-scoped events apply the multiplier / disruption to one region.
                  parameters.region_ids = [REGION_ID];
                }
                callAction('/api/admin/demo/events', {
                  type: slug,
                  start_tick: startTick,
                  duration_ticks: Number(duration),
                  parameters,
                });
              }}
            >
              ⚡ Inject event
            </button>
          </div>
        </section>
        <section className="panel demo-panel">
          <SectionTitle
            title="Inject a dependency fault"
            detail="Test resilience and cached state"
          />
          <label className="field-label">
            FAULT TYPE
            <select value={fault} onChange={(e) => setFault(e.target.value)} disabled={isPending}>
              <option>None</option>
              <option>Unavailable</option>
              <option>Latency</option>
              <option>Error rate</option>
              <option>Stale data</option>
              <option>Stream disconnect</option>
            </select>
          </label>
          <p className="field-help">
            Fault injection calls <code>POST /api/admin/demo/faults</code>. Watch the system status page
            for the stale/degraded banner.
          </p>
          <div className="demo-button-row">
            <button
              className="button button-primary"
              type="button"
              disabled={isPending || fault === 'None'}
              onClick={() =>
                callAction('/api/admin/demo/faults', {
                  type: fault.toLowerCase().replace(/ /g, '_'),
                  duration_seconds: 30,
                })
              }
            >
              Apply fault
            </button>
            <button
              className="button button-secondary"
              type="button"
              disabled={isPending}
              onClick={() => callAction('/api/admin/demo/faults/clear')}
            >
              Clear all faults
            </button>
          </div>
        </section>
      </div>
      <div className="demo-audit">
        <b>ⓘ Demo safety</b>
        <span>
          All admin actions are gated by the <code>X-Operator-Token</code> header (value from{' '}
          <code>NEXT_PUBLIC_OPERATOR_TOKEN</code>). The backend forwards to the simulator's
          <code> /admin/*</code> API; for live events it persists a <code>SystemEvent</code> row in Postgres.
        </span>
      </div>
    </>
  );
}