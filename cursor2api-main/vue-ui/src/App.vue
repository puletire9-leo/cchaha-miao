<template>
  <div class="app">
    <template v-if="authChecked">
      <LoginPage v-if="!isLoggedIn" @loggedIn="onLogin" />
      <template v-else>
        <AppHeader :connected="sseConnected" @openConfig="configDrawerVisible = true" />
        <div class="main">
          <RequestList />
          <DetailPanel />
        </div>
        <ConfigDrawer :visible="configDrawerVisible" @close="configDrawerVisible = false" />
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useAuthStore } from './stores/auth';
import { useLogsStore } from './stores/logs';
import { useStatsStore } from './stores/stats';
import { useSSE } from './composables/useSSE';
import LoginPage from './components/LoginPage.vue';
import AppHeader from './components/AppHeader.vue';
import RequestList from './components/RequestList.vue';
import DetailPanel from './components/DetailPanel.vue';
import ConfigDrawer from './components/ConfigDrawer.vue';

const auth = useAuthStore();
const logsStore = useLogsStore();
const statsStore = useStatsStore();
const { loggedIn: isLoggedIn } = storeToRefs(auth);

const authChecked = ref(false);
const sseConnected = ref(false);
const configDrawerVisible = ref(false);

// 初始化主题（避免闪烁）
const savedTheme = localStorage.getItem('cursor2api_theme') ?? 'light';
document.documentElement.setAttribute('data-theme', savedTheme);

const { connect: connectSSE, disconnect: disconnectSSE } = useSSE((connected) => { sseConnected.value = connected; });

onMounted(async () => {
  // URL 参数 token 优先：?token=sk-xxx
  const urlToken = new URLSearchParams(location.search).get('token');
  if (urlToken) {
    auth.setToken(urlToken);
    // 清除 URL 参数，避免 token 暴露在浏览器历史
    history.replaceState(null, '', location.pathname);
  }
  try {
    const res = await fetch('/api/vue/stats', {
      headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : {},
    });
    if (res.ok) {
      // 服务端不需要授权 或 token 有效，直接进主页
      auth.loggedIn = true;
    } else if (res.status === 401) {
      // 需要授权，检查本地 token
      auth.loggedIn = auth.isLoggedIn();
    } else {
      auth.loggedIn = auth.isLoggedIn();
    }
  } catch {
    auth.loggedIn = auth.isLoggedIn();
  }
  authChecked.value = true;
  if (isLoggedIn.value) {
    await Promise.all([logsStore.loadRequests(), statsStore.load()]);
    connectSSE();
  }
});

// 退出登录时断开 SSE，仅清空前端状态
watch(isLoggedIn, (val) => {
  if (!val) {
    disconnectSSE();
    logsStore.resetState();
  }
});

async function onLogin() {
  await Promise.all([logsStore.loadRequests(), statsStore.load()]);
  connectSSE();
}
</script>

<style>
@import 'highlight.js/styles/github-dark.css';

/* ===== Light Theme (default, matches original) ===== */
:root, [data-theme="light"] {
  --bg0: #f0f4f8;
  --bg1: #ffffff;
  --bg2: #f7f9fc;
  --bg3: #edf2f7;
  --bg-card: #ffffff;
  --bdr: #e2e8f0;
  --bdr2: #cbd5e1;
  --t1: #1e293b;
  --t2: #475569;
  --t3: #94a3b8;
  --blue: #3b82f6;
  --cyan: #0891b2;
  --green: #059669;
  --yellow: #d97706;
  --red: #dc2626;
  --purple: #7c3aed;
  --pink: #db2777;
  --orange: #ea580c;
  --mono: 'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'SF Mono', 'Consolas', 'Menlo', monospace;
  --sans: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif;
  --shadow-sm: 0 1px 2px rgba(0,0,0,.05);
  --shadow: 0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.04);
  --shadow-md: 0 4px 6px rgba(0,0,0,.06), 0 2px 4px rgba(0,0,0,.04);
  --radius: 10px;
  --radius-sm: 6px;
  /* aliases for components */
  --bg: var(--bg0);
  --card-bg: var(--bg1);
  --border: var(--bdr);
  --border-faint: #f1f5f9;
  --text: var(--t1);
  --text-muted: var(--t2);   /* 亮色下用 t2(#475569) 而非 t3(#94a3b8)，对比度从 2.8 提升至 7:1 */
  --text-dim: var(--t3);     /* 极次要信息用 t3 */
  --accent: var(--blue);
  --pill-bg: var(--bg3);
  --hover-bg: var(--bg3);
  --active-bg: #eff6ff;
}

/* ===== Dark Theme ===== */
[data-theme="dark"] {
  --bg0: #0d1117;
  --bg1: #161b27;
  --bg2: #1c2133;
  --bg3: #21273a;
  --bg-card: #161b27;
  --bdr: #2a3150;
  --bdr2: #3a4268;
  --t1: #e2e8f0;
  --t2: #8892aa;
  --t3: #546178;
  --blue: #58a6ff;
  --cyan: #39d0e8;
  --green: #3dd68c;
  --yellow: #f0b429;
  --red: #f87171;
  --purple: #b48efa;
  --pink: #f472b6;
  --orange: #fb923c;
  --mono: 'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'SF Mono', 'Consolas', 'Menlo', monospace;
  --sans: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif;
  --shadow-sm: 0 1px 2px rgba(0,0,0,.3);
  --shadow: 0 1px 3px rgba(0,0,0,.4);
  --shadow-md: 0 4px 6px rgba(0,0,0,.4);
  --radius: 10px;
  --radius-sm: 6px;
  --bg: var(--bg0);
  --card-bg: var(--bg1);
  --border: var(--bdr);
  --border-faint: #1e2540;
  --text: var(--t1);
  --text-muted: var(--t3);
  --accent: var(--blue);
  --pill-bg: var(--bg3);
  --hover-bg: var(--bg2);
  --active-bg: #1e3a5f;
}

/* highlight.js 亮色主题覆盖 */
[data-theme="light"] .hljs { background: #f6f8fa; color: #24292e; }
[data-theme="light"] .hljs-comment, [data-theme="light"] .hljs-quote { color: #6a737d; }
[data-theme="light"] .hljs-keyword, [data-theme="light"] .hljs-selector-tag { color: #d73a49; font-weight: bold; }
[data-theme="light"] .hljs-string, [data-theme="light"] .hljs-attr { color: #032f62; }
[data-theme="light"] .hljs-number, [data-theme="light"] .hljs-literal { color: #005cc5; }
[data-theme="light"] .hljs-title, [data-theme="light"] .hljs-section { color: #6f42c1; font-weight: bold; }
[data-theme="light"] .hljs-built_in, [data-theme="light"] .hljs-type { color: #e36209; }
[data-theme="light"] .hljs-variable, [data-theme="light"] .hljs-name { color: #24292e; }

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--sans);
  background: var(--bg0);
  color: var(--t1);
  height: 100vh;
  overflow: hidden;
}

[data-theme="light"] body {
  background: linear-gradient(135deg, #e8eeff 0%, #f0f4f8 40%, #eef2f8 70%, #f0f4f8 100%);
  background-attachment: fixed;
}

[data-theme="dark"] body {
  background:
    radial-gradient(ellipse 80% 50% at 20% -10%, rgba(88,166,255,0.07) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 85% 110%, rgba(57,208,232,0.06) 0%, transparent 55%),
    radial-gradient(ellipse 40% 30% at 50% 50%, rgba(99,102,241,0.04) 0%, transparent 50%),
    #0d1117;
  background-attachment: fixed;
}

.app {
  display: flex; flex-direction: column;
  height: 100vh; color: var(--t1);
}

.main { display: flex; flex: 1; overflow: hidden; }

::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--bdr2); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--t3); }
</style>
