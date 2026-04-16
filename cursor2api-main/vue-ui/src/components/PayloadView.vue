<template>
  <div class="payload-view">
    <div v-if="!logsStore.payload && !logsStore.curRequestId" class="empty">
      <div class="ic">📭</div><p>暂无数据</p>
    </div>
    <div v-else-if="!logsStore.payload" class="loading-placeholder">
      <div class="loading-bar" />
    </div>

    <!-- 请求参数 tab -->
    <template v-else-if="mode === 'request'">
      <Section v-if="curReq" title="📋 请求概要">
        <CodeBlock lang="json" :content="fmt({ method: curReq.method, path: curReq.path, model: curReq.model, stream: curReq.stream, apiFormat: curReq.apiFormat, messageCount: curReq.messageCount, toolCount: curReq.toolCount, hasTools: curReq.hasTools })" />
      </Section>

      <Section v-if="logsStore.payload.tools?.length" :title="`🔧 工具定义`" :count="logsStore.payload.tools.length" count-unit="个">
        <ToolItem v-for="t in logsStore.payload.tools" :key="t.name" :tool="t" />
      </Section>

      <Section v-if="logsStore.payload.cursorRequest" title="🔄 Cursor 请求（转换后）">
        <CodeBlock lang="json" :content="fmt(logsStore.payload.cursorRequest)" />
      </Section>

      <Section v-if="logsStore.payload.cursorMessages?.length"
        :title="`📨 Cursor 消息列表`" :count="logsStore.payload.cursorMessages.length" count-unit="条">
        <template #extra>
          <div class="msg-search-wrap" @click.stop>
            <input v-model="cursorMsgSearch" class="msg-search" placeholder="搜索消息…" />
            <button v-if="cursorMsgSearch" class="msg-search-clear" @click="cursorMsgSearch = ''">✕</button>
          </div>
          <button class="toggle-all-btn" @click="cursorAllOpen = cursorAllOpen === true ? false : true">
            {{ cursorAllOpen === true ? '全部折叠' : '全部展开' }}
          </button>
        </template>
        <div v-if="cursorMsgSearch && !filteredCursorMsgs.length" class="search-empty">无匹配消息</div>
        <MsgItem v-for="({ m, i }) in filteredCursorMsgs" :key="i" :msg="m" :mdPreview="mdPreview" :index="i"
          :defaultOpen="msgDefaultOpen(logsStore.payload.cursorMessages, i, cursorAllOpen)" :highlight="cursorMsgSearch" />
      </Section>

      <div v-if="!hasRequest" class="empty"><div class="ic">📥</div><p>暂无请求数据</p></div>
    </template>

    <!-- 提示词对比 tab -->
    <template v-else-if="mode === 'prompts'">
      <!-- 转换摘要 -->
      <Section v-if="convSummary" title="🔄 转换摘要">
        <div class="conv-grid">
          <div class="cg-item"><span class="cg-l">原始工具数</span><span class="cg-v">{{ convSummary.origToolCount }}</span></div>
          <div class="cg-item"><span class="cg-l">Cursor工具数</span><span class="cg-v" style="color:var(--green)">0 <small>(嵌入消息)</small></span></div>
          <div class="cg-item"><span class="cg-l">总上下文</span><span class="cg-v">{{ convSummary.totalChars ? fmtN(convSummary.totalChars) + ' chars' : '—' }}</span></div>
          <div class="cg-item"><span class="cg-l">↑ Cursor 输入 tokens</span><span class="cg-v" style="color:var(--blue)">{{ curReq?.inputTokens ? fmtN(curReq.inputTokens) : '—' }}</span></div>
          <div class="cg-item"><span class="cg-l">原始消息数</span><span class="cg-v">{{ convSummary.origMsgCount }}</span></div>
          <div class="cg-item"><span class="cg-l">Cursor消息数</span><span class="cg-v" style="color:var(--green)">{{ convSummary.cursorMsgCount }}</span></div>
          <div class="cg-item"><span class="cg-l">工具指令占用</span><span class="cg-v">{{ convSummary.toolInstrChars > 0 ? fmtN(convSummary.toolInstrChars) + ' chars' : convSummary.origToolCount > 0 ? '嵌入#1' : 'N/A' }}</span></div>
          <div class="cg-item"><span class="cg-l">↓ Cursor 输出 tokens</span><span class="cg-v" style="color:var(--green)">{{ curReq?.outputTokens ? fmtN(curReq.outputTokens) : '—' }}</span></div>
        </div>
        <div v-if="convSummary.origToolCount > 0" class="tool-warn">
          ⚠️ Cursor API 不支持原生 tools。{{ convSummary.origToolCount }} 个工具已转为文本指令嵌入 user#1{{ convSummary.toolInstrChars > 0 ? '（约 ' + fmtN(convSummary.toolInstrChars) + ' chars）' : '' }}
        </div>
      </Section>

      <Section v-if="logsStore.payload.question"
        :title="`❓ 用户问题摘要`" :count="logsStore.payload.question.length" count-unit="chars"
        border-color="var(--orange)">
        <CodeBlock :content="logsStore.payload.question" :mdPreview="mdPreview" />
      </Section>

      <Section v-if="logsStore.payload.systemPrompt"
        :title="`🧠 System Prompt`" :count="logsStore.payload.systemPrompt.length" count-unit="chars">
        <CodeBlock :content="logsStore.payload.systemPrompt" :mdPreview="mdPreview" lang="markdown" />
      </Section>

      <Section v-if="logsStore.payload.messages?.length"
        :title="`💬 原始消息`" :count="logsStore.payload.messages.length" count-unit="条">
        <template #extra>
          <div class="msg-search-wrap" @click.stop>
            <input v-model="origMsgSearch" class="msg-search" placeholder="搜索消息…" />
            <button v-if="origMsgSearch" class="msg-search-clear" @click="origMsgSearch = ''">✕</button>
          </div>
          <button class="toggle-all-btn" @click="origAllOpen = origAllOpen === true ? false : true">
            {{ origAllOpen === true ? '全部折叠' : '全部展开' }}
          </button>
        </template>
        <div v-if="origMsgSearch && !filteredOrigMsgs.length" class="search-empty">无匹配消息</div>
        <MsgItem v-for="({ m, i }) in filteredOrigMsgs" :key="i" :msg="m" :mdPreview="mdPreview" :index="i"
          :defaultOpen="msgDefaultOpen(logsStore.payload.messages, i, origAllOpen)" :highlight="origMsgSearch" />
      </Section>

      <Section v-if="logsStore.payload.cursorMessages?.length"
        :title="`📨 Cursor 消息`" :count="logsStore.payload.cursorMessages.length" count-unit="条">
        <template #extra>
          <div class="msg-search-wrap" @click.stop>
            <input v-model="cursorMsgSearch" class="msg-search" placeholder="搜索消息…" />
            <button v-if="cursorMsgSearch" class="msg-search-clear" @click="cursorMsgSearch = ''">✕</button>
          </div>
          <button class="toggle-all-btn" @click="cursorAllOpen = cursorAllOpen === true ? false : true">
            {{ cursorAllOpen === true ? '全部折叠' : '全部展开' }}
          </button>
        </template>
        <div v-if="cursorMsgSearch && !filteredCursorMsgs.length" class="search-empty">无匹配消息</div>
        <MsgItem v-for="({ m, i }) in filteredCursorMsgs" :key="i" :msg="m" :mdPreview="mdPreview" :index="i"
          :defaultOpen="msgDefaultOpen(logsStore.payload.cursorMessages, i, cursorAllOpen)" :highlight="cursorMsgSearch" />
      </Section>

      <div v-if="!hasPrompts" class="empty"><div class="ic">💬</div><p>暂无提示词数据</p></div>
    </template>

    <!-- 响应内容 tab -->
    <template v-else-if="mode === 'response'">
      <Section v-if="logsStore.payload.answer"
        :title="logsStore.payload.answerType === 'tool_calls' ? '✅ 最终结果（工具调用摘要）' : '✅ 最终回答摘要'"
        :count="logsStore.payload.answer.length" count-unit="chars">
        <CodeBlock :content="logsStore.payload.answer" :mdPreview="mdPreview" lang="markdown" />
      </Section>

      <Section v-if="logsStore.payload.toolCallNames?.length && !logsStore.payload.toolCalls"
        :title="`🔧 工具调用名称`" :count="logsStore.payload.toolCallNames.length" count-unit="个">
        <CodeBlock :content="logsStore.payload.toolCallNames.join(', ')" />
      </Section>

      <Section v-if="logsStore.payload.thinkingContent"
        :title="`🧠 Thinking`" :count="logsStore.payload.thinkingContent.length" count-unit="chars">
        <CodeBlock :content="logsStore.payload.thinkingContent" :mdPreview="mdPreview" />
      </Section>

      <Section v-if="logsStore.payload.finalResponse"
        :title="`✅ 最终响应`" :count="logsStore.payload.finalResponse.length" count-unit="chars">
        <CodeBlock :content="logsStore.payload.finalResponse" :mdPreview="mdPreview" lang="markdown" />
      </Section>

      <Section v-if="logsStore.payload.rawResponse && logsStore.payload.rawResponse !== logsStore.payload.finalResponse"
        :title="`📡 原始响应流`" :count="logsStore.payload.rawResponse.length" count-unit="chars">
        <CodeBlock :content="logsStore.payload.rawResponse" :mdPreview="mdPreview" />
      </Section>

      <Section v-if="logsStore.payload.toolCalls?.length"
        :title="`🔧 工具调用`" :count="logsStore.payload.toolCalls.length" count-unit="个">
        <CodeBlock lang="json" :content="fmt(logsStore.payload.toolCalls)" />
      </Section>

      <Section v-if="logsStore.payload.retryResponses?.length"
        :title="`↺ 重试历史`" :count="logsStore.payload.retryResponses.length" count-unit="次">
        <div v-for="r in logsStore.payload.retryResponses" :key="r.attempt" class="retry-item">
          <div class="retry-hdr">重试 #{{ r.attempt }} — {{ r.reason }}</div>
          <CodeBlock :content="r.response.substring(0, 2000) + (r.response.length > 2000 ? '\n...' : '')" />
        </div>
      </Section>

      <Section v-if="logsStore.payload.continuationResponses?.length"
        :title="`📎 续写历史`" :count="logsStore.payload.continuationResponses.length" count-unit="次">
        <div v-for="r in logsStore.payload.continuationResponses" :key="r.index" class="retry-item">
          <div class="retry-hdr">续写 #{{ r.index }} (去重后 {{ r.dedupedLength }} chars)</div>
          <CodeBlock :content="r.response.substring(0, 2000) + (r.response.length > 2000 ? '\n...' : '')" />
        </div>
      </Section>

      <div v-if="!hasResponse" class="empty"><div class="ic">📤</div><p>暂无响应数据</p></div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, ref, h, watch } from 'vue';
import { marked } from 'marked';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import markdown from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
import { useLogsStore } from '../stores/logs';

// 配置 marked 使用 highlight.js 做代码高亮
marked.setOptions({
  async: false,
  gfm: true,
  breaks: true,
});
const renderer = new marked.Renderer();
renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
  const validLang = lang && hljs.getLanguage(lang) ? lang : null;
  const highlighted = validLang
    ? hljs.highlight(text, { language: validLang }).value
    : hljs.highlightAuto(text).value;
  return `<pre><code class="hljs${validLang ? ' language-' + validLang : ''}">${highlighted}</code></pre>`;
};
marked.use({ renderer });

const props = defineProps<{ mode: 'request' | 'prompts' | 'response'; mdPreview?: boolean }>();
const logsStore = useLogsStore();

function fmt(v: unknown): string {
  return JSON.stringify(v, null, 2);
}

function fmtN(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}

const curReq = computed(() =>
  logsStore.reqs.find(r => r.requestId === logsStore.curRequestId)
);

// 转换摘要计算
const convSummary = computed(() => {
  const p = logsStore.payload;
  const req = curReq.value;
  if (!p || !req) return null;
  const origMsgCount = p.messages?.length ?? 0;
  const cursorMsgCount = p.cursorMessages?.length ?? 0;
  const origToolCount = req.toolCount ?? 0;
  const firstCursor = p.cursorMessages?.[0];
  const firstUser = p.messages?.find(m => m.role === 'user');
  const toolInstrChars = firstCursor && firstUser
    ? Math.max(0, firstCursor.contentLength - (firstUser.contentLength ?? 0)) : 0;
  const totalChars = (p.cursorRequest as Record<string, unknown>)?.totalChars as number | undefined;
  return { origMsgCount, cursorMsgCount, origToolCount, toolInstrChars, totalChars };
});

// 消息列表展开/折叠全部控制（null = 用默认值，true/false = 强制覆盖）
const cursorAllOpen = ref<boolean | null>(null);
const origAllOpen = ref<boolean | null>(null);

function msgDefaultOpen(
  list: { contentLength: number }[],
  idx: number,
  allOpen: boolean | null
): boolean {
  if (allOpen !== null) return allOpen;
  // 最后两条默认展开
  return idx >= list.length - 2;
}

const hasRequest = computed(() =>
  !!(curReq.value || logsStore.payload?.tools?.length || logsStore.payload?.cursorRequest || logsStore.payload?.cursorMessages?.length)
);
const hasPrompts = computed(() =>
  !!(convSummary.value || logsStore.payload?.question || logsStore.payload?.systemPrompt ||
     logsStore.payload?.messages?.length || logsStore.payload?.cursorMessages?.length)
);
const hasResponse = computed(() =>
  !!(logsStore.payload?.answer || logsStore.payload?.toolCallNames?.length ||
     logsStore.payload?.thinkingContent || logsStore.payload?.finalResponse ||
     logsStore.payload?.rawResponse || logsStore.payload?.toolCalls?.length ||
     logsStore.payload?.retryResponses?.length || logsStore.payload?.continuationResponses?.length)
);

// ===== 消息搜索 =====
const cursorMsgSearch = ref('');
const origMsgSearch = ref('');

function msgMatches(m: { contentPreview: string; role: string }, q: string): boolean {
  if (!q) return true;
  const lq = q.toLowerCase();
  return m.contentPreview.toLowerCase().includes(lq) || m.role.toLowerCase().includes(lq);
}

const filteredCursorMsgs = computed(() => {
  const list = logsStore.payload?.cursorMessages ?? [];
  const q = cursorMsgSearch.value.trim();
  if (!q) return list.map((m, i) => ({ m, i }));
  return list.map((m, i) => ({ m, i })).filter(({ m }) => msgMatches(m, q));
});

const filteredOrigMsgs = computed(() => {
  const list = logsStore.payload?.messages ?? [];
  const q = origMsgSearch.value.trim();
  if (!q) return list.map((m, i) => ({ m, i }));
  return list.map((m, i) => ({ m, i })).filter(({ m }) => msgMatches(m, q));
});

// ===== 子组件 =====

// Section: 可折叠区块
const Section = defineComponent({
  props: {
    title: String,
    count: Number,
    countUnit: { type: String, default: '' },
    borderColor: { type: String, default: '' },
  },
  setup(p, { slots }) {
    const open = ref(true);
    return () => h('div', { class: 'cs', style: p.borderColor ? { borderLeft: '3px solid ' + p.borderColor, paddingLeft: '0' } : {} }, [
      h('div', {
        class: 'cs-hdr',
        onClick: () => { open.value = !open.value; },
      }, [
        h('span', { class: 'cs-arrow' }, open.value ? '▼' : '▶'),
        h('span', { class: 'cs-title' }, p.title),
        p.count != null ? h('span', { class: 'cs-cnt' }, (() => {
          const n = p.countUnit === 'chars'
            ? (p.count >= 1000 ? (p.count / 1000).toFixed(1) + 'k' : String(p.count))
            : String(p.count);
          return p.countUnit ? `${n} ${p.countUnit}` : n;
        })()) : null,
        slots.extra ? h('div', { class: 'cs-extra', onClick: (e: Event) => e.stopPropagation() }, slots.extra()) : null,
      ]),
      open.value ? h('div', { class: 'cs-body' }, slots.default?.()) : null,
    ]);
  },
});

// CodeBlock: 代码块 + 复制 + MD预览
const CodeBlock = defineComponent({
  props: {
    content: String,
    mdPreview: Boolean,
    lang: { type: String, default: '' },
  },
  setup(p) {
    const copied = ref(false);
    async function copy() {
      try {
        await navigator.clipboard.writeText(p.content ?? '');
        copied.value = true;
        setTimeout(() => { copied.value = false; }, 1500);
      } catch { /* ignore */ }
    }
    return () => {
      const content = p.content ?? '';
      if (p.mdPreview && content) {
        return h('div', { class: 'md-wrap' }, [
          h('div', {
            class: 'md-preview',
            innerHTML: marked.parse(content) as string,
          }),
          h('button', { class: 'copy-btn', onClick: copy }, copied.value ? '✓ 已复制' : '复制'),
        ]);
      }
      const lang = p.lang || '';
      let highlighted = '';
      try {
        // markdown 类型只在 mdPreview 模式下渲染，非 mdPreview 时显示原始文本
        if (lang && lang !== 'markdown' && hljs.getLanguage(lang)) {
          highlighted = hljs.highlight(content, { language: lang }).value;
        }
      } catch { highlighted = ''; }
      if (highlighted) {
        return h('div', { class: 'code-wrap' }, [
          h('pre', { class: 'code-block hljs' }, h('code', { innerHTML: highlighted })),
          h('button', { class: 'copy-btn', onClick: copy }, copied.value ? '✓ 已复制' : '复制'),
        ]);
      }
      return h('div', { class: 'code-wrap' }, [
        h('pre', { class: 'code-block' }, content),
        h('button', { class: 'copy-btn', onClick: copy }, copied.value ? '✓ 已复制' : '复制'),
      ]);
    };
  },
});

// ToolItem: 工具定义条目（默认折叠）
const ToolItem = defineComponent({
  props: {
    tool: Object as () => { name: string; description?: string },
  },
  setup(p) {
    const open = ref(false);
    return () => {
      const t = p.tool!;
      return h('div', { class: 'msg-item' }, [
        h('div', {
          class: 'msg-hdr',
          onClick: () => { open.value = !open.value; },
        }, [
          h('span', { class: 'msg-arrow' }, open.value ? '▼' : '▶'),
          h('span', { class: 'tool-name' }, t.name),
          !open.value && t.description
            ? h('span', { class: 'tool-hint' }, t.description.slice(0, 50) + (t.description.length > 50 ? '…' : ''))
            : null,
        ]),
        open.value && t.description
          ? h('div', { class: 'msg-body' }, h('pre', { class: 'code-block' }, t.description))
          : null,
      ]);
    };
  },
});

// MsgItem: 消息条目（可折叠）
const MsgItem = defineComponent({
  props: {
    msg: Object as () => { role: string; contentPreview: string; contentLength: number; hasImages?: boolean },
    mdPreview: Boolean,
    defaultOpen: { type: Boolean, default: null },
    index: { type: Number, default: -1 },
    highlight: { type: String, default: '' },
  },
  setup(p) {
    const open = ref(p.defaultOpen !== null ? p.defaultOpen : (p.msg?.contentLength ?? 0) <= 2000);
    watch(() => p.defaultOpen, (v) => { if (v !== null) open.value = v; });
    // 搜索词变化时自动展开
    watch(() => p.highlight, (v) => { if (v) open.value = true; });
    const copied = ref(false);
    async function copy() {
      try {
        await navigator.clipboard.writeText(p.msg?.contentPreview ?? '');
        copied.value = true;
        setTimeout(() => { copied.value = false; }, 1500);
      } catch { /* ignore */ }
    }
    function escapeHtml(s: string) {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function highlightText(text: string, q: string): string {
      if (!q) return escapeHtml(text);
      const escaped = escapeHtml(text);
      const escapedQ = escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return escaped.replace(new RegExp(escapedQ, 'gi'), m => `<mark class="hl">${m}</mark>`);
    }
    return () => {
      const m = p.msg!;
      const roleColors: Record<string, string> = {
        user: '#3b82f6', assistant: '#059669', system: '#7c3aed', tool: '#ea580c',
      };
      const color = roleColors[m.role] ?? '#94a3b8';
      return h('div', { class: 'msg-item' }, [
        h('div', {
          class: 'msg-hdr',
          onClick: () => { open.value = !open.value; },
        }, [
          h('span', { class: 'msg-arrow' }, open.value ? '▼' : '▶'),
          p.index >= 0 ? h('span', { class: 'msg-seq' }, `#${p.index + 1}`) : null,
          h('span', { class: 'msg-role', style: { background: color + '22', color } }, m.role),
          h('span', { class: 'msg-len' }, `${m.contentLength >= 1000 ? (m.contentLength / 1000).toFixed(1) + 'k' : m.contentLength} chars`),
          m.hasImages ? h('span', { class: 'msg-img' }, '🖼️ 含图片') : null,
          h('button', { class: 'copy-btn-sm', onClick: (e: Event) => { e.stopPropagation(); copy(); } },
            copied.value ? '✓' : '复制'),
        ]),
        open.value ? h('div', { class: 'msg-body' }, [
          p.mdPreview && !p.highlight
            ? h('div', { class: 'md-preview', innerHTML: marked.parse(m.contentPreview) as string })
            : h('pre', { class: 'code-block', innerHTML: highlightText(m.contentPreview, p.highlight ?? '') }),
        ]) : null,
      ]);
    };
  },
});
</script>

<style>
.payload-view { flex: 1; overflow-y: auto; font-size: 12px; }
.empty {
  padding: 32px; text-align: center; color: var(--text-muted);
  opacity: 0; animation: empty-appear 0s 200ms forwards;
}
@keyframes empty-appear { to { opacity: 1; } }
.empty .ic { font-size: 28px; margin-bottom: 8px; }

/* Section */
.cs { border-bottom: 1px solid var(--border-faint); }
.cs-hdr {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 14px; cursor: pointer; user-select: none;
  transition: background .1s;
  position: sticky; top: 0; z-index: 2;
  background: var(--bg1);
  border-bottom: 1px solid var(--border-faint);
}
.cs-hdr:hover { background: var(--hover-bg); }
[data-theme="light"] .cs-hdr { background: #fff; }
[data-theme="light"] .cs-hdr:hover { background: #f7f9fc; }
.cs-arrow { color: var(--text-muted); font-size: 10px; width: 10px; }
.cs-title { font-weight: 700; font-size: 11px; color: var(--blue); text-transform: uppercase; letter-spacing: .5px; }
.cs-cnt { font-size: 10px; color: var(--text-muted); background: var(--pill-bg); padding: 1px 6px; border-radius: 8px; }
.cs-body { padding: 8px 14px 12px; }

/* CodeBlock */
.code-wrap { position: relative; }
.code-block {
  margin: 0; padding: 10px 12px;
  background: var(--pill-bg); border-radius: 6px;
  font-family: var(--mono); font-size: 11px;
  white-space: pre-wrap; word-break: break-all;
  color: var(--text); max-height: 400px; overflow-y: auto;
  border: 1px solid var(--border-faint);
}
.copy-btn {
  position: absolute; top: 6px; right: 6px; font-size: 10px; padding: 2px 8px;
  background: var(--bg1); border: 1px solid var(--border);
  border-radius: 3px; cursor: pointer; color: var(--text-muted); z-index: 1;
  opacity: 0.45; transition: opacity .15s;
}
.code-wrap:hover .copy-btn { opacity: 1; }
.copy-btn:hover { color: var(--text); }

/* MD Preview */
.md-wrap { position: relative; }
.md-preview {
  padding: 10px 14px; line-height: 1.7; font-size: 13px;
  max-height: 500px; overflow-y: auto; overflow-x: hidden;
  border: 1px solid var(--border-faint); border-radius: 6px;
  background: var(--bg1); word-break: break-word;
}
/* msg-body 内的 md-preview 不加边框（已有 msg-body 容器） */
.msg-body .md-preview {
  border: none; border-radius: 0; padding: 0;
  max-height: 600px; background: transparent;
}
.md-preview h1 { margin: 14px 0 6px; font-weight: 700; font-size: 18px; }
.md-preview h2 { margin: 12px 0 6px; font-weight: 700; font-size: 15px; }
.md-preview h3 { margin: 10px 0 4px; font-weight: 600; font-size: 13px; }
.md-preview p { margin: 6px 0; }
.md-preview code {
  background: var(--pill-bg); padding: 1px 5px; border-radius: 3px;
  font-family: var(--mono); font-size: 11px;
}
.md-preview pre {
  padding: 0; border-radius: 6px; overflow-x: auto; margin: 8px 0;
}
.md-preview pre code.hljs {
  border-radius: 6px; padding: 12px 14px; font-size: 12px;
  font-family: var(--mono); display: block;
}
.md-preview pre code:not(.hljs) { background: none; padding: 0; }
.md-preview ul,.md-preview ol { padding-left: 20px; margin: 6px 0; }
.md-preview blockquote {
  border-left: 3px solid var(--blue); padding-left: 10px;
  color: var(--text-muted); margin: 8px 0;
}
.md-preview table { border-collapse: collapse; width: 100%; margin: 8px 0; }
.md-preview th,.md-preview td { border: 1px solid var(--border); padding: 4px 8px; }
.md-preview th { background: var(--pill-bg); }
.md-preview a { color: var(--blue); }

/* cs-extra slot (展开/折叠按钮区) */
.cs-extra { margin-left: auto; display: flex; align-items: center; gap: 6px; }

/* 加载占位 */
.loading-placeholder { padding: 16px 14px; }
.loading-bar {
  height: 3px; border-radius: 2px;
  background: linear-gradient(90deg, transparent 0%, var(--blue) 50%, transparent 100%);
  background-size: 200% 100%;
  animation: shimmer 1.2s ease-in-out infinite;
}
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

/* 消息搜索框容器 */
.msg-search-wrap {
  position: relative; display: flex; align-items: center;
}
.msg-search {
  height: 22px; padding: 0 22px 0 8px; font-size: 11px;
  background: var(--bg0); border: 1px solid var(--border);
  border-radius: 4px; color: var(--text); outline: none;
  width: 120px; transition: border-color .15s, width .2s;
}
.msg-search:focus { border-color: var(--blue); width: 160px; }
.msg-search::placeholder { color: var(--text-muted); }
.msg-search-clear {
  position: absolute; right: 4px;
  background: none; border: none; cursor: pointer;
  color: var(--text-muted); font-size: 12px; padding: 0 2px;
  line-height: 1; display: flex; align-items: center;
}
.msg-search-clear:hover { color: var(--text); }

/* 搜索无结果 */
.search-empty {
  padding: 8px 14px; font-size: 11px; color: var(--text-muted);
  opacity: 0; animation: empty-appear 0s 200ms forwards;
}

/* 搜索高亮 */
mark.hl {
  background: color-mix(in srgb, var(--yellow) 35%, transparent);
  color: inherit; border-radius: 2px; padding: 0 1px;
}
.toggle-all-btn {
  font-size: 10px; padding: 1px 8px;
  border: 1px solid var(--border); border-radius: 4px;
  background: var(--bg); color: var(--text-muted);
  cursor: pointer; transition: all .15s;
}
.toggle-all-btn:hover { border-color: var(--blue); color: var(--blue); }

/* Tool item — MsgItem 风格 */
.tool-item { margin-bottom: 4px; border: 1px solid var(--border-faint); border-radius: 6px; overflow: hidden; }
.tool-item:last-child { margin-bottom: 0; }
.tool-hdr {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; cursor: pointer; background: var(--pill-bg);
  transition: background .1s; user-select: none;
}
.tool-hdr:hover { background: var(--hover-bg); }
.tool-name { font-family: var(--mono); font-weight: 600; color: var(--purple); font-size: 12px; flex-shrink: 0; }
.tool-hint { font-size: 10px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.tool-body { padding: 8px 10px; background: var(--bg); font-size: 11px; color: var(--text-muted); line-height: 1.6; white-space: pre-wrap; }

/* Msg item */
.msg-item { margin-bottom: 6px; border: 1px solid var(--border-faint); border-radius: 6px; overflow: hidden; }
.msg-hdr {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; cursor: pointer; background: var(--pill-bg);
  transition: background .1s; user-select: none;
}
.msg-hdr:hover { background: var(--hover-bg); }
.msg-arrow { color: var(--text-muted); font-size: 10px; }
.msg-role { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px; }
.msg-seq { font-size: 10px; font-family: var(--mono); font-weight: 700; color: var(--blue); flex-shrink: 0; }
.msg-len { font-size: 10px; color: var(--text-muted); font-family: var(--mono); }
.msg-img { font-size: 10px; color: var(--text-muted); }
.copy-btn-sm {
  margin-left: auto; font-size: 10px; padding: 1px 6px;
  background: var(--bg); border: 1px solid var(--border);
  border-radius: 3px; cursor: pointer; color: var(--text-muted); flex-shrink: 0;
}
.copy-btn-sm:hover { color: var(--text); }
.msg-body { padding: 8px 10px; background: var(--bg); }

/* Retry */
.retry-item { margin-bottom: 10px; }
.retry-hdr { font-size: 11px; font-weight: 600; color: var(--yellow); margin-bottom: 4px; }

/* 转换摘要 */
.conv-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 8px;
}
.cg-item {
  display: flex; flex-direction: column; gap: 2px;
  padding: 6px 8px; border-radius: 6px;
  background: var(--pill-bg); border: 1px solid var(--border-faint);
}
.cg-l { font-size: 9px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .3px; }
.cg-v { font-size: 12px; font-weight: 600; font-family: var(--mono); color: var(--text); }
.cg-v small { font-size: 9px; font-weight: 400; color: var(--text-muted); }
.tool-warn {
  padding: 7px 10px; border-radius: 6px; font-size: 11px;
  background: color-mix(in srgb, var(--yellow) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--yellow) 30%, transparent);
  color: var(--yellow);
}

/* 亮色皮肤增强对比度 */
[data-theme="light"] .cs {
  background: #fff;
  border-bottom-color: #e2e8f0;
}
[data-theme="light"] .cs-hdr { border-bottom: 1px solid #f1f5f9; }
[data-theme="light"] .cs-hdr:hover { background: #f7f9fc; }
[data-theme="light"] .code-block {
  background: #f7f9fc; border-color: #e2e8f0;
  color: #1e293b;
}
[data-theme="light"] .msg-item { border-color: #cbd5e1; }
[data-theme="light"] .msg-hdr { background: #f0f4f8; }
[data-theme="light"] .msg-hdr:hover { background: #e2e8f0; }
[data-theme="light"] .msg-body { background: #fff; }
[data-theme="light"] .cg-item { background: #f7f9fc; border-color: #e2e8f0; }
[data-theme="light"] .cg-l { color: #64748b; }
[data-theme="light"] .cg-v { color: #1e293b; }
</style>
