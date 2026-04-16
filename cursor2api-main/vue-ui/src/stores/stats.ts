import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Stats } from '../types';
import { fetchStats } from '../api';

export const useStatsStore = defineStore('stats', () => {
  const stats = ref<Stats>({
    totalRequests: 0,
    successCount: 0,
    degradedCount: 0,
    errorCount: 0,
    avgResponseTime: 0,
    avgTTFT: 0,
  });

  async function load(since?: number) {
    try { stats.value = await fetchStats(since); } catch { /* ignore */ }
  }

  function update(data: Stats) {
    stats.value = data;
  }

  return { stats, load, update };
});
