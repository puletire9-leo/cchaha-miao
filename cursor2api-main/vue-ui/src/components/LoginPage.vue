<template>
  <div class="login-overlay">
    <div class="login-card">
      <div class="logo">
        <h1>⚡ Cursor2API</h1>
        <p>日志查看器需要验证身份</p>
      </div>
      <form @submit.prevent="submit">
        <div class="field">
          <label>Auth Token</label>
          <input
            v-model="input"
            type="password"
            placeholder="sk-your-token..."
            autocomplete="current-password"
            autofocus
          />
        </div>
        <button type="submit" class="btn" :disabled="loading">
          {{ loading ? '验证中…' : '登录' }}
        </button>
      </form>
      <div v-if="error" class="err">{{ error }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useAuthStore } from '../stores/auth';

const emit = defineEmits<{ (e: 'loggedIn'): void }>();
const auth = useAuthStore();
const input = ref('');
const error = ref('');
const loading = ref(false);

async function submit() {
  const t = input.value.trim();
  if (!t) { error.value = 'Token 不能为空'; return; }
  loading.value = true;
  error.value = '';
  try {
    const res = await fetch('/api/vue/stats', { headers: { Authorization: `Bearer ${t}` } });
    if (res.status === 401) {
      auth.clearToken();
      error.value = 'Token 无效，请检查后重试';
      return;
    }
    auth.setToken(t);
    emit('loggedIn');
  } catch {
    // 网络错误时仍然放行
    auth.setToken(t);
    emit('loggedIn');
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-overlay {
  position: fixed; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #e8eeff 0%, #f0f4f8 40%, #eef2f8 70%, #f0f4f8 100%);
}
[data-theme="dark"] .login-overlay {
  background:
    radial-gradient(ellipse 80% 60% at 50% 0%, rgba(88,166,255,0.12) 0%, transparent 60%),
    radial-gradient(ellipse 50% 40% at 85% 100%, rgba(57,208,232,0.08) 0%, transparent 55%),
    #0d1117;
}

.login-card {
  width: 380px; padding: 44px;
  background: rgba(255,255,255,.9);
  border: 1px solid rgba(226,232,240,.9);
  border-radius: 20px;
  backdrop-filter: blur(32px);
  box-shadow: 0 24px 48px rgba(0,0,0,.08), 0 0 0 1px rgba(255,255,255,.5) inset;
}
[data-theme="dark"] .login-card {
  background: rgba(22,27,39,.85);
  border: 1px solid rgba(88,166,255,0.15);
  box-shadow: 0 24px 64px rgba(0,0,0,.6), 0 0 0 1px rgba(88,166,255,0.06) inset;
  backdrop-filter: blur(32px);
}

.logo { text-align: center; margin-bottom: 32px; }
.logo h1 {
  font-size: 22px; font-weight: 700;
  background: linear-gradient(135deg, #6366f1, #3b82f6, #0891b2);
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  display: flex; align-items: center; justify-content: center; gap: 8px;
}
.logo h1 .ic { -webkit-text-fill-color: initial; }
.logo p { font-size: 12px; color: var(--text-muted); margin-top: 8px; letter-spacing: .3px; }

.field { margin-bottom: 22px; }
.field label {
  display: block; font-size: 11px; font-weight: 600;
  color: var(--text-muted); text-transform: uppercase;
  letter-spacing: .5px; margin-bottom: 8px;
}
.field input {
  width: 100%; padding: 11px 16px; font-size: 14px;
  background: var(--bg1); border: 1px solid var(--border);
  border-radius: 10px; color: var(--text);
  font-family: var(--mono); outline: none; transition: all .2s;
}
.field input:focus {
  border-color: var(--blue);
  box-shadow: 0 0 0 3px rgba(59,130,246,.12);
  background: var(--bg);
}
.field input::placeholder { color: var(--text-muted); }

.btn {
  width: 100%; padding: 11px; font-size: 14px; font-weight: 600;
  background: linear-gradient(135deg, #3b82f6, #6366f1);
  border: none; border-radius: 10px; color: #fff;
  cursor: pointer; transition: all .2s;
  box-shadow: 0 4px 12px rgba(59,130,246,.25);
}
.btn:hover:not(:disabled) { opacity: .92; box-shadow: 0 6px 16px rgba(59,130,246,.3); }
.btn:active:not(:disabled) { transform: scale(.98); }
.btn:disabled { opacity: .6; cursor: not-allowed; }

.err {
  margin-top: 14px; padding: 10px 14px;
  background: #fef2f2; border: 1px solid #fecaca;
  border-radius: 8px; font-size: 12px; color: #dc2626;
  text-align: center;
}
[data-theme="dark"] .err {
  background: color-mix(in srgb, var(--red) 8%, var(--bg1));
  border-color: color-mix(in srgb, var(--red) 25%, transparent);
  color: var(--red);
}
</style>
