export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogSource = 'Handler' | 'OpenAI' | 'Cursor' | 'Auth' | 'System' | 'Converter';
export type LogPhase =
  | 'receive' | 'auth' | 'convert' | 'intercept' | 'send'
  | 'response' | 'refusal' | 'retry' | 'truncation' | 'continuation'
  | 'thinking' | 'toolparse' | 'sanitize' | 'stream' | 'complete' | 'error';

export interface LogEntry {
  id: string;
  requestId: string;
  timestamp: number;
  level: LogLevel;
  source: LogSource;
  phase: LogPhase;
  message: string;
  details?: unknown;
  duration?: number;
}

export interface PhaseTiming {
  phase: LogPhase;
  label: string;
  startTime: number;
  endTime?: number;
  duration?: number;
}

export interface RequestSummary {
  requestId: string;
  startTime: number;
  endTime?: number;
  method: string;
  path: string;
  model: string;
  stream: boolean;
  apiFormat: 'anthropic' | 'openai' | 'responses';
  hasTools: boolean;
  toolCount: number;
  messageCount: number;
  status: 'processing' | 'success' | 'degraded' | 'error' | 'intercepted';
  responseChars: number;
  retryCount: number;
  continuationCount: number;
  stopReason?: string;
  error?: string;
  statusReason?: string;
  issueTags?: string[];
  toolCallsDetected: number;
  ttft?: number;
  cursorApiTime?: number;
  phaseTimings: PhaseTiming[];
  thinkingChars: number;
  systemPromptLength: number;
  inputTokens?: number;
  outputTokens?: number;
  title?: string;
}

export interface Stats {
  totalRequests: number;
  successCount: number;
  degradedCount: number;
  errorCount: number;
  avgResponseTime: number;
  avgTTFT: number;
}

/** 可热重载的配置（snake_case，对应 yaml 键名） */
export interface HotConfig {
  cursor_model: string;
  timeout: number;
  max_auto_continue: number;
  max_history_messages: number;
  max_history_tokens: number;
  thinking: { enabled: boolean } | null;
  compression: { enabled: boolean; level: 1 | 2 | 3; keep_recent: number; early_msg_max_chars: number };
  tools: { schema_mode: 'compact' | 'full' | 'names_only'; description_max_length: number; passthrough?: boolean; disabled?: boolean };
  sanitize_response: boolean;
  refusal_patterns: string[];
  logging: { file_enabled: boolean; dir: string; max_days: number; persist_mode: 'compact' | 'full' | 'summary'; db_enabled: boolean; db_path: string };
}

export interface SaveConfigResult {
  ok: boolean;
  changes: string[];
}

/** 对应后端 RequestPayload */
export interface Payload {
  // 原始请求
  originalRequest?: unknown;
  systemPrompt?: string;
  messages?: Array<{ role: string; contentPreview: string; contentLength: number; hasImages?: boolean }>;
  tools?: Array<{ name: string; description?: string }>;
  // 转换后请求
  cursorRequest?: unknown;
  cursorMessages?: Array<{ role: string; contentPreview: string; contentLength: number }>;
  // 摘要字段
  question?: string;
  answer?: string;
  answerType?: string;
  toolCallNames?: string[];
  // 模型响应
  rawResponse?: string;
  finalResponse?: string;
  thinkingContent?: string;
  toolCalls?: unknown[];
  retryResponses?: Array<{ attempt: number; response: string; reason: string }>;
  continuationResponses?: Array<{ index: number; response: string; dedupedLength: number }>;
}
