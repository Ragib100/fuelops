import { routes, stations } from '@/lib/data';
import { PageHeading, SectionTitle, Tag, StationLink } from '@/components/ui';
export default function NetworkPage() {
  return (
    <>
      <PageHeading
        eyebrow="NETWORK / TOPOLOGY"
        title="Network map"
        description="Depots, supply routes, and receiving stations across both operating regions."
        action={
          <div className="map-legend">
            <span>
              <i className="route-line" /> Available
            </span>
            <span>
              <i className="route-line disrupted-line" /> Disrupted
            </span>
          </div>
        }
      />
      <div className="region-row">
        <div className="region-label">
          <span>01</span>
          <div>
            <b>Dhaka Division</b>
            <small>1 depot · 2 stations</small>
          </div>
        </div>
        <div className="region-label">
          <span>02</span>
          <div>
            <b>Chattogram Division</b>
            <small>1 depot · 2 stations</small>
          </div>
        </div>
      </div>
      <div className="panel route-panel">
        <SectionTitle
          title="Supply routes"
          detail="6 links · travel time shown in simulation ticks"
        />
        <div className="route-groups">
          <RouteGroup
            depot="Gazipur Depot"
            location="Dhaka"
            routes={routes.filter((r) => r.from === 'Gazipur Depot')}
          />
          <RouteGroup
            depot="Patiya Depot"
            location="Chattogram"
            routes={routes.filter((r) => r.from === 'Patiya Depot')}
          />
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
                  {s.region} · {s.profile}
                </small>
              </div>
              <span className="demand-label">{s.demand}</span>
              <Tag tone={s.risk}>{s.risk} RISK</Tag>
            </div>
          ))}
        </section>
        <aside className="panel network-insight">
          <div className="insight-star">✳</div>
          <h3>Resilience insight</h3>
          <p>
            Mirpur and Karnaphuli have alternate cross-region routes. Tongi and Cox’s Bazar rely on
            a single route, so a disruption there needs operator attention.
          </p>
          <div className="single-route">
            <span>Single-route stations</span>
            <b>Tongi · Cox’s Bazar</b>
          </div>
        </aside>
      </div>
    </>
  );
}
function RouteGroup({
  depot,
  location,
  routes: r,
}: {
  depot: string;
  location: string;
  routes: typeof routes;
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
      {r.map((route) => (
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
      ))}
    </div>
  );
}
