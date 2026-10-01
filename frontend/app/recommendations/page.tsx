import { apiServer } from '@/lib/api';
import { RecommendationsClient } from './client';

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

export const dynamic = 'force-dynamic';

export default async function RecommendationsPage() {
  let recs: Recommendation[] = [];
  try {
    recs = await apiServer<Recommendation[]>('/api/recommendations');
  } catch {
    // empty
  }

  // Compute summary stats
  const pending = recs.length;
  const needsReview = recs.filter((r) => r.needs_review).length;
  const fallbackActive = recs.some((r) => r.policy.toLowerCase().includes('fallback'));
  const policyName = fallbackActive
    ? recs.find((r) => r.policy.toLowerCase().includes('fallback'))?.policy ?? 'fallback policy'
    : (recs[0]?.policy ?? 'priority policy');

  return (
    <RecommendationsClient
      recs={recs}
      summary={{
        pending,
        needsReview,
        policyName,
        fallbackActive,
      }}
    />
  );
}