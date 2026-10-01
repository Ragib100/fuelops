import type { Metadata } from 'next';
import './globals.css';
import { Shell } from '@/components/shell';
import { apiServer } from '@/lib/api';

export const metadata: Metadata = {
  title: 'FuelOps | Supply Intelligence',
  description: 'Simulated fuel supply operations control room',
};

// Re-fetch every 5s while the page is open so the topbar tick / banner stay fresh.
export const revalidate = 5;

type Status = {
  overall: string;
  fallback_active: boolean;
  stale: boolean;
  services: Array<{ name: string; status: string }>;
};

type Alert = { id: string };

async function loadShellData(): Promise<{
  tick: number | null;
  simStatus: string;
  degraded: boolean;
  stale: boolean;
  alertCount: number;
}> {
  // Best-effort: if the API is down, return placeholders so the page still renders.
  const fallback = {
    tick: null,
    simStatus: 'UNKNOWN',
    degraded: false,
    stale: false,
    alertCount: 0,
  };
  try {
    const [status, alerts, overview] = await Promise.all([
      apiServer<Status>('/api/system/status'),
      apiServer<Alert[]>('/api/alerts'),
      apiServer<{ tick: number | null; status: string | null }>('/api/overview'),
    ]);
    const sim = status.services.find((s) => s.name === 'Fuel simulator');
    return {
      tick: overview.tick ?? null,
      simStatus: overview.status ?? 'UNKNOWN',
      degraded: status.fallback_active || sim?.status != null && sim.status !== 'Healthy',
      stale: status.stale,
      alertCount: alerts.length,
    };
  } catch {
    return fallback;
  }
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const data = await loadShellData();
  return (
    <html lang="en">
      <body>
        <Shell
          tick={data.tick}
          simStatus={data.simStatus}
          degraded={data.degraded}
          stale={data.stale}
          alertCount={data.alertCount}
        >
          {children}
        </Shell>
      </body>
    </html>
  );
}