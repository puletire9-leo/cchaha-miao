<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="visible" class="overlay" @click.self="emit('close')">
        <div class="drawer">
          <div class="drawer-hdr">
            <span class="drawer-title">⚙ 配置</span>
            <button class="close-btn" @click="emit('close')">✕</button>
          </div>

          <div v-if="configStore.loading" class="drawer-loading">加载中…</div>
          <div v-else-if="!draft" class="drawer-loading">无法加载配置</div>

          <div v-else class="drawer-body">
            <!-- 基础 -->
            <Group title="基础">
              <Field label="cursor_model" desc="代理转发时使用的 Cursor 内部模型，默认 anthropic/claude-sonnet-4.6">
                <select v-model="draft.cursor_model" class="inp inp-wide">
                  <option v-for="m in MODELS" :key="m" :value="m">{{ m }}</option>
                </select>
              </Field>
              <Field label="timeout" desc="等待 Cursor API 响应的最长时间，单位秒，默认 120">
                <input v-model.number="draft.timeout" type="number" min="1" class="inp" />
              </Field>
              <Field label="max_auto_continue" desc="截断时自动续写的最大次数。默认 0（禁用），推荐由客户端（如 Claude Code）自行处理，体验更好；设为 1~3 可启用 proxy 内部续写">
                <input v-model.number="draft.max_auto_continue" type="number" min="0" class="inp" />
              </Field>
              <Field label="max_history_messages" desc="按条数裁剪历史（保留工具 few-shot 示例）。注意：条数无法反映实际 token 体积，建议改用下方的 max_history_tokens。-1 不限制">
                <input v-model.number="draft.max_history_messages" type="number" min="-1" class="inp" />
              </Field>
              <Field label="max_history_tokens" desc="按 token 数裁剪历史（推荐）。从最早消息整条删除，有助于减少超出 Cursor 上下文的概率。代码自动补偿 Cursor 后端开销（1,300 基础 + 工具 tokenizer 差异，动态计算），默认 150000，参考值 130000~170000。-1 不限制">
                <input v-model.number="draft.max_history_tokens" type="number" min="-1" class="inp" />
              </Field>
            </Group>

            <!-- 功能 -->
            <Group title="功能">
              <Field label="thinking.enabled" desc="最高优先级。跟随客户端 = 不干预（推荐）；强制关闭 = 即使客户端请求也不启用；强制开启 = 即使客户端未请求也注入">
                <SegSelect
                  :modelValue="draft!.thinking === null ? 'auto' : draft!.thinking.enabled ? 'on' : 'off'"
                  @update:modelValue="v => draft!.thinking = v === 'auto' ? null : { enabled: v === 'on' }"
                  :options="[
                    { value: 'auto', label: '跟随客户端' },
                    { value: 'off', label: '强制关闭' },
                    { value: 'on', label: '强制开启' },
                  ]" />
              </Field>
              <Field label="sanitize_response" desc="将响应中 Cursor 身份引用替换为 Claude，清洗工具可用性声明等。默认关闭，如无需伪装身份建议保持关闭（有轻微性能开销）">
                <Toggle v-model="draft.sanitize_response" />
              </Field>
            </Group>

            <!-- 压缩 -->
            <Group title="历史压缩（compression）">
              <Field label="compression.enabled" desc="默认关闭。对话过长时自动压缩早期消息，释放输出空间，防止 Cursor 上下文溢出。压缩算法会智能识别消息类型，不会破坏工具调用的 JSON 结构">
                <Toggle v-model="draft.compression.enabled" />
              </Field>
              <template v-if="draft.compression.enabled">
                <Field label="compression.level" desc="默认 1（轻度）。1=保留最近10条/早期4k chars，适合日常；2=6条/2k，适合中长对话；3=4条/1k，适合超长对话/大工具集">
                  <SegSelect v-model="draft.compression.level" :options="[
                    { value: 1, label: '1 轻度' },
                    { value: 2, label: '2 中等' },
                    { value: 3, label: '3 激进' },
                  ]" />
                </Field>
                <Field label="compression.keep_recent" desc="压缩时保留最近 N 条消息不压缩，默认由 level 决定（level 1=10条）。手动设置后会覆盖 level 的预设值">
                  <input v-model.number="draft.compression.keep_recent" type="number" min="1" class="inp" />
                </Field>
                <Field label="compression.early_msg_max_chars" desc="早期消息压缩后保留的最大字符数，默认由 level 决定（level 1=4000 chars）。手动设置后会覆盖 level 的预设值">
                  <input v-model.number="draft.compression.early_msg_max_chars" type="number" min="100" class="inp" />
                </Field>
              </template>
            </Group>

            <!-- 工具 -->
            <Group title="工具处理（tools）">
              <Field label="tools.schema_mode" desc="compact：TypeScript 风格紧凑签名，体积最小（适合工具多的场景）；full：完整 JSON Schema，工具调用最精确（默认）；names_only：只输出工具名和描述，极致省 token">
                <SegSelect v-model="draft.tools.schema_mode" :options="[
                  { value: 'full', label: 'full' },
                  { value: 'compact', label: 'compact' },
                  { value: 'names_only', label: 'names_only' },
                ]" />
              </Field>
              <Field label="tools.description_max_length" desc="工具描述截断长度。0=不截断（默认，工具理解最准确）；50=节省上下文；200=中等截断">
                <input v-model.number="draft.tools.description_max_length" type="number" min="0" class="inp" />
              </Field>
              <Field label="tools.passthrough" desc="默认 false。推荐 Roo Code / Cline 等非 Claude Code 客户端开启。跳过 few-shot 注入，直接将工具定义以原始 JSON 嵌入系统提示词，可解决「只有 read_file/read_dir」的错误">
                <Toggle v-model="draft.tools.passthrough" />
              </Field>
              <Field label="tools.disabled" desc="默认 false。完全不注入工具定义和 few-shot 示例，节省大量上下文。模型凭自身训练记忆处理工具调用，适合已内化工具格式的场景">
                <Toggle v-model="draft.tools.disabled" />
              </Field>
            </Group>

            <!-- 日志 -->
            <Group title="日志持久化（logging）">
              <Field label="logging.db_enabled" desc="SQLite 持久化（推荐）。启动时仅加载摘要，payload 按需查询，彻底避免大文件 OOM；Vue UI 支持重启后翻页查看完整历史">
                <Toggle v-model="draft.logging.db_enabled" />
              </Field>
              <template v-if="draft.logging.db_enabled">
                <Field label="logging.db_path" desc="SQLite 文件路径，默认 ./logs/cursor2api.db。Docker 部署请确保 logs 目录已挂载">
                  <input v-model="draft.logging.db_path" type="text" class="inp inp-wide" />
                </Field>
              </template>
              <Field label="logging.file_enabled" desc="JSONL 文件持久化。日志量大时（>100MB/天）建议改用 SQLite 方式">
                <Toggle v-model="draft.logging.file_enabled" />
              </Field>
              <template v-if="draft.logging.file_enabled">
                <Field label="logging.dir" desc="日志文件存储目录，默认 ./logs">
                  <input v-model="draft.logging.dir" type="text" class="inp inp-wide" />
                </Field>
                <Field label="logging.max_days" desc="超出天数的日志文件自动清理，默认 7 天">
                  <input v-model.number="draft.logging.max_days" type="number" min="1" class="inp" />
                </Field>
                <Field label="logging.persist_mode" desc="summary=仅保留问答摘要与少量元数据（默认）；compact=精简调试信息（保留更多排障细节）；full=完整持久化（体积最大，慎用）">
                  <SegSelect v-model="draft.logging.persist_mode" :options="[
                    { value: 'summary', label: 'summary' },
                    { value: 'compact', label: 'compact' },
                    { value: 'full', label: 'full' },
                  ]" />
                </Field>
              </template>
            </Group>

            <!-- 高级 -->
            <Group title="高级">
              <Field label="refusal_patterns" desc="追加到内置拒绝检测列表之后，匹配到则触发重试。每行一条正则表达式（不区分大小写），无效正则自动退化为字面量匹配。支持热重载，修改后下一次请求即生效" vertical>
                <textarea
                  v-model="refusalPatternsText"
                  class="inp textarea"
                  rows="4"
                  placeholder="每行一条正则表达式…"
                />
              </Field>
            </Group>
          </div>

          <!-- 底部操作栏 -->
          <div class="drawer-footer">
            <Transition name="fade">
              <div v-if="saveMsg" :class="['save-msg', saveMsgType]">
                <template v-if="saveMsgType === 'success'">
                  ✓ 已保存
                  <span v-if="lastChanges.length" class="changes">
                    {{ lastChanges.join(' | ') }}
                  </span>
                  <span v-else>（无变更）</span>
                </template>
                <template v-else>✗ {{ saveError }}</template>
              </div>
            </Transition>
            <div class="footer-btns">
              <button class="btn-cancel" @click="emit('close')">取消</button>
              <button class="btn-save" :disabled="configStore.saving" @click="onSave">
                {{ configStore.saving ? '保存中…' : '保存' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, computed, defineComponent, h } from 'vue';
import { useConfigStore } from '../stores/config';
import type { HotConfig } from '../types';

const MODELS = [
  'anthropic/claude-sonnet-4.6',
  'openai/gpt-5.1-codex-mini',
  'google/gemini-3-flash',
];

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ close: [] }>();

const configStore = useConfigStore();

// 本地草稿，独立编辑
const draft = ref<HotConfig | null>(null);

// refusal_patterns 用 textarea 文本表示
const refusalPatternsText = computed({
  get: () => draft.value?.refusal_patterns?.join('\n') ?? '',
  set: (v: string) => {
    if (draft.value) {
      draft.value.refusal_patterns = v.split('\n').map(s => s.trim()).filter(Boolean);
    }
  },
});

// 打开时加载配置并初始化草稿
watch(() => props.visible, async (v) => {
  if (v) {
    await configStore.load();
    draft.value = configStore.config ? JSON.parse(JSON.stringify(configStore.config)) : null;
    saveMsg.value = false;
  }
});

// 保存结果提示
const saveMsg = ref(false);
const saveMsgType = ref<'success' | 'error'>('success');
const lastChanges = ref<string[]>([]);
const saveError = ref('');

async function onSave() {
  if (!draft.value) return;
  saveMsg.value = false;
  try {
    const result = await configStore.save(draft.value);
    lastChanges.value = result.changes;
    saveMsgType.value = 'success';
    saveMsg.value = true;
    setTimeout(() => { saveMsg.value = false; }, 4000);
  } catch (e) {
    saveError.value = String(e);
    saveMsgType.value = 'error';
    saveMsg.value = true;
  }
}

// 辅助子组件：分组标题
const Group = defineComponent({
  props: { title: String },
  setup(p, { slots }) {
    return () => h('div', { class: 'cfg-group' }, [
      h('div', { class: 'cfg-group-title' }, p.title),
      slots.default?.(),
    ]);
  },
});

// 辅助子组件：字段行
const Field = defineComponent({
  props: { label: String, desc: String, vertical: Boolean },
  setup(p, { slots }) {
    return () => h('div', { class: ['cfg-field', { 'cfg-field-v': p.vertical }] }, [
      h('div', { class: 'cfg-label-wrap' }, [
        h('code', { class: 'cfg-key' }, p.label),
        p.desc ? h('span', { class: 'cfg-desc' }, p.desc) : null,
      ]),
      h('div', { class: 'cfg-ctrl' }, slots.default?.()),
    ]);
  },
});

// 辅助子组件：开关
const Toggle = defineComponent({
  props: { modelValue: Boolean },
  emits: ['update:modelValue'],
  setup(p, { emit: emitToggle }) {
    return () => h('div', { class: 'toggle-wrap' }, [
      h('button', {
        class: ['seg-btn', { active: !p.modelValue }],
        onClick: () => emitToggle('update:modelValue', false),
      }, '关闭'),
      h('button', {
        class: ['seg-btn', { active: p.modelValue }],
        onClick: () => emitToggle('update:modelValue', true),
      }, '开启'),
    ]);
  },
});

// 辅助子组件：分段选择器
const SegSelect = defineComponent({
  props: { modelValue: [String, Number], options: Array as () => Array<{ value: string|number; label: string }> },
  emits: ['update:modelValue'],
  setup(p, { emit: emitSeg }) {
    return () => h('div', { class: 'seg-wrap' },
      p.options?.map(opt => h('button', {
        class: ['seg-btn', { active: p.modelValue === opt.value }],
        onClick: () => emitSeg('update:modelValue', opt.value),
      }, opt.label))
    );
  },
});
</script>

<style>
/* 遮罩 */
.overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0,0,0,.45);
  display: flex; justify-content: flex-end;
}

/* 抽屉 */
.drawer {
  width: 650px; height: 100%;
  background: var(--bg1);
  border-left: 1px solid var(--border);
  display: flex; flex-direction: column;
  overflow: hidden;
}

/* 动画 */
.drawer-enter-active, .drawer-leave-active { transition: transform .25s ease; }
.drawer-enter-from .drawer, .drawer-leave-to .drawer { transform: translateX(100%); }

/* Header */
.drawer-hdr {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.drawer-title { font-weight: 700; font-size: 14px; color: var(--text); }
.close-btn {
  background: none; border: none; cursor: pointer;
  color: var(--text-muted); font-size: 14px; padding: 2px 6px;
  border-radius: 4px;
}
.close-btn:hover { color: var(--text); background: var(--hover-bg); }

/* 加载 */
.drawer-loading { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--text-muted); font-size: 13px; }

/* body 滚动区 */
.drawer-body { flex: 1; overflow-y: auto; padding: 0 0 16px; }

/* 分组 */
.cfg-group {
  border: 1px solid var(--border);
  border-radius: 8px;
  margin: 10px 12px 0;
  overflow: hidden;
}
.cfg-group-title {
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .6px; color: var(--accent);
  padding: 8px 14px 7px;
  background: color-mix(in srgb, var(--accent) 6%, var(--bg2));
  border-bottom: 1px solid var(--border);
}

/* 字段行 */
.cfg-field {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 14px; gap: 10px; min-height: 46px;
  border-bottom: 1px solid var(--border-faint);
}
.cfg-field:last-child { border-bottom: none; }
.cfg-field-v { flex-direction: column; align-items: stretch; min-height: unset; }
.cfg-label-wrap { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
.cfg-key {
  font-family: var(--mono, monospace); font-size: 12px; font-weight: 600;
  color: var(--text); background: none; padding: 0; border: none;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cfg-desc { font-size: 11px; color: var(--text-muted); line-height: 1.4; white-space: normal; }
.cfg-field-v .cfg-label-wrap { margin-bottom: 6px; }
.cfg-ctrl { display: flex; align-items: center; flex-shrink: 0; }

/* 输入控件 */
.inp {
  background: var(--bg2); border: 1px solid var(--border);
  border-radius: 6px; color: var(--text);
  font-size: 12px; padding: 4px 8px;
  outline: none; min-width: 0;
}
select.inp { cursor: pointer; }
input.inp { width: 90px; text-align: center; }
input[type="text"].inp { width: 160px; text-align: left; }
.inp-wide { width: 200px; }
input[type="text"].inp-wide { width: 200px; }
.inp:focus { border-color: var(--accent); }
.textarea { width: 100%; resize: vertical; font-family: var(--mono, monospace); box-sizing: border-box; }

/* 分段选择器 */
.seg-wrap, .toggle-wrap {
  display: flex; border: 1px solid var(--border);
  border-radius: 6px; overflow: hidden; flex-shrink: 0;
}
.seg-btn {
  padding: 4px 10px; font-size: 11px; cursor: pointer;
  background: var(--bg2); color: var(--text-muted);
  border: none; border-right: 1px solid var(--border);
  transition: all .15s; white-space: nowrap;
}
.seg-btn:last-child { border-right: none; }
.seg-btn.active { background: var(--accent); color: #fff; font-weight: 600; }
.seg-btn:not(.active):hover { background: var(--hover-bg); color: var(--text); }

/* Footer */
.drawer-footer {
  border-top: 1px solid var(--border);
  padding: 10px 16px; flex-shrink: 0;
}
.footer-btns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.btn-cancel {
  padding: 5px 14px; border-radius: 6px;
  border: 1px solid var(--border); background: var(--bg2);
  color: var(--text-muted); font-size: 12px; cursor: pointer;
}
.btn-cancel:hover { border-color: var(--text-muted); color: var(--text); }
.btn-save {
  padding: 5px 14px; border-radius: 6px;
  border: none; background: var(--accent);
  color: #fff; font-size: 12px; cursor: pointer; font-weight: 600;
}
.btn-save:disabled { opacity: .5; cursor: not-allowed; }
.btn-save:not(:disabled):hover { filter: brightness(1.1); }

/* 保存提示 */
.restart-notice {
  font-size: 11px; padding: 5px 8px; margin-bottom: 4px;
  border-radius: 6px; color: var(--yellow);
  background: color-mix(in srgb, var(--yellow) 10%, transparent);
}
.save-msg {
  font-size: 11px; padding: 5px 8px;
  border-radius: 6px; word-break: break-all;
}
.save-msg.success { background: color-mix(in srgb, var(--green) 12%, transparent); color: var(--green); }
.save-msg.error { background: color-mix(in srgb, var(--red) 12%, transparent); color: var(--red); }
.changes { margin-left: 6px; opacity: .75; }

/* fade 过渡 */
.fade-enter-active, .fade-leave-active { transition: opacity .2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
