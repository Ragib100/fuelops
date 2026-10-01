'use client';
import { useState } from 'react';
export function ActionButton({
  label,
  variant = 'secondary',
  detail,
}: {
  label: string;
  variant?: string;
  detail?: string;
}) {
  const [message, setMessage] = useState('');
  return (
    <>
      <button
        className={`button button-${variant}`}
        onClick={() => setMessage(detail || `${label} action recorded in this demo.`)}
      >
        {label}
      </button>
      {message && <span className="action-feedback">{message}</span>}
    </>
  );
}
export function FilterButtons({ options }: { options: string[] }) {
  const [active, setActive] = useState(options[0]);
  return (
    <div className="filter-group">
      {options.map((o) => (
        <button
          key={o}
          className={active === o ? 'filter-active' : ''}
          onClick={() => setActive(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
