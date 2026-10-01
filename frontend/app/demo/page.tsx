import { apiServer } from '@/lib/api';
import { DemoClient } from './client';

type OverviewResponse = {
  tick: number | null;
  sim_time: string | null;
  status: string | null;
};

type ServiceHealth = { name: string; status: string };

type SystemStatus = {
  services: ServiceHealth[];
  stale: boolean;
};

export const dynamic = 'force-dynamic';

export default async function DemoPage() {
  let overview: OverviewResponse | null = null;
  let status: SystemStatus | null = null;
  try {
    [overview, status] = await Promise.all([
      apiServer<OverviewResponse>('/api/overview'),
      apiServer<SystemStatus>('/api/system/status'),
    ]);
  } catch {
    // ignore
  }

  return (
    <DemoClient
      initialStatus={overview?.status ?? 'UNKNOWN'}
      initialTick={overview?.tick ?? null}
      simulatorService={status?.services.find((s) => s.name === 'Fuel simulator') ?? null}
      stale={status?.stale ?? false}
    />
  );
}