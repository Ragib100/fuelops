import { decisions } from '@/lib/data';
import { PageHeading, SectionTitle, Tag } from '@/components/ui';
export default function HistoryPage() {
  return (
    <>
      <PageHeading
        eyebrow="AUDIT / DECISIONS"
        title="Decision history"
        description="A transparent record of operator actions and simulator outcomes."
        action={<button className="button button-secondary">⇩ &nbsp; Export log</button>}
      />
      <div className="history-summary">
        <div>
          <span>Total decisions</span>
          <b>87</b>
          <small>in this simulation run</small>
        </div>
        <div>
          <span>Successful allocations</span>
          <b className="good-text">82</b>
          <small>94.2% fulfillment rate</small>
        </div>
        <div>
          <span>Pending</span>
          <b>4</b>
          <small>currently in transit</small>
        </div>
        <div>
          <span>Operator reviews</span>
          <b>1</b>
          <small>requires follow-up</small>
        </div>
      </div>
      <section className="panel list-panel">
        <SectionTitle
          title="Recent decisions"
          detail="Append-only audit trail · Simulation run 01"
          action={
            <select className="select-control">
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
                <th>ROUTE</th>
                <th>OUTCOME</th>
                <th>SIMULATOR RESPONSE</th>
              </tr>
            </thead>
            <tbody>
              {decisions.map((d) => (
                <tr key={d.id}>
                  <td>
                    <b>{d.id}</b>
                    <small>Tick {d.tick}</small>
                  </td>
                  <td>{d.when}</td>
                  <td>
                    <span className="operator-cell">
                      <i>
                        {d.operator
                          .split(' ')
                          .map((x) => x[0])
                          .join('')}
                      </i>
                      {d.operator}
                    </span>
                  </td>
                  <td>{d.action}</td>
                  <td>{d.route}</td>
                  <td>
                    <Tag
                      tone={
                        d.outcome === 'ARRIVED'
                          ? 'green'
                          : d.outcome === 'REJECTED'
                            ? 'neutral'
                            : 'blue'
                      }
                    >
                      {d.outcome}
                    </Tag>
                  </td>
                  <td>{d.response}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pagination">
          <span>Showing 3 of 87 decisions</span>
          <div>
            <button disabled>← Previous</button>
            <button>Next →</button>
          </div>
        </div>
      </section>
      <div className="audit-note">
        ⌑ &nbsp; Decision records are retained for this simulation run. Simulator response IDs are
        sample values.
      </div>
    </>
  );
}
