import Link from 'next/link';
import { apiServer } from '@/lib/api';
import { fmtLiters, fmtPercent, fmtTick, fmtSimTime, FUEL_DISPLAY, mapFuelObject } from '@/lib/format';
import { PageHeading, SectionTitle, StationLink, Tag } from '@/components/ui';

type OverviewStation = {
  id: string;
  name: string;
  short: string;
  region: string;
  profile: string;
  status: string;
  risk: string;
  inventory: Record<string, number>;
  capacity: Record<string, number>;
  inventory_pct: Record<string, number>;
};

type OverviewDepot = {
  id: string;
  name: string;
  region: string;
  status: string;
  inventory_l: number;
  capacity_l: number;
  fill_pct: number;
  dispatch_per_tick: number;
};

type OverviewEventBanner = {
  type: string;
  severity: string;
  title: string;
  detail: string;
};

type OverviewResponse = {
  tick: number | null;
  sim_time: string | null;
  status: string | null;
  kpis: {
    service_level_pct: number;
    active_alerts: number;
    stations_at_risk: number;
    allocations_in_transit: number;
    allocation_liters: number;
  };
  stations: OverviewStation[];
  depots: OverviewDepot[];
  event_banner: OverviewEventBanner | null;
  stale: boolean;
};

type Alert = {
  id: string;
  severity: string;
  kind: string;
  title: string;
  detail: string;
  station: string | null;
  time: string;
  color: string;
};

const PROFILE_LABEL: Record<string, string> = {
  urban_high: 'Urban high',
  industrial: 'Industrial',
  highway: 'Highway',
  regional: 'Regional',
};

const DEPOT_COLOR: Record<string, string> = {
  'depot-gazipur': 'blue',
  'depot-patiya': 'violet',
};

export default async function OverviewPage() {
  let data: OverviewResponse | null = null;
  let alerts: Alert[] = [];
  try {
    [data, alerts] = await Promise.all([
      apiServer<OverviewResponse>('/api/overview'),
      apiServer<Alert[]>('/api/alerts'),
    ]);
  } catch {
    // Render a minimal error state rather than crashing the whole page.
    return <ApiDownNotice />;
  }

  const k = data.kpis;
  const stations = data.stations ?? [];
  const depots = data.depots ?? [];
  const banner = data.event_banner;
  const riskTone = (r: string) =>
    r === 'HIGH' ? 'red' : r === 'MEDIUM' ? 'amber' : 'green';

  return (
    <>
      <PageHeading
        eyebrow={`SIMULATION RUN · ${data.status ?? '—'}`}
        title="FuelOps control room"
        description="Live view of the fuel supply network, alerts, and decision queue."
        action={
          <form action="/api/recommendations/refresh" method="post">
            <button className="button button-secondary" type="submit">
              ↻ &nbsp; Refresh snapshot
            </button>
          </form>
        }
      />
      <div className="simulation-strip">
        <div className="strip-icon">◷</div>
        <div>
          <b>{data.status === 'RUNNING' ? 'Simulation running' : data.status === 'PAUSED' ? 'Simulation paused' : 'Simulation'}</b>
          <span>
            {fmtTick(data.tick)} <i>·</i> {fmtSimTime(data.sim_time)} simulated time <i>·</i>{' '}
            {data.stale ? 'STALE DATA' : '15 min / tick'}
          </span>
        </div>
        <span className="run-state">
          <i /> {data.stale ? 'STALE' : data.status === 'RUNNING' ? 'LIVE' : 'PAUSED'}
        </span>
        <Link href="/demo" className="button-link">
          {data.status === 'RUNNING' ? '⏸' : '▶'}
        </Link>
      </div>
      <div className="kpi-grid">
        <Kpi
          label="SERVICE LEVEL"
          value={fmtPercent(k.service_level_pct)}
          trend={k.service_level_pct >= 95 ? '↑ Healthy' : '↓ Watch'}
          note="vs. previous 10 ticks"
          icon="◉"
          tone={k.service_level_pct >= 95 ? 'green' : 'amber'}
        />
        <Kpi
          label="ACTIVE ALERTS"
          value={String(k.active_alerts)}
          trend={`${alerts.filter((a) => a.severity === 'Critical').length} critical`}
          note={`${alerts.filter((a) => a.severity === 'Warning').length} warnings`}
          icon="◇"
          tone={k.active_alerts > 0 ? 'red' : 'green'}
        />
        <Kpi
          label="STATIONS AT RISK"
          value={String(k.stations_at_risk)}
          trend={`${stations.filter((s) => s.risk === 'HIGH').length} high · ${stations.filter((s) => s.risk === 'MEDIUM').length} medium`}
          note={`out of ${stations.length} stations`}
          icon="⌁"
          tone={k.stations_at_risk > 0 ? 'amber' : 'green'}
        />
        <Kpi
          label="ALLOCATIONS IN TRANSIT"
          value={String(k.allocations_in_transit)}
          trend={fmtLiters(k.allocation_liters)}
          note="across active routes"
          icon="⇢"
          tone="blue"
        />
      </div>
      <div className="content-grid overview-grid">
        <section className="panel network-panel">
          <SectionTitle
            title="Network inventory"
            detail="Fuel availability across all stations"
            action={
              <Link href="/network" className="subtle-link">
                View network →
              </Link>
            }
          />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>STATION</th>
                  <th>STATUS</th>
                  <th>DIESEL</th>
                  <th>PETROL</th>
                  <th>OCTANE</th>
                  <th>RISK</th>
                </tr>
              </thead>
              <tbody>
                {stations.map((s) => {
                  const inv = mapFuelObject<number>(s.inventory);
                  const pct = mapFuelObject<number>(s.inventory_pct);
                  return (
                    <tr key={s.id}>
                      <td>
                        <StationLink id={s.id}>{s.short}</StationLink>
                        <small>{s.region}</small>
                      </td>
                      <td>
                        <span className="online">
                          <i />
                          {s.status}
                        </span>
                      </td>
                      {FUEL_DISPLAY.map((f) => (
                        <td key={f}>
                          <div className="inventory-cell">
                            <b>{fmtLiters(inv[f])}</b>
                            <span className="meter">
                              <i
                                className={
                                  s.risk === 'HIGH' && f === 'Diesel'
                                    ? 'meter-red'
                                    : s.risk === 'MEDIUM' && f === 'Diesel'
                                      ? 'meter-amber'
                                      : ''
                                }
                                style={{ width: `${pct[f] ?? 0}%` }}
                              />
                            </span>
                            <small>{pct[f] ?? 0}% capacity</small>
                          </div>
                        </td>
                      ))}
                      <td>
                        <Tag tone={riskTone(s.risk)}>{s.risk}</Tag>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="table-legend">
            <span><i className="legend-dot green-dot" /> Healthy</span>
            <span><i className="legend-dot amber-dot" /> Monitor</span>
            <span><i className="legend-dot red-dot" /> At risk</span>
            <span>Inventory as of {fmtTick(data.tick)}</span>
          </div>
        </section>
        <section className="panel alert-panel">
          <SectionTitle
            title="Priority alerts"
            detail="Needs operator attention"
            action={
              <Link href="/alerts" className="subtle-link">
                All alerts →
              </Link>
            }
          />
          <div className="alert-list">
            {(alerts.length ? alerts.slice(0, 3) : []).map((a) => (
              <div className="alert-row" key={a.id}>
                <span className={`alert-marker marker-${a.color}`}>
                  {a.color === 'red' ? '!' : a.color === 'amber' ? '△' : 'i'}
                </span>
                <div className="alert-body">
                  <div className="alert-head">
                    <b>{a.title}</b>
                    <span>{a.time}</span>
                  </div>
                  <p>{a.detail}</p>
                  <small>
                    {a.id} <i>·</i> {a.kind}
                  </small>
                </div>
              </div>
            ))}
            {alerts.length === 0 ? (
              <div className="muted">No alerts at this tick.</div>
            ) : null}
          </div>
        </section>
      </div>
      <div className="content-grid lower-grid">
        <section className="panel">
          <SectionTitle
            title="Depot overview"
            detail="Storage and dispatch capacity"
            action={
              <Link href="/network" className="subtle-link">
                Routes →
              </Link>
            }
          />
          <div className="depot-grid">
            {depots.map((d) => (
              <div className="depot-card" key={d.id}>
                <div className="depot-top">
                  <span className={`depot-icon ${DEPOT_COLOR[d.id] ?? 'blue'}`}>▤</span>
                  <Tag tone={d.status === 'OPEN' ? 'green' : 'amber'}>{d.status}</Tag>
                </div>
                <h3>{d.name}</h3>
                <span className="muted">{d.region.replace('region-', '').replace(/\b\w/g, (c) => c.toUpperCase())}</span>
                <div className="depot-amount">
                  <b>{fmtLiters(d.inventory_l)}</b>
                  <span>total inventory</span>
                </div>
                <div className="meter wide">
                  <i style={{ width: `${d.fill_pct}%` }} />
                </div>
                <div className="depot-foot">
                  <span>{d.fill_pct}% capacity</span>
                  <span>{fmtLiters(d.dispatch_per_tick)} / tick</span>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="panel event-panel">
          <SectionTitle
            title="Active disruptions"
            detail="Events affecting the network"
            action={
              <Link href="/alerts" className="subtle-link">
                Event log →
              </Link>
            }
          />
          {banner ? (
            <div className="event-card">
              <div className="event-top">
                <span className="event-symbol">⌁</span>
                <Tag tone="amber">ACTIVE</Tag>
              </div>
              <h3>{banner.title}</h3>
              <p>{banner.detail}</p>
              <div className="event-foot">
                <span>{banner.severity}</span>
                <Link href="/alerts">Inspect event →</Link>
              </div>
            </div>
          ) : (
            <div className="event-card">
              <div className="event-top">
                <span className="event-symbol">✓</span>
                <Tag tone="green">CALM</Tag>
              </div>
              <h3>No active disruptions</h3>
              <p>All routes are available. Demand is at baseline.</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function Kpi({
  label,
  value,
  trend,
  note,
  icon,
  tone,
}: {
  label: string;
  value: string;
  trend: string;
  note: string;
  icon: string;
  tone: string;
}) {
  return (
    <div className="kpi-card">
      <div className="kpi-head">
        <span>{label}</span>
        <i className={`kpi-icon ${tone}`}>{icon}</i>
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-foot">
        <b className={tone}>{trend}</b>
        <span>{note}</span>
      </div>
    </div>
  );
}

function ApiDownNotice() {
  return (
    <>
      <PageHeading
        eyebrow="API OFFLINE"
        title="Backend unreachable"
        description="The frontend could not reach the FuelOps API."
      />
      <div className="demo-warning">
        ⚠ &nbsp; <span>
          <b>Cannot reach <code>BACKEND_URL</code>.</b> Confirm the API is running on{' '}
          <code>http://localhost:8080</code> and that <code>BACKEND_URL</code> is set in{' '}
          <code>frontend/.env.local</code>.
        </span>
      </div>
    </>
  );
}