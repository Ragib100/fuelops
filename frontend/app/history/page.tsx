import { apiServer } from '@/lib/api';
import { fmtRelativeTime } from '@/lib/format';
import { PageHeading, SectionTitle, Tag } from '@/components/ui';

type Decision = {
  id: number;
  recommendation_id: number | null;
  decided_at: string;
  operator: string;
  action: string;
  allocation_id: number | null;
  outcome: string | null;
  response: string | null;
};

const OUTCOME_TONE: Record<string, string> = {
  ARRIVED: 'green',
  COMPLETED: 'green',
  DELIVERED: 'green',
  IN_TRANSIT: 'blue',
  PENDING: 'amber',
  REJECTED: 'neutral',
  FAILED: 'red',
};

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  let decisions: Decision[] = [];
  try {
    decisions = await apiServer<Decision[]>('/api/decisions?limit=100');
  } catch {
    // ignore
  }

  const total = decisions.length;
  const successful = decisions.filter((d) => d.outcome === 'ARRIVED' || d.outcome === 'COMPLETED' || d.outcome === 'DELIVERED').length;
  const pending = decisions.filter((d) => d.outcome === 'PENDING' || d.outcome === 'IN_TRANSIT').length;
  const rejected = decisions.filter((d) => d.action === 'reject').length;
  const fulfillment = total > 0 ? Math.round((100 * successful) / Math.max(1, total - rejected)) : 0;

  const operatorInitials = (name: string) =>
    name
      .split(/\s+/)
      .map((x) => x[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase();

  return (
    <>
      <PageHeading
        eyebrow="AUDIT / DECISIONS"
        title="Decision history"
        description="A transparent record of operator actions and simulator outcomes."
        action={
          <a className="button button-secondary" href="/api/decisions?limit=500" target="_blank" rel="noreferrer">
            ⇩ &nbsp; Export log
          </a>
        }
      />
      <div className="history-summary">
        <div>
          <span>Total decisions</span>
          <b>{total}</b>
          <small>in this simulation run</small>
        </div>
        <div>
          <span>Successful allocations</span>
          <b className="good-text">{successful}</b>
          <small>{fulfillment}% fulfillment rate</small>
        </div>
        <div>
          <span>Pending</span>
          <b>{pending}</b>
          <small>currently in transit</small>
        </div>
        <div>
          <span>Operator reviews</span>
          <b>{rejected}</b>
          <small>rejected actions</small>
        </div>
      </div>
      <section className="panel list-panel">
        <SectionTitle
          title="Recent decisions"
          detail={`Append-only audit trail · Simulation run · ${total} record${total === 1 ? '' : 's'}`}
          action={
            <select className="select-control" disabled>
              <option>All actions</option>
              <option>Allocations</option>
              <option>Rejected</option>
            </select>
          }
        />
        <div className="table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>DECISION</th>
                <th>SIM TIME</th>
                <th>OPERATOR</th>
                <th>ACTION</th>
                <th>OUTCOME</th>
                <th>SIMULATOR RESPONSE</th>
              </tr>
            </thead>
            <tbody>
              {decisions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No decisions yet. Approve a recommendation on the Recommendations page to populate this audit log.
                  </td>
                </tr>
              ) : (
                decisions.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <b>#{d.id}</b>
                      {d.recommendation_id != null ? <small> rec #{d.recommendation_id}</small> : null}
                    </td>
                    <td>{fmtRelativeTime(d.decided_at)}</td>
                    <td>
                      <span className="operator-cell">
                        <i>{operatorInitials(d.operator)}</i>
                        {d.operator}
                      </span>
                    </td>
                    <td>{d.action}</td>
                    <td>
                      <Tag tone={OUTCOME_TONE[d.outcome ?? ''] ?? 'neutral'}>
                        {d.outcome ?? '—'}
                      </Tag>
                    </td>
                    <td>{d.response ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="pagination">
          <span>
            Showing {decisions.length === 0 ? 0 : 1}–{decisions.length} of {total}
          </span>
        </div>
      </section>
      <div className="audit-note">
        ⌑ &nbsp; Decision records are retained in Postgres. Simulator response IDs reflect the real allocation id from the simulator.
      </div>
    </>
  );
}