import type { LogEntry, RequestSummary, Stats, Payload, HotConfig, SaveConfigResult } from './types';
import { useAuthStore } from './stores/auth';
import { getActivePinia } from 'pinia';

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem('cursor2api_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: getAuthHeader() });
  if (res.status === 401) {
    const pinia = getActivePinia();
    if (pinia) useAuthStore(pinia).logout();
    throw new Error('HTTP 401');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function fetchLogs(params?: { requestId?: string; since?: number }): Promise<LogEntry[]> {
  const q = new URLSearchParams();
  if (params?.requestId) q.set('requestId', params.requestId);
  if (params?.since != null) q.set('since', String(params.since));
  const qs = q.toString() ? '?' + q.toString() : '';
  return apiFetch<LogEntry[]>(`/api/logs${qs}`);
}

export function fetchRequests(limit = 50): Promise<RequestSummary[]> {
  return apiFetch<RequestSummary[]>(`/api/requests?limit=${limit}`);
}

export function fetchStats(since?: number): Promise<Stats> {
  const qs = since !== undefined ? `?since=${since}` : '';
  return apiFetch<Stats>(`/api/vue/stats${qs}`);
}

export function fetchPayload(requestId: string): Promise<Payload> {
  return apiFetch<Payload>(`/api/payload/${requestId}`);
}

export async function clearLogs(): Promise<void> {
  const res = await fetch('/api/logs/clear', {
    method: 'POST',
    headers: getAuthHeader(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export function fetchConfig(): Promise<HotConfig> {
  return apiFetch<HotConfig>('/api/config');
}

export async function saveConfig(cfg: Partial<HotConfig>): Promise<SaveConfigResult> {
  const res = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify(cfg),
  });
  if (res.status === 401) {
    const pinia = getActivePinia();
    if (pinia) useAuthStore(pinia).logout();
    throw new Error('HTTP 401');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<SaveConfigResult>;
}

export interface RequestsPage {
  summaries: RequestSummary[];
  hasMore: boolean;
  total: number;
  statusCounts: Record<string, number>;
}

export interface RequestsFilter {
  limit?: number;
  before?: number;
  status?: string;
  keyword?: string;
  since?: number;
}

export function fetchMoreRequests(filter: RequestsFilter = {}): Promise<RequestsPage> {
  const q = new URLSearchParams({ limit: String(filter.limit ?? 50) });
  if (filter.before !== undefined) q.set('before', String(filter.before));
  if (filter.since !== undefined) q.set('since', String(filter.since));
  if (filter.status) q.set('status', filter.status);
  if (filter.keyword) q.set('keyword', filter.keyword);
  return apiFetch<RequestsPage>(`/api/requests/more?${q.toString()}`);
}

export function createSSEConnection(onMessage: (event: string, data: unknown) => void): EventSource {
  const token = localStorage.getItem('cursor2api_token');
  const url = token ? `/api/logs/stream?token=${encodeURIComponent(token)}` : '/api/logs/stream';
  const es = new EventSource(url);
  es.onmessage = (e) => {
    try { onMessage('message', JSON.parse(e.data)); } catch { /* ignore */ }
  };
  const events = ['log', 'summary', 'stats'];
  for (const ev of events) {
    es.addEventListener(ev, (e) => {
      try { onMessage(ev, JSON.parse((e as MessageEvent).data)); } catch { /* ignore */ }
    });
  }
  return es;
}
