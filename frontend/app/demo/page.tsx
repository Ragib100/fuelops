'use client';
import { useState } from 'react';
import { ActionButton } from '@/components/actions';
import { PageHeading, SectionTitle, Tag } from '@/components/ui';
export default function DemoPage() {
  const [sim, setSim] = useState('PAUSED');
  const [fault, setFault] = useState('None');
  const [event, setEvent] = useState('Demand spike');
  return (
    <>
      <PageHeading
        eyebrow="SIMULATOR / OPERATOR TOOLS"
        title="Demo controls"
        description="Rehearse simulator events and dependency failures using the demo environment."
        action={<Tag tone="amber">RESTRICTED · DEMO ONLY</Tag>}
      />
      <div className="demo-warning">
        ⚠ &nbsp;{' '}
        <span>
          <b>Sample controls only</b> These actions are not connected to a simulator. Use a
          protected backend proxy before enabling real simulator administration.
        </span>
      </div>
      <div className="content-grid demo-grid">
        <section className="panel demo-panel">
          <SectionTitle title="Simulation controls" detail="Current simulated world" />
          <div className="sim-state-row">
            <span>
              <i className="pulse" /> Simulation status
            </span>
            <Tag tone={sim === 'RUNNING' ? 'green' : 'neutral'}>{sim}</Tag>
          </div>
          <div className="sim-state-row">
            <span>Current tick</span>
            <b>042</b>
          </div>
          <div className="sim-state-row">
            <span>Simulated time</span>
            <b>10:45 AM</b>
          </div>
          <div className="demo-button-row">
            <ActionButton
              label="← Step back"
              variant="secondary"
              detail="Demo only: step controls are not connected."
            />
            <ActionButton
              label="Step simulation →"
              variant="primary"
              detail="Demo only: step controls are not connected."
            />
          </div>
          <div className="demo-button-row">
            <button
              className="button button-secondary"
              onClick={() => setSim(sim === 'RUNNING' ? 'PAUSED' : 'RUNNING')}
            >
              {sim === 'RUNNING' ? 'Ⅱ Pause' : '▶ Run simulation'}
            </button>
            <ActionButton
              label="Reset run"
              variant="quiet"
              detail="Reset is disabled until a simulator admin API is connected."
            />
          </div>
        </section>
        <section className="panel demo-panel">
          <SectionTitle title="Inject a crisis event" detail="Simulator domain event" />
          <label className="field-label">
            EVENT TYPE
            <select value={event} onChange={(e) => setEvent(e.target.value)}>
              <option>Demand spike</option>
              <option>Route disruption</option>
              <option>Shipment delay</option>
              <option>Depot constraint</option>
              <option>Station outage</option>
            </select>
          </label>
          <label className="field-label">
            AFFECTED AREA
            <select>
              <option>All regions</option>
              <option>Dhaka Division</option>
              <option>Chattogram Division</option>
            </select>
          </label>
          <label className="field-label">
            DURATION
            <select>
              <option>3 ticks</option>
              <option>5 ticks</option>
              <option>Until manually resolved</option>
            </select>
          </label>
          <ActionButton
            label="⚡ Inject event"
            variant="primary"
            detail={`Demo only: ${event} injection is not connected to an API.`}
          />
        </section>
        <section className="panel demo-panel">
          <SectionTitle
            title="Inject a dependency fault"
            detail="Test resilience and cached state"
          />
          <label className="field-label">
            FAULT TYPE
            <select value={fault} onChange={(e) => setFault(e.target.value)}>
              <option>None</option>
              <option>Unavailable</option>
              <option>Latency</option>
              <option>Error rate</option>
              <option>Stale data</option>
              <option>Stream disconnect</option>
            </select>
          </label>
          <p className="field-help">
            Fault injection is available on the simulator’s admin API. Keep it restricted to the
            demo environment.
          </p>
          <div className="demo-button-row">
            <ActionButton
              label="Apply fault"
              variant="primary"
              detail={
                fault === 'None'
                  ? 'Choose a fault type first.'
                  : `Demo only: ${fault} fault is not connected to an API.`
              }
            />
            <ActionButton
              label="Clear all faults"
              variant="secondary"
              detail="Demo only: fault clearing is not connected to an API."
            />
          </div>
        </section>
      </div>
      <div className="demo-audit">
        <b>ⓘ Demo safety</b>
        <span>
          All actions here are UI previews. No requests are sent, no events are injected, and no
          simulation state changes. Connect admin actions through an authenticated backend proxy.
        </span>
      </div>
    </>
  );
}
