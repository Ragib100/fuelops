import { notFound } from 'next/navigation';
import { stations } from '@/lib/data';
import { PageHeading, SectionTitle, Tag } from '@/components/ui';
export function generateStaticParams() {
  return stations.map((s) => ({ id: s.id }));
}
export default function StationPage({ params }: { params: { id: string } }) {
  const s = stations.find((x) => x.id === params.id);
  if (!s) notFound();
  return (
    <>
      <PageHeading
        eyebrow={`NETWORK / ${s.region.toUpperCase()}`}
        title={s.name}
        description={`${s.profile} demand profile · Station ${s.id}`}
        action={<Tag tone="green">● {s.status}</Tag>}
      />
      <div className="station-kpis">
        <div className="panel">
          <span>PROJECTED STOCKOUT RISK</span>
          <b className="risk-number">{s.risk === 'HIGH' ? '72%' : '34%'}</b>
          <small>Diesel · within next 24 hours</small>
        </div>
        <div className="panel">
          <span>FORECAST DEMAND</span>
          <b>
            8,500 <small>L / day</small>
          </b>
          <small>12% above 7-day baseline</small>
        </div>
        <div className="panel">
          <span>INCOMING SUPPLY</span>
          <b>
            5,000 <small>L</small>
          </b>
          <small>{s.arrival} · estimated</small>
        </div>
      </div>
      <div className="content-grid detail-grid">
        <section className="panel chart-panel">
          <SectionTitle
            title="Inventory and demand"
            detail="Last 12 simulation ticks · liters"
            action={
              <span className="chart-legend">
                <i className="legend-dot green-dot" /> Inventory{' '}
                <i className="legend-dot violet-dot" /> Demand
              </span>
            }
          />
          <div className="chart-placeholder">
            <div className="chart-y">
              <span>15k</span>
              <span>10k</span>
              <span>5k</span>
              <span>0</span>
            </div>
            <div className="chart-drawing">
              <div className="grid-lines">
                <i />
                <i />
                <i />
                <i />
              </div>
              <svg
                viewBox="0 0 720 230"
                preserveAspectRatio="none"
                aria-label="Sample inventory and forecast chart"
              >
                <defs>
                  <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor="#38a889" stopOpacity=".2" />
                    <stop offset="1" stopColor="#38a889" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path
                  d="M0,55 C60,70 90,80 130,84 S220,98 260,112 S350,116 390,140 S470,146 520,164 S620,170 720,193 L720,230 L0,230Z"
                  fill="url(#area)"
                />
                <path
                  d="M0,55 C60,70 90,80 130,84 S220,98 260,112 S350,116 390,140 S470,146 520,164 S620,170 720,193"
                  fill="none"
                  stroke="#42a88b"
                  strokeWidth="3"
                />
                <path
                  d="M0,125 C75,112 92,115 130,130 S210,138 260,120 S345,129 390,119 S480,137 520,126 S630,136 720,120"
                  fill="none"
                  stroke="#9582d8"
                  strokeWidth="2"
                  strokeDasharray="6 6"
                />
              </svg>
              <div className="chart-x">
                <span>T−11</span>
                <span>T−8</span>
                <span>T−5</span>
                <span>T−2</span>
                <span>Now</span>
              </div>
            </div>
          </div>
          <div className="chart-caption">
            <span>
              Inventory trending down <b>−8.4% / tick</b>
            </span>
            <span>
              Forecast range <b>±12% uncertainty</b>
            </span>
          </div>
        </section>
        <section className="panel risk-breakdown">
          <SectionTitle title="Risk breakdown" detail="Diesel shortage signals" />
          <div className="risk-score">
            <div className="risk-ring">
              72<span>%</span>
            </div>
            <div>
              <Tag tone="HIGH">HIGH RISK</Tag>
              <p>
                Likely stockout within
                <br />
                <b>6.2 hours</b>
              </p>
            </div>
          </div>
          {[
            ['Inventory coverage', '15.8 hours'],
            ['Demand vs baseline', '+12%'],
            ['Next incoming supply', 'No shipment'],
            ['Model confidence', '86%'],
          ].map(([a, b]) => (
            <div className="breakdown-row" key={a}>
              <span>{a}</span>
              <b>{b}</b>
            </div>
          ))}
          <div className="risk-reason">
            <b>Why this station is at risk</b>
            <p>
              Diesel stock is at 37% capacity and forecast consumption exceeds available inventory
              before the next planned resupply.
            </p>
          </div>
        </section>
      </div>
      <section className="panel station-fuel-panel">
        <SectionTitle title="Current inventory by fuel" detail="Snapshot captured at tick 42" />
        <div className="fuel-inventory-grid">
          {(['Diesel', 'Petrol', 'Octane'] as const).map((f) => (
            <div className="fuel-inventory" key={f}>
              <div>
                <b>{f}</b>
                <Tag tone={f === 'Diesel' && s.risk === 'HIGH' ? 'HIGH' : 'green'}>
                  {f === 'Diesel' && s.risk === 'HIGH' ? 'AT RISK' : 'HEALTHY'}
                </Tag>
              </div>
              <strong>
                {s.inventory[f].toLocaleString()} <small>L</small>
              </strong>
              <div className="meter wide">
                <i
                  className={f === 'Diesel' && s.risk === 'HIGH' ? 'meter-red' : ''}
                  style={{ width: `${Math.round((s.inventory[f] / s.capacity[f]) * 100)}%` }}
                />
              </div>
              <small>of {s.capacity[f].toLocaleString()} L capacity</small>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
