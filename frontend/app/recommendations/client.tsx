'use client';
import { useState, useTransition } from 'react';
import { PageHeading, Tag } from '@/components/ui';
import {
  approveRecommendation,
  refreshRecommendations,
  rejectRecommendation,
  simulateRecommendation,
} from './actions';

type Recommendation = {
  id: number;
  created_tick: number | null;
  station: string;
  stationId: string;
  fuel: string;
  risk: string;
  ttf: string;
  quantity: string;
  source: string;
  route: string;
  eta: string;
  confidence: number;
  impact: string;
  policy: string;
  why: string;
  signals: string[];
  alternatives: string[];
  needs_review: boolean;
};

type Summary = {
  pending: number;
  needsReview: number;
  policyName: string;
  fallbackActive: boolean;
};

const FUEL_LETTER: Record<string, string> = { Diesel: 'D', Petrol: 'P', Octane: 'O' };

export function RecommendationsClient({
  recs,
  summary,
}: {
  recs: Recommendation[];
  summary: Summary;
}) {
  const [inspect, setInspect] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const runApprove = (id: number) => {
    const fd = new FormData();
    fd.set('id', String(id));
    fd.set('operator', 'operator');
    startTransition(async () => {
      const r = await approveRecommendation(fd);
      setFeedback(r.ok ? { kind: 'ok', message: r.message } : { kind: 'err', message: r.error });
    });
  };

  const runReject = (id: number) => {
    const fd = new FormData();
    fd.set('id', String(id));
    startTransition(async () => {
      const r = await rejectRecommendation(fd);
      setFeedback(r.ok ? { kind: 'ok', message: r.message } : { kind: 'err', message: r.error });
    });
  };

  const runSimulate = (id: number) => {
    const fd = new FormData();
    fd.set('id', String(id));
    startTransition(async () => {
      const r = await simulateRecommendation(fd);
      setFeedback(r.ok ? { kind: 'ok', message: r.message } : { kind: 'err', message: r.error });
    });
  };

  const runRefresh = () => {
    startTransition(async () => {
      const r = await refreshRecommendations();
      setFeedback(r.ok ? { kind: 'ok', message: r.message } : { kind: 'err', message: r.error });
    });
  };

  return (
    <>
      <PageHeading
        eyebrow="DECISION SUPPORT"
        title="Recommendations"
        description="Inspectable allocation options ranked by shortage urgency."
        action={
          <button
            className="button button-primary"
            onClick={runRefresh}
            disabled={isPending}
            type="button"
          >
            ✳ &nbsp; {isPending ? 'Generating…' : 'Generate recommendations'}
          </button>
        }
      />
      {feedback ? (
        <div className={feedback.kind === 'ok' ? 'demo-warning ok-banner' : 'demo-warning'}>
          {feedback.kind === 'ok' ? '✓' : '⚠'} &nbsp;{' '}
          <span>
            <b>{feedback.kind === 'ok' ? 'OK' : 'Error'}.</b> {feedback.message}
          </span>
        </div>
      ) : null}
      <div className="recommendation-summary">
        <div>
          <span>Pending review</span>
          <b>{summary.pending}</b>
        </div>
        <div>
          <span>Need human review</span>
          <b>{summary.needsReview}</b>
        </div>
        <div>
          <span>Policy</span>
          <b>{summary.policyName}</b>
        </div>
        <span className="policy-indicator">
          <i /> {summary.fallbackActive ? 'Fallback policy active' : 'Primary policy active'}
        </span>
      </div>
      <div className="recommendation-list">
        {recs.length === 0 ? (
          <div className="panel">
            <div className="muted">
              No recommendations yet. Click <b>Generate recommendations</b> to run the policy engine
              against the latest snapshot.
            </div>
          </div>
        ) : (
          recs.map((r, i) => (
            <article className={`panel rec-card ${i === 0 ? 'rec-critical' : ''}`} key={r.id}>
              <div className="rec-card-head">
                <div className="rec-station">
                  <span className={`fuel-icon ${r.fuel.toLowerCase()}`}>
                    {FUEL_LETTER[r.fuel] ?? r.fuel[0]}
                  </span>
                  <div>
                    <div className="rec-title-line">
                      <h2>{r.station}</h2>
                      <Tag tone={r.risk}>{r.risk} RISK</Tag>
                    </div>
                    <span>
                      {r.fuel} <i>·</i> #{r.id} <i>·</i> {r.ttf} to stockout
                    </span>
                  </div>
                </div>
                <span className="confidence">
                  <b>{Math.round(r.confidence * 100)}%</b>
                  <small>confidence</small>
                </span>
              </div>
              <div className="rec-metrics">
                <div>
                  <span>RECOMMENDED ALLOCATION</span>
                  <b>{r.quantity}</b>
                </div>
                <div>
                  <span>SOURCE DEPOT</span>
                  <b>{r.source}</b>
                </div>
                <div>
                  <span>EXPECTED IMPACT</span>
                  <b className="good-text">{r.impact}</b>
                </div>
              </div>
              <p className="rec-explanation">
                <span>✳</span>
                {r.why}
              </p>
              {summary.fallbackActive && r.policy.toLowerCase().includes('fallback') ? (
                <div className="fallback-note">
                  ⚡ &nbsp; FALLBACK POLICY{' '}
                  <span>Decision engine unavailable · threshold policy used</span>
                </div>
              ) : null}
              {r.needs_review ? (
                <div className="review-note">
                  ◎ &nbsp; Human review requested <span>Confidence below threshold.</span>
                </div>
              ) : null}
              <div className="rec-actions">
                <button
                  className="button button-secondary"
                  onClick={() => setInspect(inspect === r.id ? null : r.id)}
                  type="button"
                  disabled={isPending}
                >
                  ⌕ &nbsp; {inspect === r.id ? 'Hide details' : 'Inspect reasoning'}
                </button>
                <button
                  className="button button-secondary"
                  onClick={() => runSimulate(r.id)}
                  type="button"
                  disabled={isPending}
                >
                  ⚙ &nbsp; Simulate
                </button>
                <span className="action-spacer" />
                <button
                  className="button button-quiet"
                  onClick={() => runReject(r.id)}
                  type="button"
                  disabled={isPending}
                >
                  ✕ &nbsp; Reject
                </button>
                <button
                  className="button button-primary"
                  onClick={() => runApprove(r.id)}
                  type="button"
                  disabled={isPending}
                >
                  ✓ &nbsp; Approve allocation
                </button>
              </div>
              {inspect === r.id ? (
                <div className="inspect-details">
                  <div>
                    <b>Signals used</b>
                    {r.signals.length === 0 ? (
                      <span className="muted">None</span>
                    ) : (
                      r.signals.map((s) => <span key={s}>• {s}</span>)
                    )}
                  </div>
                  <div>
                    <b>Route and arrival</b>
                    <span>{r.route}</span>
                    <span>ETA {r.eta}</span>
                  </div>
                  <div>
                    <b>Alternatives</b>
                    {r.alternatives.length === 0 ? (
                      <span className="muted">No alternatives computed.</span>
                    ) : (
                      r.alternatives.map((s) => <span key={s}>• {s}</span>)
                    )}
                  </div>
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>
      <div className="human-review-foot">
        Human review is required before any allocation is submitted. Approvals POST to{' '}
        <code>/api/recommendations/{'{id}'}/approve</code> on the backend, which calls the simulator.
      </div>
    </>
  );
}