'use client';
import { useState } from 'react';
import { recommendations } from '@/lib/data';
import { ActionButton, FilterButtons } from '@/components/actions';
import { PageHeading, SectionTitle, Tag } from '@/components/ui';
export default function RecommendationsPage() {
  const [inspect, setInspect] = useState<string | null>(null);
  return (
    <>
      <PageHeading
        eyebrow="DECISION SUPPORT"
        title="Recommendations"
        description="Inspectable allocation options ranked by shortage urgency."
        action={
          <button className="button button-primary">✳ &nbsp; Generate recommendations</button>
        }
      />
      <div className="recommendation-summary">
        <div>
          <span>Pending review</span>
          <b>2</b>
        </div>
        <div>
          <span>Estimated risk reduction</span>
          <b className="good-text">53%</b>
        </div>
        <div>
          <span>Last generated</span>
          <b>Tick 42 · just now</b>
        </div>
        <span className="policy-indicator">
          <i /> Priority policy active
        </span>
      </div>
      <div className="recommendation-list">
        {recommendations.map((r, i) => (
          <article className={`panel rec-card ${i === 0 ? 'rec-critical' : ''}`} key={r.id}>
            <div className="rec-card-head">
              <div className="rec-station">
                <span className={`fuel-icon ${r.fuel.toLowerCase()}`}>
                  {r.fuel === 'Diesel' ? 'D' : r.fuel === 'Petrol' ? 'P' : 'O'}
                </span>
                <div>
                  <div className="rec-title-line">
                    <h2>{r.station}</h2>
                    <Tag tone={r.risk}>{r.risk} RISK</Tag>
                  </div>
                  <span>
                    {r.fuel} <i>·</i> {r.id} <i>·</i> {r.ttf} to stockout
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
            {r.id === recommendations[1].id && (
              <div className="fallback-note">
                ⚡ &nbsp; FALLBACK POLICY{' '}
                <span>Decision engine unavailable · threshold policy used</span>
              </div>
            )}
            {r.confidence < 0.75 && (
              <div className="review-note">
                ◎ &nbsp; Human review requested <span>Confidence below 75% threshold.</span>
              </div>
            )}
            <div className="rec-actions">
              <button
                className="button button-secondary"
                onClick={() => setInspect(inspect === r.id ? null : r.id)}
              >
                ⌕ &nbsp; {inspect === r.id ? 'Hide details' : 'Inspect reasoning'}
              </button>
              <ActionButton
                label="Simulate"
                variant="secondary"
                detail={`What-if simulated: ${r.impact}. Sample result only.`}
              />
              <span className="action-spacer" />
              <ActionButton
                label="Reject"
                variant="quiet"
                detail="Recommendation rejected in local demo."
              />
              <ActionButton
                label="Approve allocation"
                variant="primary"
                detail="Approval preview only. No simulator API is connected."
              />
            </div>
            {inspect === r.id && (
              <div className="inspect-details">
                <div>
                  <b>Signals used</b>
                  {r.signals.map((s) => (
                    <span key={s}>• {s}</span>
                  ))}
                </div>
                <div>
                  <b>Route and arrival</b>
                  <span>{r.route}</span>
                  <span>ETA {r.eta}</span>
                </div>
                <div>
                  <b>Alternatives</b>
                  {r.alternatives.map((s) => (
                    <span key={s}>• {s}</span>
                  ))}
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
      <div className="human-review-foot">
        Human review is required before any allocation is submitted. This page uses sample data
        only.
      </div>
    </>
  );
}
