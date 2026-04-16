<template>
  <div class="timeline" v-if="summary?.phaseTimings?.length && totalDuration > 0">
    <div class="tl-row">
      <div class="pbar">
        <div
          v-for="(pt, i) in summary.phaseTimings"
          :key="pt.phase + pt.startTime"
          class="pseg"
          :style="{ flexGrow: segGrow[i], background: phaseColor(pt.phase) }"
          :title="pt.label + ': ' + fmtMs(getDur(pt))"
        >
          <span class="pl">{{ pt.label }} {{ fmtMs(getDur(pt)) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { RequestSummary, PhaseTiming, LogPhase } from '../types';

const props = defineProps<{ summary?: RequestSummary }>();

const totalDuration = computed(() => {
  const s = props.summary;
  if (!s) return 0;
  return (s.endTime ?? Date.now()) - s.startTime;
});

const PC: Record<string, string> = {
  receive: '#4a90d9', convert: '#26c6da', send: '#ab47bc',
  response: '#ab47bc', thinking: '#a855f7', refusal: '#ffa726',
  retry: '#ffa726', truncation: '#ffa726', continuation: '#ffa726',
  toolparse: '#ff7043', sanitize: '#ff7043', stream: '#66bb6a',
  complete: '#66bb6a', error: '#ef5350', intercept: '#ec407a', auth: '#78909c',
};

function phaseColor(phase: LogPhase): string {
  return PC[phase] ?? '#78909c';
}

function getDur(pt: PhaseTiming): number {
  return pt.duration ?? ((pt.endTime ?? Date.now()) - pt.startTime);
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? (ms / 1000).toFixed(2).replace(/\.?0+$/, '') + 's' : ms + 'ms';
}

// 对数压缩：让短段也能有足够宽度显示文字
// 用 log(dur+1) 作为 flex-grow，再与纯比例混合，取加权平均
const segGrow = computed(() => {
  const timings = props.summary?.phaseTimings ?? [];
  if (!timings.length) return [];
  const durs = timings.map(pt => Math.max(1, getDur(pt)));
  const total = durs.reduce((a, b) => a + b, 0);
  // 对数值
  const logs = durs.map(d => Math.log(d + 1));
  const logTotal = logs.reduce((a, b) => a + b, 0);
  // 混合比例：50% 对数 + 50% 线性，让短段不太窄、长段不太宽
  return durs.map((d, i) => {
    const linear = d / total;
    const log = logs[i] / logTotal;
    return Math.max(0.05, linear * 0.5 + log * 0.5);
  });
});
</script>

<style scoped>
.timeline { padding: 4px 14px 6px; flex-shrink: 0; }

.tl-row { display: flex; align-items: stretch; gap: 6px; }

.pbar {
  flex: 1;
  display: flex;
  height: 22px;
  border-radius: 5px;
  gap: 2px;
  overflow: hidden;
  min-width: 0;
}

.pseg {
  position: relative;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  min-width: 0;
  overflow: hidden;
  border-radius: 3px;
  cursor: default;
  font-size: 10px;
}

.pl {
  font-size: 10px;
  font-weight: 600;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0,0,0,0.45);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  user-select: none;
  text-align: center;
}
[data-theme="light"] .pl {
  color: rgba(255,255,255,0.95);
  text-shadow: 0 1px 4px rgba(0,0,0,0.55);
}
</style>
