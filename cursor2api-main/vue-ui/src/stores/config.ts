import { defineStore } from 'pinia';
import { ref } from 'vue';
import { fetchConfig, saveConfig } from '../api';
import type { HotConfig, SaveConfigResult } from '../types';

export const useConfigStore = defineStore('config', () => {
  const config = ref<HotConfig | null>(null);
  const loading = ref(false);
  const saving = ref(false);
  const lastChanges = ref<string[]>([]);
  const error = ref('');

  async function load() {
    loading.value = true;
    error.value = '';
    try {
      config.value = await fetchConfig();
    } catch (e) {
      error.value = String(e);
    } finally {
      loading.value = false;
    }
  }

  async function save(draft: Partial<HotConfig>): Promise<SaveConfigResult> {
    saving.value = true;
    error.value = '';
    try {
      const result = await saveConfig(draft);
      lastChanges.value = result.changes;
      // 保存成功后重新加载配置
      if (result.ok) await load();
      return result;
    } catch (e) {
      error.value = String(e);
      throw e;
    } finally {
      saving.value = false;
    }
  }

  return { config, loading, saving, lastChanges, error, load, save };
});
