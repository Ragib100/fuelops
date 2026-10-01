import { apiServer } from '@/lib/api';
import { AlertsClient } from './client';

type Alert = {
  id: string;
  severity: string;
  kind: string;
  title: string;
  detail: string;
  station: string | null;
  time: string;
  color: string;
  tick: number | null;
};

export const dynamic = 'force-dynamic';

export default async function AlertsPage() {
  let alerts: Alert[] = [];
  try {
    alerts = await apiServer<Alert[]>('/api/alerts');
  } catch {
    // ignore — empty list
  }

  const counts = {
    critical: alerts.filter((a) => a.severity === 'Critical').length,
    warning: alerts.filter((a) => a.severity === 'Warning').length,
    info: alerts.filter((a) => a.severity === 'Info').length,
    total: alerts.length,
  };

  return <AlertsClient initial={alerts} counts={counts} />;
}