import { systemEvents } from '@/lib/data';
import { PageHeading, SectionTitle, Tag } from '@/components/ui';
const services = [
  ['Backend API', 'Healthy', '42 ms', '98.7%', 'green'],
  ['Database', 'Healthy', '8 ms', '99.9%', 'green'],
  ['Fuel simulator', 'Degraded', '680 ms', '91.2%', 'amber'],
  ['Decision engine', 'Degraded', 'Timeout', '78.4%', 'amber'],
  ['SSE stream', 'Connected', '—', '99.1%', 'green'],
];
export default function StatusPage() {
  return (
    <>
      <PageHeading
        eyebrow="SYSTEM / OBSERVABILITY"
        title="System status"
        description="Health of platform services, integration signals, and recent system events."
        action={<span className="last-checked">● &nbsp; Updated 12 seconds ago</span>}
      />
      <div className="status-overview">
        <div>
          <span>OVERALL STATUS</span>
          <b className="warning-text">Degraded</b>
          <small>Core operations remain available</small>
        </div>
        <div>
          <span>REQUEST P95 LATENCY</span>
          <b>
            164 <small>ms</small>
          </b>
          <small>Target under 500 ms</small>
        </div>
        <div>
          <span>ERROR RATE</span>
          <b>
            0.4<small>%</small>
          </b>
          <small>Last 5 minutes</small>
        </div>
        <div>
          <span>FALLBACK POLICY</span>
          <b className="warning-text">Active</b>
          <small>Decision engine timeout</small>
        </div>
      </div>
      <section className="panel service-panel">
        <SectionTitle title="Service health" detail="Component checks and recent performance" />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>COMPONENT</th>
                <th>STATUS</th>
                <th>LATENCY</th>
                <th>AVAILABILITY</th>
                <th>DETAIL</th>
              </tr>
            </thead>
            <tbody>
              {services.map(([name, status, latency, avail, tone]) => (
                <tr key={name}>
                  <td>
                    <span className={`service-dot ${tone}`} />
                    <b>{name}</b>
                  </td>
                  <td>
                    <Tag tone={tone}>{status}</Tag>
                  </td>
                  <td>{latency}</td>
                  <td>{avail}</td>
                  <td className="muted">
                    {name === 'Decision engine'
                      ? 'Using threshold-v1 fallback'
                      : name === 'Fuel simulator'
                        ? 'Last good snapshot · tick 42'
                        : 'Checks passing'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel system-event-panel">
        <SectionTitle
          title="Recent system events"
          detail="Integration, fallback, and recovery log"
          action={<button className="subtle-link">View metrics ↗</button>}
        />
        {systemEvents.map((e) => (
          <div className="system-event" key={e.time}>
            <span className={`log-level ${e.level.toLowerCase()}`}>{e.level}</span>
            <span className="log-time">{e.time}</span>
            <b>{e.component}</b>
            <span>{e.message}</span>
            <small>{e.tick}</small>
          </div>
        ))}
      </section>
      <div className="status-footnote">
        ⓘ &nbsp; During dependency failures, the dashboard serves cached last-known-good state.
        Allocation approval remains a human-reviewed action.
      </div>
    </>
  );
}
