import { apiServer } from '@/lib/api';
import { fmtLiters } from '@/lib/format';
import { PageHeading, SectionTitle, Tag, StationLink } from '@/components/ui';

type Route = {
  id: string;
  from_depot_id: string;
  to_station_id: string;
  transit_ticks: number;
  max_shipment_l: number;
  status: string;
};

type OverviewStation = {
  id: string;
  name: string;
  short: string;
  region: string;
  profile: string;
  risk: string;
};

type OverviewDepot = {
  id: string;
  name: string;
  region: string;
};

const DEPOT_LOCATION: Record<string, { region: string; short: string }> = {
  'depot-gazipur': { region: 'Dhaka', short: 'Dhaka' },
  'depot-patiya': { region: 'Chattogram', short: 'Chattogram' },
};

const STATION_SHORT: Record<string, string> = {
  'station-mirpur': 'Mirpur',
  'station-tongi': 'Tongi',
  'station-karnaphuli': 'Karnaphuli',
  'station-coxsbazar': "Cox's Bazar",
};

const REGION_LABEL: Record<string, string> = {
  'region-dhaka': 'Dhaka Division',
  'region-chattogram': 'Chattogram Division',
};

const PROFILE_LABEL: Record<string, string> = {
  urban_high: 'Urban high',
  industrial: 'Industrial',
  highway: 'Highway',
  regional: 'Regional',
};

export const dynamic = 'force-dynamic';

export default async function NetworkPage() {
  let routes: Route[] = [];
  let stations: OverviewStation[] = [];
  let depots: OverviewDepot[] = [];
  try {
    const [r, ov] = await Promise.all([
      apiServer<Route[]>('/api/routes'),
      apiServer<{ stations: OverviewStation[]; depots: OverviewDepot[] }>('/api/overview'),
    ]);
    routes = r;
    stations = ov.stations;
    depots = ov.depots;
  } catch {
    // Render with what we have; individual sections will show "—" if empty.
  }

  const dhakaStations = stations.filter((s) => s.region === 'Dhaka Division' || s.region === 'region-dhaka');
  const chattogramStations = stations.filter(
    (s) => s.region === 'Chattogram Division' || s.region === 'region-chattogram',
  );

  return (
    <>
      <PageHeading
        eyebrow="NETWORK / TOPOLOGY"
        title="Network map"
        description="Depots, supply routes, and receiving stations across both operating regions."
        action={
          <div className="map-legend">
            <span><i className="route-line" /> Available</span>
            <span><i className="route-line disrupted-line" /> Disrupted</span>
          </div>
        }
      />
      <div className="region-row">
        <div className="region-label">
          <span>01</span>
          <div>
            <b>Dhaka Division</b>
            <small>1 depot · {dhakaStations.length} stations</small>
          </div>
        </div>
        <div className="region-label">
          <span>02</span>
          <div>
            <b>Chattogram Division</b>
            <small>1 depot · {chattogramStations.length} stations</small>
          </div>
        </div>
      </div>
      <div className="panel route-panel">
        <SectionTitle
          title="Supply routes"
          detail={`${routes.length} links · travel time shown in simulation ticks`}
        />
        <div className="route-groups">
          {depots.map((d) => {
            const loc = DEPOT_LOCATION[d.id] ?? { region: d.region, short: d.region };
            const sub = routes.filter((r) => r.from_depot_id === d.id);
            return (
              <RouteGroup
                key={d.id}
                depot={d.name}
                location={loc.region}
                routes={sub.map((r) => ({
                  id: r.id,
                  to: STATION_SHORT[r.to_station_id] ?? r.to_station_id,
                  ticks: r.transit_ticks,
                  max: fmtLiters(r.max_shipment_l),
                  status: r.status,
                }))}
              />
            );
          })}
        </div>
      </div>
      <div className="content-grid network-bottom">
        <section className="panel">
          <SectionTitle title="Stations" detail="Live status and regional demand" />
          {stations.map((s) => (
            <div className="network-station" key={s.id}>
              <span className="station-map-dot" />
              <div>
                <StationLink id={s.id}>{s.short}</StationLink>
                <small>
                  {(REGION_LABEL[s.region] ?? s.region).replace(' Division', '')} · {PROFILE_LABEL[s.profile] ?? s.profile}
                </small>
              </div>
              <span className="demand-label">{PROFILE_LABEL[s.profile] ?? s.profile}</span>
              <Tag tone={s.risk === 'HIGH' ? 'HIGH' : s.risk === 'MEDIUM' ? 'amber' : 'green'}>
                {s.risk} RISK
              </Tag>
            </div>
          ))}
        </section>
        <aside className="panel network-insight">
          <div className="insight-star">✳</div>
          <h3>Resilience insight</h3>
          <p>
            Mirpur and Karnaphuli have alternate cross-region routes. Tongi and Cox's Bazar rely on
            a single route, so a disruption there needs operator attention.
          </p>
          <div className="single-route">
            <span>Single-route stations</span>
            <b>Tongi · Cox's Bazar</b>
          </div>
        </aside>
      </div>
    </>
  );
}

type RouteView = { id: string; to: string; ticks: number; max: string; status: string };

function RouteGroup({
  depot,
  location,
  routes: r,
}: {
  depot: string;
  location: string;
  routes: RouteView[];
}) {
  return (
    <div className="route-group">
      <div className="route-depot">
        <span className="depot-icon blue">▤</span>
        <div>
          <b>{depot}</b>
          <small>{location} · source depot</small>
        </div>
      </div>
      {r.length === 0 ? (
        <div className="muted">No routes</div>
      ) : (
        r.map((route) => (
          <div className="route-item" key={route.id}>
            <div className={`route-track ${route.status === 'DISRUPTED' ? 'track-disrupted' : ''}`}>
              <i />
            </div>
            <div className="route-target">
              <b>{route.to}</b>
              <small>
                {route.ticks} ticks · max {route.max}
              </small>
            </div>
            <Tag tone={route.status === 'AVAILABLE' ? 'green' : 'HIGH'}>{route.status}</Tag>
          </div>
        ))
      )}
    </div>
  );
}