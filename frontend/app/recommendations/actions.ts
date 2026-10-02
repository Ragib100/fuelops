'use server';

import { revalidatePath } from 'next/cache';
import { apiServer, type ApiOpts } from '@/lib/api';

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

async function call(path: string, init: ApiOpts = {}): Promise<ActionResult> {
  try {
    const data = await apiServer<{ message?: string }>(path, init);
    revalidatePath('/recommendations');
    revalidatePath('/history');
    revalidatePath('/overview');
    revalidatePath('/');
    return { ok: true, message: data.message ?? 'ok' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'request failed';
    return { ok: false, error: msg };
  }
}

export async function refreshRecommendations(): Promise<ActionResult> {
  return call('/api/recommendations/refresh', { method: 'POST' });
}

export async function approveRecommendation(formData: FormData): Promise<ActionResult> {
  const id = String(formData.get('id') ?? '');
  const operator = String(formData.get('operator') ?? 'operator');
  if (!id) return { ok: false, error: 'missing id' };
  return call(`/api/recommendations/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ operator }),
    headers: { 'content-type': 'application/json' },
  });
}

export async function rejectRecommendation(formData: FormData): Promise<ActionResult> {
  const id = String(formData.get('id') ?? '');
  const operator = String(formData.get('operator') ?? 'operator');
  if (!id) return { ok: false, error: 'missing id' };
  return call(`/api/recommendations/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ operator }),
    headers: { 'content-type': 'application/json' },
  });
}

export async function simulateRecommendation(formData: FormData): Promise<ActionResult> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, error: 'missing id' };
  try {
    const data = await apiServer<{ before: { p_stockout: number }; after: { p_stockout: number } }>(
      `/api/recommendations/${id}/simulate`,
      { method: 'POST' },
    );
    return {
      ok: true,
      message: `p_stockout: ${Math.round(data.before.p_stockout * 100)}% → ${Math.round(data.after.p_stockout * 100)}%`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'simulation failed';
    return { ok: false, error: msg };
  }
}