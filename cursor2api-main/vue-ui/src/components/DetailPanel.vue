<template>
  <div class="detail-panel">
    <LogList v-show="!logsStore.curRequestId" />
    <template v-if="logsStore.curRequestId">
      <div class="detail-header">
        <span class="req-seq">{{ seqNum }}</span>
        <span class="req-id">{{ logsStore.curRequestId }}</span>
        <span v-if="curReq?.title" class="req-title">{{ curReq.title }}</span>
      </div>

      <div class="stats-grid" v-if="curReq">
        <div class="all-badges">
          <span class="sbadge" :class="'s-' + curReq.status">{{ statusLabel(curReq.status) }}</span>
          <span class="sbadge s-time"><span class="sbl">耗时</span><b>{{ curReq.endTime ? fmtMs(curReq.endTime - curReq.startTime) : '…' }}</b></span>
          <span v-if="curReq.ttft" class="sbadge s-ttft"><span class="sbl">TTFT</span><b>⚡️{{ fmtMs(curReq.ttft) }}</b></span>
          <span v-if="curReq.cursorApiTime" class="sbadge s-api"><span class="sbl">API耗时</span><b>{{ fmtMs(curReq.cursorApiTime) }}</b></span>
          <!-- <span v-if="curReq.stream" class="sbadge s-stream">Stream</span> -->
          <span v-if="curReq.retryCount > 0" class="sbadge s-retry">重试{{ curReq.retryCount }}</span>
          <span v-if="curReq.continuationCount > 0" class="sbadge s-cont">续写{{ curReq.continuationCount }}</span>
          <span class="sbadge sm-badge"><span class="sm-l">模型</span><b>{{ shortModel(curReq.model) }}</b></span>
          <span class="sbadge sm-badge"><span class="sm-l">格式</span><b :class="'fmt-' + curReq.apiFormat">{{ curReq.apiFormat.toUpperCase() }}</b></span>
          <span class="sbadge sm-badge"><span class="sm-l">消息数</span><b>{{ curReq.messageCount }}</b></span>
          <span class="sbadge sm-badge"><span class="sm-l">响应</span><b>{{ fmtN(curReq.responseChars) }}</b>chars</span>
          <span v-if="curReq.inputTokens" class="sbadge sm-badge"><span class="sm-l">↑ Cursor tokens</span><b>{{ fmtN(curReq.inputTokens) }}</b></span>
          <span v-if="curReq.outputTokens" class="sbadge sm-badge"><span class="sm-l">↓ Cursor tokens</span><b>{{ fmtN(curReq.outputTokens) }}</b></span>
          <!-- <span v-if="curReq.toolCount > 0" class="sbadge sm-badge"><span class="sm-l">工具定义</span><b>{{ curReq.toolCount }}</b>个</span> -->
          <span v-if="curReq.toolCallsDetected > 0" class="sbadge sm-badge"><span class="sm-l">工具调用</span><b>{{ curReq.toolCallsDetected }}</b>次</span>
          <span v-if="curReq.thinkingChars > 0" class="sbadge sm-badge"><span class="sm-l">Thinking</span><b>{{ fmtN(curReq.thinkingChars) }}</b>chars</span>
          <span v-if="curReq.stopReason" class="sbadge sm-badge"><span class="sm-l">停止原因</span><b>{{ curReq.stopReason }}</b></span>
          <span v-if="curReq.statusReason" class="sbadge sm-badge sm-deg"><span class="sm-l">降级原因</span><b>{{ curReq.statusReason }}</b></span>
          <span v-if="curReq.error" class="sbadge sm-badge sm-err"><span class="sm-l">错误</span><b>{{ curReq.error }}</b></span>
        </div>
      </div>

      <PhaseTimeline :summary="curReq" />

      <div class="tabs-row">
        <div class="tabs">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="tab-btn"
            :class="{ active: activeTab === tab.key }"
            @click="activeTab = tab.key"
          >{{ tab.label }}</button>
        </div>
        <div class="tab-tools" v-if="activeTab !== 'logs'">
          <button
            class="preview-btn"
            :class="{ active: mdPreview }"
            @click="mdPreview = !mdPreview"
            title="Markdown 预览"
          >MD 预览</button>
        </div>
      </div>

      <div class="tab-content">
        <LogList v-show="activeTab === 'logs'" />
        <PayloadView v-show="activeTab !== 'logs'" :mode="activeTab as 'request' | 'prompts' | 'response'" :mdPreview="mdPreview" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useLogsStore } from '../stores/logs';
import { storeToRefs } from 'pinia';
import PhaseTimeline from './PhaseTimeline.vue';
import LogList from './LogList.vue';
import PayloadView from './PayloadView.vue';

const logsStore = useLogsStore();
const { reqs, curRequestId } = storeToRefs(logsStore);

const tabs = [
  { key: 'logs',     label: '📋 日志' },
  { key: 'request',  label: '📥 请求参数' },
  { key: 'prompts',  label: '💬 提示词对比' },
  { key: 'response', label: '📤 响应内容' },
] as const;

type TabKey = typeof tabs[number]['key'];
const activeTab = ref<TabKey>('logs');
const mdPreview = ref(false);

const curReq = computed(() =>
  reqs.value.find(r => r.requestId === curRequestId.value)
);

const seqNum = computed(() => {
  const idx = reqs.value.findIndex(r => r.requestId === curRequestId.value);
  return idx < 0 ? '' : '#' + (reqs.value.length - idx);
});

function statusLabel(status?: string): string {
  const map: Record<string, string> = {
    success: '成功', degraded: '降级', error: '错误', processing: '处理中', intercepted: '已拦截',
  };
  return status ? (map[status] ?? status) : '';
}

function shortModel(model: string): string {
  return model.split('/').pop() ?? model;
}

function fmtN(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? (ms / 1000).toFixed(2).replace(/\.?0+$/, '') + 's' : ms + 'ms';
}
</script>

<style scoped>
.detail-panel {
  flex: 1; display: flex; flex-direction: column;
  overflow: hidden; background: var(--bg);
}
.no-select {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  color: var(--text-muted); gap: 6px;
}
.no-select .ic { font-size: 32px; }
.no-select p { font-size: 14px; }
.no-select .sub { font-size: 12px; }

.detail-header {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 14px; border-bottom: 1px solid var(--border); flex-shrink: 0;
  font-size: 12px; font-weight: 600; color: var(--text);
}
.req-seq { font-family: var(--mono); font-size: 11px; font-weight: 700; color: var(--blue); flex-shrink: 0; }
.req-id { font-family: var(--mono); font-size: 10px; color: var(--text-muted); flex-shrink: 0; }
.req-title { font-size: 12px; font-weight: 500; color: var(--text); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.req-badge {
  font-size: 10px; padding: 2px 8px; border-radius: 10px;
  background: var(--pill-bg); color: var(--text-muted); flex-shrink: 0;
}
.req-badge.success { background: color-mix(in srgb, var(--green) 15%, transparent); color: var(--green); border: 1px solid color-mix(in srgb, var(--green) 30%, transparent); }
.req-badge.error { background: color-mix(in srgb, var(--red) 15%, transparent); color: var(--red); border: 1px solid color-mix(in srgb, var(--red) 30%, transparent); }
.req-badge.processing { background: color-mix(in srgb, var(--yellow) 15%, transparent); color: var(--yellow); border: 1px solid color-mix(in srgb, var(--yellow) 30%, transparent); }
.req-badge.intercepted { background: color-mix(in srgb, var(--pink) 15%, transparent); color: var(--pink); border: 1px solid color-mix(in srgb, var(--pink) 30%, transparent); }
.req-dur { font-size: 11px; color: var(--text-muted); flex-shrink: 0; font-family: var(--mono); }

.stats-grid {
  border-bottom: 1px solid var(--border); flex-shrink: 0;
  padding: 8px 12px 8px;
}
.all-badges {
  display: flex; flex-wrap: wrap; gap: 4px;
}
.sbadge {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 10px; font-weight: 600; padding: 3px 8px;
  border-radius: 6px; background: var(--pill-bg);
  border: 1px solid var(--border-faint);
  color: var(--text-muted);
}
.sbadge .sbl { font-weight: 400; opacity: .7; }
.sbadge b { font-family: var(--mono); font-weight: 700; }
/* 状态颜色 */
.sbadge.s-success { background: color-mix(in srgb, var(--green) 15%, transparent); color: var(--green); border-color: color-mix(in srgb, var(--green) 25%, transparent); }
.sbadge.s-degraded { background: color-mix(in srgb, var(--orange) 15%, transparent); color: var(--orange); border-color: color-mix(in srgb, var(--orange) 25%, transparent); }
.sbadge.s-error { background: color-mix(in srgb, var(--red) 15%, transparent); color: var(--red); border-color: color-mix(in srgb, var(--red) 25%, transparent); }
.sbadge.s-processing { background: color-mix(in srgb, var(--yellow) 15%, transparent); color: var(--yellow); border-color: color-mix(in srgb, var(--yellow) 25%, transparent); }
.sbadge.s-intercepted { background: color-mix(in srgb, #c084fc 15%, transparent); color: #c084fc; border-color: color-mix(in srgb, #c084fc 25%, transparent); }
/* 时间指标颜色 */
.sbadge.s-time { color: var(--text); background: var(--bg1); border-color: var(--border); }
.sbadge.s-ttft { color: var(--cyan); background: color-mix(in srgb, var(--cyan) 15%, transparent); border-color: color-mix(in srgb, var(--cyan) 25%, transparent); }
.sbadge.s-api { color: var(--purple); background: color-mix(in srgb, var(--purple) 15%, transparent); border-color: color-mix(in srgb, var(--purple) 25%, transparent); }
.sbadge.s-stream { color: var(--green); background: color-mix(in srgb, var(--green) 15%, transparent); border-color: color-mix(in srgb, var(--green) 25%, transparent); }
.sbadge.s-retry { color: var(--yellow); background: color-mix(in srgb, var(--yellow) 15%, transparent); border-color: color-mix(in srgb, var(--yellow) 25%, transparent); }
.sbadge.s-cont { color: var(--blue); background: color-mix(in srgb, var(--blue) 15%, transparent); border-color: color-mix(in srgb, var(--blue) 25%, transparent); }

/* 元信息标签 */
.sm-l { font-size: 9px; color: var(--text-muted); opacity: .8; }
.sbadge.sm-badge b { color: var(--text); }
.fmt-anthropic { color: var(--purple) !important; }
.fmt-openai { color: var(--green) !important; }
.fmt-responses { color: var(--cyan) !important; }
.sm-err { border-color: color-mix(in srgb, var(--red) 30%, transparent); }
.sm-err b { color: var(--red) !important; }
.sm-deg { border-color: color-mix(in srgb, var(--orange) 30%, transparent); }
.sm-deg b { color: var(--orange) !important; }

.tabs-row {
  display: flex; align-items: center;
  border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.tabs { display: flex; flex: 1; }
.tab-btn {
  padding: 6px 14px; font-size: 12px;
  border: none; background: none; cursor: pointer;
  color: var(--text-muted); border-bottom: 2px solid transparent;
  transition: color .15s;
}
.tab-btn:hover { color: var(--text); }
.tab-btn.active { color: var(--blue); border-bottom-color: var(--blue); }

.tab-tools { padding: 0 14px; display: flex; align-items: center; gap: 6px; }
.preview-btn {
  font-size: 11px; padding: 3px 10px;
  border: 1px solid var(--border); border-radius: 4px;
  background: var(--bg); color: var(--text-muted); cursor: pointer; transition: all .15s;
}
.preview-btn:hover { border-color: var(--blue); color: var(--blue); }
.preview-btn.active { background: var(--blue); border-color: var(--blue); color: #fff; }

.tab-content { flex: 1; overflow: hidden; display: flex; flex-direction: column; }

/* 亮色皮肤增强对比度 */
[data-theme="light"] .detail-panel { background: #f7f9fc; }
[data-theme="light"] .detail-header { background: #fff; }
[data-theme="light"] .stats-grid { background: #fff; }
/* 仅 sm-badge（元信息）用灰底，状态色 badge 保留 color-mix 彩色背景 */
[data-theme="light"] .sbadge.sm-badge { background: #f0f4f8; border-color: #e2e8f0; }
[data-theme="light"] .sbadge.s-time { background: #fff; border-color: #e2e8f0; }
[data-theme="light"] .sm-badge b { color: #1e293b; }
[data-theme="light"] .tabs-row { background: #fff; }

/* 暗色皮肤层次感 */
[data-theme="dark"] .detail-header { background: var(--bg1); }
[data-theme="dark"] .stats-grid { background: var(--bg1); }
[data-theme="dark"] .tabs-row { background: var(--bg1); border-top: 1px solid var(--border); }
</style>
