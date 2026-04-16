<template>
  <div class="log-list-wrap">
    <div class="log-title" v-if="!logsStore.curRequestId">
      <span>🔍 全链路实时日志</span>
    </div>
    <div class="log-toolbar" v-if="!logsStore.curRequestId">
      <!-- 实时流/请求模式标识 -->
      <div class="stream-badge">
        <span class="live-dot" />实时流
      </div>
      <!-- 级别筛选 pill -->
      <div class="level-pills">
        <button
          v-for="lv in levels"
          :key="lv.value"
          class="lv-btn"
          :class="{ a: levelFilter === lv.value }"
          @click="levelFilter = lv.value"
        >{{ lv.label }}</button>
      </div>
      <!-- 搜索框 -->
      <div class="log-search-wrap">
        <input v-model="logSearch" class="log-search" placeholder="关键字搜索…" />
        <button v-if="logSearch" class="log-search-clear" @click="logSearch = ''">✕</button>
      </div>
      <!-- 自动展开 -->
      <label class="auto-exp">
        <input type="checkbox" v-model="autoExpand" @change="onAutoExpand" /> 展开
      </label>
      <span class="log-count">{{ filtered.length }} 请求</span>
    </div>
    <div class="log-list" ref="listEl">
      <div v-if="!filtered.length" class="empty">
        <div class="ic">📋</div>
        <p>{{ logsStore.curRequestId ? '暂无日志' : '实时日志将在此显示' }}</p>
        <p class="sub" v-if="!logsStore.curRequestId">发起请求后即可看到全链路日志</p>
      </div>
      <template v-else>
        <template v-for="(entry, i) in filtered" :key="entry.id">
          <template v-if="!logsStore.curRequestId">
            <template v-if="i === 0 || filtered[i-1].requestId !== entry.requestId">
              <div class="le-sep" />
              <div class="le-sep-label">
                <span class="sep-dot" />
                <span class="sep-seq">#{{ seqNum(entry.requestId) }}</span>
                <span class="sep-id">{{ entry.requestId.slice(0, 8) }}</span>
                <template v-if="reqTitle(entry.requestId)">
                  <span class="sep-line">—</span>
                  <span class="sep-title">{{ reqTitle(entry.requestId) }}</span>
                </template>
              </div>
            </template>
          </template>
          <div class="le" :class="{ expanded: expanded[entry.id] }">
            <div class="tli" :style="{ background: phaseColor(entry.phase) }" />
            <span class="lt">{{ fmtTime(entry.timestamp) }}</span>
            <span class="ld" v-if="entry.duration != null">+{{ fmtMs(entry.duration) }}</span>
            <span class="ld" v-else />
            <span class="ll" :class="entry.level">{{ entry.level }}</span>
            <span class="ls">{{ entry.source }}</span>
            <span class="lp">{{ entry.phase }}</span>
            <div class="lm">
              <span v-html="hlMsg(entry.message)" />
              <template v-if="entry.details">
                <div class="ldt" @click="toggleDetail(entry.id)">
                  {{ expanded[entry.id] ? '▼ 收起' : '▶ 详情' }}
                </div>
                <div v-if="expanded[entry.id]" class="ldd">
                  <pre class="hljs" v-html="hlDetails(entry.details)" />
                  <button class="copy-btn" @click.stop="copy(fmtDetails(entry.details))">复制</button>
                </div>
              </template>
            </div>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useLogsStore } from '../stores/logs';
import type { LogPhase } from '../types';
import hljs from 'highlight.js/lib/core';
import json from 'highlight.js/lib/languages/json';
hljs.registerLanguage('json', json);

const logsStore = useLogsStore();
const autoExpand = ref(false);
const levelFilter = ref<'all' | 'debug' | 'info' | 'warn' | 'error'>('all');
const logSearch = ref('');
// 用 Record 替代 Set，保证 Vue 响应式
const expanded = ref<Record<string, boolean>>({});
const listEl = ref<HTMLElement | null>(null);

const levels = [
  { value: 'all' as const,   label: 'ALL' },
  { value: 'debug' as const, label: 'DEBUG' },
  { value: 'info' as const,  label: 'INFO' },
  { value: 'warn' as const,  label: 'WARN' },
  { value: 'error' as const, label: 'ERROR' },
];

const PC: Record<string, string> = {
  receive: '#3b82f6', convert: '#0891b2', send: '#7c3aed',
  response: '#7c3aed', thinking: '#a855f7', refusal: '#d97706',
  retry: '#d97706', truncation: '#d97706', continuation: '#d97706',
  toolparse: '#ea580c', sanitize: '#ea580c', stream: '#059669',
  complete: '#059669', error: '#dc2626', intercept: '#db2777', auth: '#94a3b8',
};

function phaseColor(phase: LogPhase): string {
  return PC[phase] ?? '#94a3b8';
}

const filtered = computed(() => {
  let logs = logsStore.displayLogs;
  if (levelFilter.value !== 'all') logs = logs.filter(l => l.level === levelFilter.value);
  const q = logSearch.value.trim().toLowerCase();
  if (!q) return logs;
  return logs.filter(l =>
    l.message.toLowerCase().includes(q) ||
    (l.source ?? '').toLowerCase().includes(q) ||
    l.phase.toLowerCase().includes(q) ||
    reqTitle(l.requestId).toLowerCase().includes(q)
  );
});

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function hlMsg(msg: string): string {
  const q = logSearch.value.trim();
  if (!q) return escHtml(msg);
  const escaped = escHtml(msg);
  const escapedQ = escHtml(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp(escapedQ, 'gi'), m => `<mark class="lhl">${m}</mark>`);
}

function reqTitle(requestId: string): string {
  return logsStore.reqs.find(r => r.requestId === requestId)?.title ?? '';
}

function seqNum(requestId: string): number {
  const idx = logsStore.reqs.findIndex(r => r.requestId === requestId);
  return idx < 0 ? 0 : logsStore.reqs.length - idx;
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? (ms / 1000).toFixed(2).replace(/\.?0+$/, '') + 's' : ms + 'ms';
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDetails(d: unknown): string {
  return typeof d === 'string' ? d : JSON.stringify(d, null, 2);
}

function hlDetails(d: unknown): string {
  const text = fmtDetails(d);
  try {
    return hljs.highlight(text, { language: 'json' }).value;
  } catch {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

function toggleDetail(id: string) {
  expanded.value = { ...expanded.value, [id]: !expanded.value[id] };
}

function onAutoExpand() {
  if (autoExpand.value) {
    const next: Record<string, boolean> = {};
    for (const l of filtered.value) {
      if (l.details) next[l.id] = true;
    }
    expanded.value = next;
  } else {
    expanded.value = {};
  }
}

// 新日志进来时若 autoExpand 开启则自动展开
watch(() => filtered.value.length, async () => {
  if (autoExpand.value) {
    const next = { ...expanded.value };
    for (const l of filtered.value) {
      if (l.details && !(l.id in next)) next[l.id] = true;
    }
    expanded.value = next;
  }
  await nextTick();
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight;
}, { flush: 'post' });

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
}
</script>

<style scoped>
.log-list-wrap { display: flex; flex-direction: column; flex: 1; overflow: hidden; }

.log-title {
  padding: 7px 14px 6px;
  font-size: 12px; font-weight: 600; color: var(--text);
  border-bottom: 1px solid var(--border); flex-shrink: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lt-seq { font-size: 10px; font-family: var(--mono); color: var(--blue); font-weight: 700; margin-right: 5px; }

.sep-seq { font-size: 10px; font-family: var(--mono); color: var(--blue); font-weight: 700; margin-right: 4px; }

.log-toolbar {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-bottom: 1px solid var(--border);
  flex-shrink: 0; font-size: 11px; flex-wrap: wrap;
}

.stream-badge {
  display: flex; align-items: center; gap: 5px;
  font-size: 10px; font-weight: 600;
  padding: 2px 8px; border-radius: 10px;
  background: color-mix(in srgb, var(--green) 15%, transparent); color: var(--green); border: 1px solid color-mix(in srgb, var(--green) 40%, transparent);
  flex-shrink: 0;
}
.stream-badge.req-mode {
  background: var(--active-bg); color: var(--blue); border-color: var(--border);
  font-weight: 400; font-family: var(--mono); font-size: 9px;
  max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.live-dot {
  width: 6px; height: 6px; border-radius: 50%; background: var(--green);
  animation: pulse 1.5s infinite; flex-shrink: 0;
}
.req-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--blue); flex-shrink: 0; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
.exit-btn {
  margin-left: 4px; font-size: 9px; padding: 1px 5px;
  background: none; border: 1px solid var(--border); border-radius: 3px;
  color: var(--text-muted); cursor: pointer; flex-shrink: 0;
}
.exit-btn:hover { color: var(--red); border-color: var(--red); }

.level-pills { display: flex; gap: 2px; }
.lv-btn {
  padding: 2px 7px; font-size: 9px; font-weight: 600;
  border: 1px solid var(--border); border-radius: 10px;
  background: var(--bg); color: var(--text-muted); cursor: pointer; transition: all .1s;
}
.lv-btn:hover { border-color: var(--blue); color: var(--blue); }
.lv-btn.a { background: var(--blue); border-color: var(--blue); color: #fff; }

.auto-exp { display: flex; align-items: center; gap: 3px; color: var(--text-muted); cursor: pointer; font-size: 10px; }
.auto-exp input { cursor: pointer; }
.log-count { color: var(--text-muted); margin-left: auto; font-size: 10px; font-family: var(--mono); }

.log-search-wrap { position: relative; display: flex; align-items: center; }
.log-search {
  height: 22px; padding: 0 22px 0 8px; font-size: 11px;
  background: var(--bg0); border: 1px solid var(--border);
  border-radius: 4px; color: var(--text); outline: none;
  width: 150px; transition: border-color .15s, width .2s;
}
.log-search:focus { border-color: var(--blue); width: 200px; }
.log-search::placeholder { color: var(--text-muted); }
.log-search-clear {
  position: absolute; right: 4px;
  background: none; border: none; cursor: pointer;
  color: var(--text-muted); font-size: 12px; padding: 0 2px; line-height: 1;
}
.log-search-clear:hover { color: var(--text); }

mark.lhl {
  background: color-mix(in srgb, var(--yellow) 35%, transparent);
  color: inherit; border-radius: 2px; padding: 0 1px;
}

.log-list { flex: 1; overflow-y: auto; font-size: 12px; }
.empty {
  padding: 24px; text-align: center; color: var(--text-muted);
  opacity: 0; animation: empty-appear 0s 200ms forwards;
}
@keyframes empty-appear { to { opacity: 1; } }
.empty .ic { font-size: 24px; margin-bottom: 8px; }
.empty .sub { font-size: 11px; margin-top: 4px; }

.le-sep { height: 1px; background: var(--border); margin: 3px 0; }
.le-sep-label {
  display: flex; align-items: center; gap: 6px; font-size: 10px;
  color: var(--text-muted); padding: 2px 10px 3px; font-family: var(--mono);
}
.sep-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--blue); opacity: .5; flex-shrink: 0; }
.sep-id { color: var(--text-muted); opacity: .7; }
.sep-line { color: var(--text-muted); opacity: .4; }
.sep-title { color: var(--text); font-weight: 500; font-family: var(--sans); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 80%; }

.le {
  display: grid;
  grid-template-columns: 3px 62px 44px 36px 68px 68px 1fr;
  gap: 0 5px;
  align-items: start;
  padding: 3px 8px;
  border-bottom: 1px solid var(--border-faint);
  line-height: 1.5;
}
.le:hover { background: var(--hover-bg); }
.tli { width: 3px; border-radius: 2px; min-height: 16px; align-self: stretch; }
.lt { font-family: var(--mono); font-size: 10px; color: var(--text-muted); white-space: nowrap; padding-top: 2px; }
.ld { font-family: var(--mono); font-size: 10px; color: var(--text-muted); text-align: right; padding-top: 2px; }
.ll {
  font-size: 9px; font-weight: 600; padding: 2px 0;
  border-radius: 3px; text-transform: uppercase; text-align: center;
}
.ll.debug { background: var(--pill-bg); color: var(--text-muted); }
.ll.info { background: color-mix(in srgb, var(--blue) 15%, transparent); color: var(--blue); }
.ll.warn { background: color-mix(in srgb, var(--yellow) 15%, transparent); color: var(--yellow); }
.ll.error { background: color-mix(in srgb, var(--red) 15%, transparent); color: var(--red); }
[data-theme="light"] .ll.info { background: #eff6ff; color: #2563eb; }
[data-theme="light"] .ll.warn { background: #fffbeb; color: #d97706; }
[data-theme="light"] .ll.error { background: #fef2f2; color: #dc2626; }
.ls { font-size: 10px; font-weight: 500; color: var(--purple); padding-top: 2px; }
.lp {
  font-size: 9px; padding: 2px 4px; border-radius: 3px;
  background: color-mix(in srgb, var(--cyan) 12%, transparent); color: var(--cyan); text-align: center; font-weight: 500;
}
[data-theme="light"] .lp { background: #ecfeff; color: #0891b2; }
.lm { color: var(--text); word-break: break-word; line-height: 1.4; font-size: 12px; }
.ldt {
  color: var(--blue); font-size: 10px; cursor: pointer;
  margin-top: 3px; display: inline-block; user-select: none; font-weight: 500;
}
.ldt:hover { text-decoration: underline; }
.ldd {
  margin-top: 4px; position: relative;
  background: var(--pill-bg); border-radius: 4px; padding: 6px 8px;
}
.ldd pre {
  font-family: var(--mono); font-size: 10px;
  white-space: pre-wrap; word-break: break-all;
  color: var(--text); max-height: 300px; overflow-y: auto;
}
.copy-btn {
  position: absolute; top: 4px; right: 4px; font-size: 10px; padding: 2px 6px;
  background: var(--bg1); border: 1px solid var(--border);
  border-radius: 3px; cursor: pointer; color: var(--text-muted);
}
.copy-btn:hover { color: var(--text); }
</style>
