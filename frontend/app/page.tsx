import Link from 'next/link';
import { alerts, depots, stations } from '@/lib/data';
import { PageHeading, SectionTitle, StationLink, Tag } from '@/components/ui';

export default function OverviewPage() {
  return (
    <>
      <PageHeading
        eyebrow="WEDNESDAY, OCTOBER 1 · SIMULATION RUN 01"
        title="Good morning, Arif"
        description="Here’s what’s happening across your fuel network right now."
        action={<button className="button button-secondary">↻ &nbsp; Refresh snapshot</button>}
      />
      <div className="simulation-strip">
        <div className="strip-icon">◷</div>
        <div>
          <b>Simulation running</b>
          <span>
            Tick 42 <i>·</i> 10:45 AM simulated time <i>·</i> 15 min / tick
          </span>
        </div>
        <span className="run-state">
          <i /> LIVE
        </span>
        <button>⏸</button>
      </div>
      <div className="kpi-grid">
        <Kpi
          label="SERVICE LEVEL"
          value="94.2%"
          trend="↑ 2.4%"
          note="vs. previous 10 ticks"
          icon="◉"
          tone="green"
        />
        <Kpi
          label="ACTIVE ALERTS"
          value="3"
          trend="2 require action"
          note="1 critical · 2 warnings"
          icon="◇"
          tone="red"
        />
        <Kpi
          label="STATIONS AT RISK"
          value="2"
          trend="1 high · 1 medium"
          note="out of 4 stations"
          icon="⌁"
          tone="amber"
        />
        <Kpi
          label="ALLOCATIONS IN TRANSIT"
          value="4"
          trend="12,500 L"
          note="across 3 active routes"
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
                {stations.map((s) => (
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
                    {(['Diesel', 'Petrol', 'Octane'] as const).map((f) => (
                      <td key={f}>
                        <div className="inventory-cell">
                          <b>{s.inventory[f].toLocaleString()} L</b>
                          <span className="meter">
                            <i
                              className={
                                s.risk === 'HIGH' && f === 'Diesel'
                                  ? 'meter-red'
                                  : s.risk === 'MEDIUM'
                                    ? 'meter-amber'
                                    : ''
                              }
                              style={{ width: `${(s.inventory[f] / s.capacity[f]) * 100}%` }}
                            />
                          </span>
                          <small>
                            {Math.round((s.inventory[f] / s.capacity[f]) * 100)}% capacity
                          </small>
                        </div>
                      </td>
                    ))}
                    <td>
                      <Tag tone={s.risk}>{s.risk}</Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-legend">
            <span>
              <i className="legend-dot green-dot" /> Healthy
            </span>
            <span>
              <i className="legend-dot amber-dot" /> Monitor
            </span>
            <span>
              <i className="legend-dot red-dot" /> At risk
            </span>
            <span>Inventory as of tick 42</span>
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
            {alerts.slice(0, 3).map((a) => (
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
              <div className="depot-card" key={d.name}>
                <div className="depot-top">
                  <span className={`depot-icon ${d.color}`}>▤</span>
                  <Tag tone={d.status === 'OPEN' ? 'green' : 'amber'}>{d.status}</Tag>
                </div>
                <h3>{d.name}</h3>
                <span className="muted">{d.region}</span>
                <div className="depot-amount">
                  <b>{d.inventory}</b>
                  <span>total inventory</span>
                </div>
                <div className="meter wide">
                  <i style={{ width: `${d.fill}%` }} />
                </div>
                <div className="depot-foot">
                  <span>{d.fill}% capacity</span>
                  <span>{d.dispatch}</span>
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
          <div className="event-card">
            <div className="event-top">
              <span className="event-symbol">⌁</span>
              <Tag tone="amber">ACTIVE</Tag>
              <span className="event-since">Started 3 ticks ago</span>
            </div>
            <h3>Demand spike · Chattogram</h3>
            <p>
              Demand is elevated by <b>18%</b> across the region. Forecasts and allocation
              priorities have been adjusted.
            </p>
            <div className="event-foot">
              <span>2 stations affected</span>
              <Link href="/alerts">Inspect event →</Link>
            </div>
          </div>
          <div className="insight-note">
            <span>✳</span>{' '}
            <span>
              <b>Network insight</b>Mirpur has an alternate cross-region route via Patiya if the
              Gazipur route is disrupted.
            </span>
          </div>
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
