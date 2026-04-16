import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import type { LogEntry, RequestSummary, Payload } from '../types';
import { fetchRequests, fetchLogs, fetchPayload, clearLogs, fetchMoreRequests } from '../api';
import type { RequestsFilter } from '../api';
import { useStatsStore } from './stats';

export const useLogsStore = defineStore('logs', () => {
  const reqs = ref<RequestSummary[]>([]);
  const curLogs = ref<LogEntry[]>([]);      // 当前选中请求的日志
  const globalLogs = ref<LogEntry[]>([]);   // 全局实时日志流（未选中时显示）
  const curRequestId = ref<string | null>(null);
  const payload = ref<Payload | null>(null);
  const hasMore = ref(false);
  const loadingMore = ref(false);
  const total = ref(0);
  const statusCounts = ref<Record<string, number>>({ all: 0, success: 0, degraded: 0, error: 0, processing: 0, intercepted: 0 });

  const search = ref('');
  const statusFilter = ref<'all' | 'success' | 'degraded' | 'error' | 'processing' | 'intercepted'>('all');
  const timeFilter = ref<'all' | '1h' | '6h' | 'today' | '2d' | '7d' | '30d'>('all');
  const autoFollow = ref(false);
  const autoFollowTriggered = ref(false);

  function getTimeCutoff(): number {
    if (timeFilter.value === 'all') return 0;
    const now = Date.now();
    if (timeFilter.value === 'today') {
      const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
    }
    const map: Record<string, number> = { '1h': 1/24, '6h': 6/24, '2d': 2, '7d': 7, '30d': 30 };
    return now - (map[timeFilter.value] ?? 0) * 86400000;
  }

  /** 构建当前过滤条件（可附加额外参数） */
  function buildFilter(extra: Partial<RequestsFilter> = {}): RequestsFilter {
    const filter: RequestsFilter = { limit: 50, ...extra };
    if (statusFilter.value !== 'all') filter.status = statusFilter.value;
    if (search.value.trim()) filter.keyword = search.value.trim();
    const cutoff = getTimeCutoff();
    if (cutoff > 0) filter.since = cutoff;
    return filter;
  }

  // 后端已过滤，filteredReqs 直接透传 reqs（无需前端重复过滤）
  const filteredReqs = computed(() => reqs.value);

  // 当前显示的日志：选中请求时显示该请求日志，否则显示全局流最后 200 条
  const displayLogs = computed(() =>
    curRequestId.value ? curLogs.value : globalLogs.value.slice(-200)
  );

  /** 重置列表并从第一页重新加载（过滤条件变化时调用） */
  async function resetAndLoad() {
    reqs.value = [];
    hasMore.value = false;
    total.value = 0;
    await loadRequests();
  }

  async function loadRequests() {
    try {
      const page = await fetchMoreRequests(buildFilter());
      reqs.value = page.summaries;
      hasMore.value = page.hasMore;
      total.value = page.total;
      if (page.statusCounts) statusCounts.value = page.statusCounts;
    } catch {
      // 降级到原有接口
      try { reqs.value = await fetchRequests(100); } catch { /* ignore */ }
    }
    // 加载历史全局日志（最近 200 条），填充实时流初始内容
    try {
      const logs = await fetchLogs();
      globalLogs.value = logs.slice(-200);
    } catch { /* ignore */ }
  }

  async function loadMoreRequests() {
    if (loadingMore.value || !hasMore.value) return;
    loadingMore.value = true;
    try {
      const last = reqs.value[reqs.value.length - 1];
      const page = await fetchMoreRequests(buildFilter({ before: last?.startTime }));
      reqs.value.push(...page.summaries);
      hasMore.value = page.hasMore;
      total.value = page.total;
    } catch { /* ignore */ } finally {
      loadingMore.value = false;
    }
  }

  // 状态/时间过滤：点击立即触发
  watch([statusFilter, timeFilter], () => {
    resetAndLoad();
    const cutoff = getTimeCutoff();
    useStatsStore().load(cutoff > 0 ? cutoff : undefined);
  });

  // 搜索框：400ms 防抖
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  watch(search, () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      resetAndLoad();
    }, 400);
  });

  async function selectRequest(id: string) {
    curRequestId.value = id;
    payload.value = null;
    curLogs.value = [];
    const [l, p] = await Promise.all([
      fetchLogs({ requestId: id }),
      fetchPayload(id),
    ]);
    curLogs.value = l;
    payload.value = p;
  }

  function deselect() {
    curRequestId.value = null;
    curLogs.value = [];
    payload.value = null;
  }

  function addLog(entry: LogEntry) {
    globalLogs.value.push(entry);
    if (globalLogs.value.length > 2000) globalLogs.value = globalLogs.value.slice(-1500);
    // 当前请求流
    if (entry.requestId === curRequestId.value) {
      curLogs.value.push(entry);
    }
  }

  function upsertRequest(summary: RequestSummary) {
    const idx = reqs.value.findIndex(r => r.requestId === summary.requestId);
    if (idx >= 0) {
      // 状态变更：更新 statusCounts
      const oldStatus = reqs.value[idx].status;
      if (oldStatus !== summary.status) {
        if (oldStatus && statusCounts.value[oldStatus]) statusCounts.value[oldStatus]--;
        if (summary.status) statusCounts.value[summary.status] = (statusCounts.value[summary.status] ?? 0) + 1;
      }
      Object.assign(reqs.value[idx], summary);
    } else {
      // 新请求：递增计数
      statusCounts.value.all = (statusCounts.value.all ?? 0) + 1;
      if (summary.status) statusCounts.value[summary.status] = (statusCounts.value[summary.status] ?? 0) + 1;
      total.value++;
      reqs.value.unshift(summary);
      // 自动跟随：已有选中记录时自动切换到最新
      if (autoFollow.value && curRequestId.value !== null) {
        autoFollowTriggered.value = true;
        selectRequest(summary.requestId).finally(() => { autoFollowTriggered.value = false; });
      }
    }
  }

  async function clear() {
    await clearLogs();
    reqs.value = [];
    curLogs.value = [];
    globalLogs.value = [];
    curRequestId.value = null;
    payload.value = null;
  }

  // 仅清空前端状态，不调用后端 API（退出登录时使用）
  function resetState() {
    reqs.value = [];
    curLogs.value = [];
    globalLogs.value = [];
    curRequestId.value = null;
    payload.value = null;
  }

  return {
    reqs, curLogs, globalLogs, displayLogs, curRequestId, payload,
    search, statusFilter, timeFilter, autoFollow, autoFollowTriggered, filteredReqs,
    hasMore, loadingMore, total, statusCounts,
    loadRequests, loadMoreRequests, selectRequest, deselect, addLog, upsertRequest, clear, resetState,
  };
});
