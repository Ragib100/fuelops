import { notFound } from 'next/navigation';
import { apiServer } from '@/lib/api';
import { fmtLiters, fmtPercent, fmtTick, FUEL_DISPLAY, mapFuelObject } from '@/lib/format';
import { PageHeading, SectionTitle, Tag } from '@/components/ui';

type StationDetail = {
  id: string;
  name: string;
  region: string;
  profile: string;
  status: string;
  demand_multiplier: number;
  inventory: Record<string, number>;
  capacity: Record<string, number>;
  inventory_pct: Record<string, number>;
  forecast: Record<string, number>;
  incoming: Array<{
    allocation_id: number;
    fuel_type: string;
    quantity: number;
    departure_tick: number | null;
    expected_arrival_tick: number | null;
    status: string;
    route_id: string;
  }>;
  risk_breakdown: Record<string, {
    inventory_l: number;
    capacity_l: number;
    daily_demand_l: number;
    hours_to_stockout: number;
    coverage_pct_of_capacity: number;
  }>;
};

const PROFILE_LABEL: Record<string, string> = {
  urban_high: 'Urban high',
  industrial: 'Industrial',
  highway: 'Highway',
  regional: 'Regional',
};

const REGION_LABEL: Record<string, string> = {
  'region-dhaka': 'Dhaka Division',
  'region-chattogram': 'Chattogram Division',
};

export const dynamic = 'force-dynamic';

export default async function StationPage({ params }: { params: { id: string } }) {
  let s: StationDetail | null = null;
  try {
    s = await apiServer<StationDetail>(`/api/stations/${encodeURIComponent(params.id)}`);
  } catch {
    notFound();
  }
  if (!s) notFound();

  const inv = mapFuelObject<number>(s.inventory);
  const cap = mapFuelObject<number>(s.capacity);
  const pct = mapFuelObject<number>(s.inventory_pct);
  const regionLabel = REGION_LABEL[s.region] ?? s.region;
  const profileLabel = PROFILE_LABEL[s.profile] ?? s.profile;

  // Pick the highest-risk fuel for the headline risk ring.
  const fuels = FUEL_DISPLAY.map((f) => ({
    name: f,
    pct: pct[f] ?? 0,
    hts: s!.risk_breakdown[f.toUpperCase()]?.hours_to_stockout ?? 999,
  }));
  const worstFuel = fuels.reduce((a, b) => (a.pct < b.pct ? a : b));
  const worstHts = s.risk_breakdown[worstFuel.name.toUpperCase()]?.hours_to_stockout ?? null;
  const riskLabel = worstFuel.pct < 30 ? 'HIGH RISK' : worstFuel.pct < 50 ? 'MONITOR' : 'HEALTHY';
  const riskTone = worstFuel.pct < 30 ? 'HIGH' : worstFuel.pct < 50 ? 'amber' : 'green';

  const incomingTotal = s.incoming.reduce((acc, x) => acc + (x.quantity || 0), 0);
  const firstIncoming = s.incoming[0];

  return (
    <>
      <PageHeading
        eyebrow={`NETWORK / ${regionLabel.toUpperCase()}`}
        title={s.name}
        description={`${profileLabel} demand profile · Station ${s.id}`}
        action={<Tag tone={s.status === 'OPEN' ? 'green' : 'amber'}>● {s.status}</Tag>}
      />
      <div className="station-kpis">
        <div className="panel">
          <span>PROJECTED STOCKOUT RISK</span>
          <b className="risk-number">
            {fmtPercent(100 - worstFuel.pct, 0)}
          </b>
          <small>{worstFuel.name} · {worstHts != null ? `${worstHts.toFixed(1)} h to stockout` : 'within 24 hours'}</small>
        </div>
        <div className="panel">
          <span>FORECAST DEMAND</span>
          <b>
            {fmtLiters(s.forecast['DIESEL'] || 0)} <small>L / day</small>
          </b>
          <small>
            Demand multiplier {s.demand_multiplier.toFixed(2)}×
          </small>
        </div>
        <div className="panel">
          <span>INCOMING SUPPLY</span>
          <b>
            {fmtLiters(incomingTotal || null)} <small>L</small>
          </b>
          <small>
            {firstIncoming
              ? `${s.incoming.length} active · ETA tick ${firstIncoming.expected_arrival_tick ?? '?'}`
              : 'No incoming shipments'}
          </small>
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
                <i /><i /><i /><i />
              </div>
              <svg viewBox="0 0 720 230" preserveAspectRatio="none" aria-label="Sample inventory and forecast chart">
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
            <span>Inventory trending down <b>−{(s.demand_multiplier * 2).toFixed(1)}% / tick</b></span>
            <span>Forecast range <b>±{(s.demand_multiplier * 6).toFixed(0)}% uncertainty</b></span>
          </div>
        </section>
        <section className="panel risk-breakdown">
          <SectionTitle title="Risk breakdown" detail={`${worstFuel.name} shortage signals`} />
          <div className="risk-score">
            <div className="risk-ring">
              {fmtPercent(100 - worstFuel.pct, 0).replace('%', '')}<span>%</span>
            </div>
            <div>
              <Tag tone={riskTone as 'HIGH' | 'amber' | 'green'}>{riskLabel}</Tag>
              <p>
                Likely stockout within
                <br />
                <b>{worstHts != null ? `${worstHts.toFixed(1)} hours` : '—'}</b>
              </p>
            </div>
          </div>
          {[
            ['Inventory coverage', worstHts != null ? `${worstHts.toFixed(1)} hours` : '—'],
            ['Demand vs baseline', `×${s.demand_multiplier.toFixed(2)}`],
            ['Next incoming supply', firstIncoming ? `${fmtLiters(firstIncoming.quantity)}` : 'No shipment'],
            ['Model confidence', '—'],
          ].map(([a, b]) => (
            <div className="breakdown-row" key={a}>
              <span>{a}</span>
              <b>{b}</b>
            </div>
          ))}
          <div className="risk-reason">
            <b>Why this station is at risk</b>
            <p>
              {worstFuel.name} is at {worstFuel.pct}% capacity and forecast consumption
              exceeds available inventory in the next {worstHts != null ? `${worstHts.toFixed(0)} hours` : 'period'}.
            </p>
          </div>
        </section>
      </div>
      <section className="panel station-fuel-panel">
        <SectionTitle title="Current inventory by fuel" detail={`Snapshot as of ${fmtTick(null)}`} />
        <div className="fuel-inventory-grid">
          {FUEL_DISPLAY.map((f) => {
            const fuelPct = pct[f] ?? 0;
            const fuelTone = fuelPct < 30 ? 'HIGH' : 'green';
            const fuelLabel = fuelPct < 30 ? 'AT RISK' : fuelPct < 50 ? 'MONITOR' : 'HEALTHY';
            const fuelClass = fuelPct < 30 ? 'meter-red' : '';
            return (
              <div className="fuel-inventory" key={f}>
                <div>
                  <b>{f}</b>
                  <Tag tone={fuelTone}>{fuelLabel}</Tag>
                </div>
                <strong>
                  {fmtLiters(inv[f] ?? 0)} <small>L</small>
                </strong>
                <div className="meter wide">
                  <i className={fuelClass} style={{ width: `${fuelPct}%` }} />
                </div>
                <small>of {fmtLiters(cap[f] ?? 0)} capacity</small>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}