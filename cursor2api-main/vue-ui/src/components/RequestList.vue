<template>
  <div class="request-list">
    <!-- 搜索框 -->
    <div class="search">
      <div class="sw">
        <input
          ref="searchInput"
          v-model="logsStore.search"
          class="si"
          placeholder="关键字搜索… (Ctrl+K)"
        />
        <button v-if="logsStore.search" class="si-clear" @click="logsStore.search = ''">✕</button>
      </div>
      <button
        v-if="logsStore.curRequestId"
        class="follow-btn"
        :class="{ active: logsStore.autoFollow }"
        @click="toggleAutoFollow"
        title="开启后自动跟随并选中最新请求"
      >⚡ 自动跟随</button>
    </div>
    <!-- 时间筛选 -->
    <div class="tbar">
      <button
        v-for="t in timeTabs"
        :key="t.value"
        class="tb"
        :class="{ a: logsStore.timeFilter === t.value }"
        :title="t.title"
        @click="logsStore.timeFilter = t.value"
      >{{ t.label }}</button>
    </div>
    <!-- 状态筛选 + 计数 -->
    <div class="fbar">
      <button
        v-for="f in statusTabs"
        :key="f.value"
        class="fb"
        :class="[{ a: logsStore.statusFilter === f.value }, f.value]"
        :title="f.title"
        @click="logsStore.statusFilter = f.value"
      >
        <span v-if="f.icon" class="fic">{{ f.icon }}</span>
        <span v-else class="fall-label">全部</span>
        <span v-if="f.value !== 'all'" class="fc">{{ counts[f.value] }}</span>
      </button>
    </div>
    <!-- 请求列表 -->
    <div class="rlist" ref="rlistEl">
      <div v-if="!logsStore.filteredReqs.length" class="empty">
        <div class="ic">📭</div><p>暂无请求</p>
      </div>
      <div
        v-for="req in logsStore.filteredReqs"
        :key="req.requestId"
        class="ri"
        :class="[req.status, { sel: req.requestId === logsStore.curRequestId }]"
        @click="selectReq(req.requestId)"
      >
        <span class="st" :class="req.status" />
        <div class="ri-title">
          <span class="seq">#{{ seqNum(req.requestId) }}</span>
          <span class="ri-title-text">{{ req.title || shortModel(req.model) }}</span>
        </div>
        <div class="ri-time">
          <span v-if="req.endTime" class="dur" title="总响应耗时"> 耗时 {{ fmtMs(req.endTime - req.startTime) }}</span>
          <span v-if="req.ttft" class="ttft" title="首 Token 时间（Time To First Token）"> ⚡️{{ fmtMs(req.ttft) }}</span>
          <span class="date">{{ fmtDate(req.startTime) }}</span>
        </div>
        <div class="r1">
          <span class="rid" title="请求 ID">{{ req.requestId.slice(0, 8) }}</span>
          <span class="rfmt" :class="req.apiFormat" :title="'API 格式：' + req.apiFormat">{{ req.apiFormat }}</span>
          <span v-if="req.responseChars" class="rchars" title="响应字符数">{{ fmtN(req.responseChars) }} chars</span>
          <span v-if="req.inputTokens" class="rchars" :title="'输入 Token：' + req.inputTokens + '，输出 Token：' + (req.outputTokens ?? 0)">↑{{ fmtN(req.inputTokens) }}↓{{ fmtN(req.outputTokens ?? 0) }} tok</span>
        </div>
        <div class="rbd">
          <span v-if="req.stream" class="bg bg-stream" title="流式响应">Stream</span>
          <span v-if="req.toolCount > 0" class="bg bg-tool" :title="'工具定义数：' + req.toolCount">T:{{ req.toolCount }}</span>
          <span v-if="req.toolCallsDetected > 0" class="bg bg-call" :title="'工具调用次数：' + req.toolCallsDetected">C:{{ req.toolCallsDetected }}</span>
          <span v-if="req.retryCount > 0" class="bg bg-retry" :title="'重试次数：' + req.retryCount">R:{{ req.retryCount }}</span>
          <span v-if="req.continuationCount > 0" class="bg bg-cont" :title="'续写次数：' + req.continuationCount">+{{ req.continuationCount }}</span>
          <span v-if="req.thinkingChars > 0" class="bg bg-think" :title="'思考内容字符数：' + req.thinkingChars">🤔 {{ fmtN(req.thinkingChars) }} chars</span>
          <span v-if="req.status === 'degraded'" class="bg bg-deg" title="请求降级（发生重试但最终成功）">DEGRADED</span>
          <span v-if="req.status === 'error'" class="bg bg-err" title="请求失败">ERR</span>
          <span v-if="req.status === 'intercepted'" class="bg bg-int" title="请求被拦截或中断">INTERCEPT</span>
        </div>
        <div class="rdbar-bg"><div class="rdbar" :style="durStyle(req)" /></div>
        <div v-if="req.error" class="rerr">{{ req.error }}</div>
      </div>
    </div>
    <!-- 加载更多（仅 SQLite 模式下有数据时显示） -->
    <div v-if="logsStore.hasMore" class="load-more">
      <button class="lm-btn" :disabled="logsStore.loadingMore" @click="logsStore.loadMoreRequests()">
        {{ logsStore.loadingMore ? '加载中...' : `加载更多（已显示 ${logsStore.reqs.length} / ${logsStore.total}）` }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, onMounted, onUnmounted, watch } from 'vue';
import { useLogsStore } from '../stores/logs';

const searchInput = ref<HTMLInputElement | null>(null);
const rlistEl = ref<HTMLElement | null>(null);

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    searchInput.value?.focus();
    return;
  }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    // 搜索框聚焦时不干预
    if (document.activeElement === searchInput.value) return;
    const list = logsStore.filteredReqs;
    if (!list.length) return;
    e.preventDefault();
    // 主动移除焦点，防止按钮/tab等元素出现 focus 高亮
    (document.activeElement as HTMLElement)?.blur();
    const cur = logsStore.curRequestId;
    const idx = cur ? list.findIndex(r => r.requestId === cur) : -1;
    let next: number;
    if (e.key === 'ArrowUp') next = idx <= 0 ? list.length - 1 : idx - 1;
    else next = idx < 0 || idx >= list.length - 1 ? 0 : idx + 1;
    logsStore.selectRequest(list[next].requestId);
    nextTick(() => {
      const el = rlistEl.value?.querySelectorAll('.ri')[next] as HTMLElement | undefined;
      el?.scrollIntoView({ block: 'nearest' });
    });
  }
}

onMounted(() => { window.addEventListener('keydown', onKeydown); });
onUnmounted(() => { window.removeEventListener('keydown', onKeydown); });

const logsStore = useLogsStore();

watch(() => logsStore.autoFollowTriggered, (v) => {
  if (v) {
    nextTick(() => { rlistEl.value?.scrollTo({ top: 0, behavior: 'smooth' }); });
  }
});

const timeTabs = [
  { value: 'all' as const,   label: '全部',  title: '显示全部历史请求' },
  { value: '1h' as const,   label: '1小时', title: '最近 1 小时的请求' },
  { value: '6h' as const,   label: '6小时', title: '最近 6 小时的请求' },
  { value: 'today' as const, label: '今天', title: '今天 0 点至今的请求' },
  { value: '2d' as const,    label: '两天', title: '最近 2 天的请求' },
  { value: '7d' as const,    label: '一周', title: '最近 7 天的请求' },
  { value: '30d' as const,   label: '一月', title: '最近 30 天的请求' },
];

const statusTabs = [
  { value: 'all' as const,         icon: '',   label: '全部',  title: '显示全部请求' },
  { value: 'success' as const,     icon: '✅',  label: '成功',  title: '成功完成的请求' },
  { value: 'degraded' as const,    icon: '⚠️', label: '降级',  title: '降级请求（重试后成功）' },
  { value: 'error' as const,       icon: '❌',  label: '错误',  title: '失败请求' },
  { value: 'processing' as const,  icon: '⏳',  label: '处理中', title: '正在处理的请求' },
  { value: 'intercepted' as const, icon: '🚫',  label: '中断',  title: '被拦截/中断的请求' },
];

const counts = computed(() => logsStore.statusCounts);

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const time = d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${month}/${day} ${time}`;
}

function shortModel(model: string): string {
  return model.split('/').pop() ?? model;
}

function fmtN(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}

function durStyle(req: { endTime?: number; startTime: number; status: string }): Record<string, string> {
  if (req.status === 'processing') {
    return { width: '100%', background: 'var(--blue)', animation: 'prog 1.5s ease-in-out infinite' };
  }
  if (!req.endTime) return { width: '0%' };
  const ms = req.endTime - req.startTime;
  // 以 30s 为满格基准
  const pct = Math.min(100, Math.round(ms / 300));
  let color: string;
  if (ms < 3000) color = 'var(--green)';
  else if (ms < 8000) color = 'var(--yellow)';
  else if (ms < 20000) color = '#f97316';
  else color = 'var(--red)';
  return { width: pct + '%', background: color };
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? (ms / 1000).toFixed(2).replace(/\.?0+$/, '') + 's' : ms + 'ms';
}

function seqNum(requestId: string): number {
  const idx = logsStore.reqs.findIndex(r => r.requestId === requestId);
  return idx < 0 ? 0 : logsStore.reqs.length - idx;
}

function selectReq(id: string) {
  if (logsStore.curRequestId === id) {
    logsStore.deselect();
  } else {
    logsStore.selectRequest(id);
  }
}

function toggleAutoFollow() {
  logsStore.autoFollow = !logsStore.autoFollow;
  if (logsStore.autoFollow && logsStore.filteredReqs.length) {
    logsStore.selectRequest(logsStore.filteredReqs[0].requestId);
    nextTick(() => { rlistEl.value?.scrollTo({ top: 0, behavior: 'smooth' }); });
  }
}
</script>

<style scoped>
.request-list {
  width: 370px; flex-shrink: 0;
  display: flex; flex-direction: column;
  border-right: 1px solid var(--border);
  background: var(--bg1);
  isolation: isolate;
}
[data-theme="dark"] .request-list { background: rgba(22,27,39,.75); }

.search { padding: 8px 10px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 6px; }
.sw { position: relative; flex: 1; }
.sw::before { content: '🔍'; position: absolute; left: 9px; top: 50%; transform: translateY(-50%); font-size: 11px; pointer-events: none; }
.si {
  width: 100%; padding: 6px 28px 6px 28px; font-size: 12px;
  background: var(--bg); border: 1px solid var(--border);
  border-radius: var(--radius); color: var(--text);
  font-family: var(--mono); outline: none; transition: border-color .2s;
}
.si:focus { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(59,130,246,.12); }
.si::placeholder { color: var(--text-muted); }
.si-clear {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  background: none; border: none; cursor: pointer;
  color: var(--text-muted); font-size: 12px; padding: 0 2px;
  line-height: 1; display: flex; align-items: center;
}
.si-clear:hover { color: var(--text); }
.follow-btn {
  padding: 4px 8px; font-size: 10px; font-weight: 500; white-space: nowrap; flex-shrink: 0;
  background: var(--bg); border: 1px solid var(--border); border-radius: 20px;
  color: var(--text-muted); cursor: pointer; transition: all .15s;
}
.follow-btn:hover { border-color: var(--yellow); color: var(--yellow); }
.follow-btn.active { background: color-mix(in srgb, var(--yellow) 15%, transparent); border-color: var(--yellow); color: var(--yellow); font-weight: 600; }

.tbar { padding: 5px 8px; border-bottom: 1px solid var(--border); display: flex; gap: 3px; flex-wrap: wrap; }
.tb {
  padding: 3px 9px; font-size: 10px; font-weight: 500;
  border: 1px solid var(--border); border-radius: 20px;
  background: var(--bg); color: var(--text-muted);
  cursor: pointer; transition: all .15s;
}
.tb:hover { border-color: var(--cyan); color: var(--cyan); }
.tb.a { background: linear-gradient(135deg,#0891b2,#06b6d4); border-color: transparent; color: #fff; }

.fbar { padding: 5px 8px; border-bottom: 1px solid var(--border); display: flex; gap: 3px; flex-wrap: wrap; }
.fb {
  padding: 3px 8px; font-size: 10px; font-weight: 500;
  border: 1px solid var(--border); border-radius: 20px;
  background: var(--bg); color: var(--text-muted);
  cursor: pointer; transition: all .15s;
  display: flex; align-items: center; gap: 4px;
}
.fb:hover { border-color: var(--blue); color: var(--blue); }
.fb.a { background: linear-gradient(135deg,#3b82f6,#6366f1); border-color: transparent; color: #fff; }
.fb.a.success { background: none; border-color: var(--green); color: var(--green); }
.fb.a.degraded { background: none; border-color: var(--orange); color: var(--orange); }
.fb.a.error { background: none; border-color: var(--red); color: var(--red); }
.fb.a.processing { background: none; border-color: var(--yellow); color: var(--yellow); }
.fb.a.intercepted { background: none; border-color: var(--pink); color: var(--pink); }
.fic { font-size: 12px; line-height: 1; }
.fall-label { font-size: 10px; }
.fc { font-size: 9px; font-weight: 700; padding: 0 4px; border-radius: 8px; background: rgba(255,255,255,.15); }
.fb:not(.a) .fc { background: var(--pill-bg); color: var(--text-muted); }

.rlist { overflow-y: auto; flex: 1; padding: 4px 0; }
.empty { padding: 24px; text-align: center; color: var(--text-muted); font-size: 13px; }
.empty .ic { font-size: 20px; margin-bottom: 8px; }

.ri {
  position: relative;
  padding: 9px 12px 6px 14px; cursor: pointer;
  margin: 4px 8px;
  border-radius: 8px;
  border: 1px solid var(--border-faint);
  transition: background .1s, border-color .1s;
  overflow: hidden;
}
.ri:hover { background: var(--hover-bg); border-color: var(--border); }
.ri.sel {
  background: linear-gradient(90deg, color-mix(in srgb, var(--blue) 10%, transparent) 0%, transparent 100%);
  border-color: var(--border-faint);
  border-left: 3px solid var(--blue);
  padding-left: 13px;
}

/* 状态点 — 右上角绝对定位 */
.st {
  position: absolute; top: 10px; right: 10px;
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
  background: var(--text-muted);
}
.st.success { background: var(--green); }
.st.degraded { background: var(--orange); }
.st.error { background: var(--red); }
.st.processing { background: var(--yellow); animation: pulse 1s infinite; }
.st.intercepted { background: var(--pink); }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }

/* 标题行 */
.ri-title {
  display: flex; align-items: center; gap: 5px;
  padding-right: 14px; margin-bottom: 3px; min-width: 0;
}
.seq { font-size: 10px; font-family: var(--mono); color: var(--blue); font-weight: 700; flex-shrink: 0; }
.ri-title-text {
  font-size: 12px; font-weight: 600; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;
}

/* 时间行 */
.ri-time {
  display: flex; align-items: center; gap: 4px;
  font-size: 10px; font-family: var(--mono);
  color: var(--text-muted); margin-bottom: 3px;
}
.ri-time .date { margin-left: auto; }
.ri-time .dur { color: var(--text-muted); }
.ri-time .ttft { color: var(--yellow); }

/* requestId + apiFormat + 字数行 */
.r1 { display: flex; align-items: center; gap: 5px; margin-bottom: 4px; }
.rid { font-size: 10px; font-family: var(--mono); color: var(--text-muted); flex-shrink: 0; }
.rfmt {
  font-size: 9px; font-weight: 700; padding: 1px 5px;
  border-radius: 3px; text-transform: uppercase;
  background: var(--pill-bg); color: var(--text-muted);
}
.rfmt.anthropic { background: #7c3aed22; color: #a78bfa; }
.rfmt.openai { background: #05966922; color: #34d399; }
.rfmt.responses { background: #0ea5e922; color: #38bdf8; }
.rchars { font-size: 10px; font-family: var(--mono); color: var(--text-muted); margin-left: auto; }

/* badges 行 */
.rbd { display: flex; flex-wrap: wrap; gap: 3px; margin-bottom: 5px; }
.bg {
  font-size: 9px; font-weight: 600; padding: 1px 5px;
  border-radius: 3px; line-height: 1.5;
}
.bg-stream { background: color-mix(in srgb, var(--green) 15%, transparent); color: var(--green); }
.bg-tool { background: color-mix(in srgb, var(--blue) 15%, transparent); color: var(--blue); }
.bg-call { background: color-mix(in srgb, var(--cyan) 15%, transparent); color: var(--cyan); }
.bg-retry { background: color-mix(in srgb, var(--yellow) 15%, transparent); color: var(--yellow); }
.bg-cont { background: color-mix(in srgb, var(--purple) 15%, transparent); color: var(--purple); }
.bg-think { background: color-mix(in srgb, var(--text-muted) 15%, transparent); color: var(--text-muted); }
.bg-deg { background: color-mix(in srgb, var(--orange) 15%, transparent); color: var(--orange); }
.bg-err { background: color-mix(in srgb, var(--red) 15%, transparent); color: var(--red); }
.bg-int { background: color-mix(in srgb, var(--pink) 15%, transparent); color: var(--pink); }

/* 进度条 — 百分比效果 */
.rdbar-bg {
  height: 3px;
  background: var(--border-faint);
  margin: 4px 0 0 0;
  border-radius: 2px;
  overflow: hidden;
}
.rdbar {
  height: 100%;
  border-radius: 2px;
  transition: width .4s ease;
}
@keyframes prog { 0%,100%{opacity:.4} 50%{opacity:1} }

.rerr { color: var(--red); margin-top: 3px; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.load-more { padding: 8px; text-align: center; }
.lm-btn { width: 100%; padding: 6px 0; font-size: 12px; color: var(--text-muted); background: var(--bg-2); border: 1px solid var(--border-faint); border-radius: 4px; cursor: pointer; }
.lm-btn:hover:not(:disabled) { background: var(--bg-3); color: var(--text); }
.lm-btn:disabled { opacity: 0.5; cursor: default; }
</style>
