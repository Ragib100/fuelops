import { apiServer } from '@/lib/api';
import { fmtPercent, fmtRelativeTime } from '@/lib/format';
import { PageHeading, SectionTitle, Tag } from '@/components/ui';

type ServiceHealth = {
  name: string;
  status: string;
  latency_ms: number | null;
  detail: string | null;
};

type SystemEvent = {
  id: number;
  at: string;
  component: string;
  level: string;
  message: string;
};

type SystemStatus = {
  overall: string;
  services: ServiceHealth[];
  p95_ms: number;
  error_rate_pct: number;
  fallback_active: boolean;
  stale: boolean;
  recent_events: SystemEvent[];
  as_of: string;
};

const STATUS_TONE: Record<string, string> = {
  Healthy: 'green',
  Connected: 'green',
  Polling: 'green',
  Degraded: 'amber',
  Down: 'red',
  Disconnected: 'red',
  Error: 'red',
};

function toneFor(status: string): string {
  return STATUS_TONE[status] ?? 'neutral';
}

export default async function StatusPage() {
  let data: SystemStatus | null = null;
  let errorMsg: string | null = null;
  try {
    data = await apiServer<SystemStatus>('/api/system/status');
  } catch (err: unknown) {
    errorMsg = err instanceof Error ? err.message : 'Failed to load system status';
  }

  return (
    <>
      <PageHeading
        eyebrow="SYSTEM / OBSERVABILITY"
        title="System status"
        description="Health of platform services, integration signals, and recent system events."
        action={
          <span className="last-checked">
            ● &nbsp; Updated {data ? fmtRelativeTime(data.as_of) : 'just now'}
          </span>
        }
      />
      {errorMsg ? (
        <div className="demo-warning">
          ⚠ &nbsp; <span>
            <b>Cannot reach backend API.</b> {errorMsg}. Check that the API is running
            and <code>BACKEND_URL</code> is set in <code>frontend/.env.local</code>.
          </span>
        </div>
      ) : null}

      <div className="status-overview">
        <div>
          <span>OVERALL STATUS</span>
          <b className={data && data.overall !== 'Healthy' ? 'warning-text' : ''}>
            {data?.overall ?? '—'}
          </b>
          <small>
            {data?.stale
              ? 'Cached snapshot · real-time updates paused'
              : 'Core operations remain available'}
          </small>
        </div>
        <div>
          <span>REQUEST P95 LATENCY</span>
          <b>
            {data?.p95_ms ?? '—'} <small>ms</small>
          </b>
          <small>Target under 500 ms</small>
        </div>
        <div>
          <span>ERROR RATE</span>
          <b>
            {data?.error_rate_pct ?? '—'}
            <small>%</small>
          </b>
          <small>Last 5 minutes</small>
        </div>
        <div>
          <span>FALLBACK POLICY</span>
          <b className={data?.fallback_active ? 'warning-text' : ''}>
            {data?.fallback_active ? 'Active' : 'Inactive'}
          </b>
          <small>{data?.fallback_active ? 'Threshold-v1 in use' : 'Primary engine healthy'}</small>
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
                <th>DETAIL</th>
              </tr>
            </thead>
            <tbody>
              {(data?.services ?? []).map((s) => {
                const tone = toneFor(s.status);
                return (
                  <tr key={s.name}>
                    <td>
                      <span className={`service-dot ${tone}`} />
                      <b>{s.name}</b>
                    </td>
                    <td>
                      <Tag tone={tone}>{s.status}</Tag>
                    </td>
                    <td>{s.latency_ms != null ? `${s.latency_ms} ms` : '—'}</td>
                    <td className="muted">{s.detail ?? '—'}</td>
                  </tr>
                );
              })}
              {!data || data.services.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    No services reported.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel system-event-panel">
        <SectionTitle
          title="Recent system events"
          detail="Integration, fallback, and recovery log"
          action={
            <a className="subtle-link" href="/metrics" target="_blank" rel="noreferrer">
              View metrics ↗
            </a>
          }
        />
        {data?.recent_events?.length ? (
          data.recent_events.map((e) => (
            <div className="system-event" key={e.id}>
              <span className={`log-level ${e.level.toLowerCase()}`}>{e.level}</span>
              <span className="log-time">{fmtRelativeTime(e.at)}</span>
              <b>{e.component}</b>
              <span>{e.message}</span>
            </div>
          ))
        ) : (
          <div className="muted">No recent events.</div>
        )}
      </section>

      <div className="status-footnote">
        ⓘ &nbsp; During dependency failures, the dashboard serves cached last-known-good state.
        Allocation approval remains a human-reviewed action.
      </div>
    </>
  );
}