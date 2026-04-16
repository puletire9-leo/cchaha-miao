/**
 * logger-db.ts - SQLite 持久化层
 *
 * 仅在 config.logging.db_enabled = true 时使用。
 * 与 JSONL 文件方式完全并存，互不干扰。
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
// 使用 inline 类型避免与 logger.ts 的循环依赖
// DbRequestSummary 和 DbRequestPayload 的最小结构定义（仅 logger-db 内部使用）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRequestSummary = { requestId: string; startTime: number } & Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRequestPayload = Record<string, any>;

let db: InstanceType<typeof Database> | null = null;

// ==================== 初始化 ====================

export function closeDb(): void {
    if (db) {
        db.close();
        db = null;
    }
}

export function initDb(dbPath: string): void {
    closeDb(); // 关闭旧连接（幂等，支持热重载重新初始化）
    const dir = dirname(dbPath);
    if (dir && !existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.exec(`
        CREATE TABLE IF NOT EXISTS requests (
            request_id   TEXT PRIMARY KEY,
            timestamp    INTEGER NOT NULL,
            summary_json TEXT NOT NULL,
            payload_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_timestamp ON requests(timestamp);
    `);
}

function getDb(): InstanceType<typeof Database> {
    if (!db) throw new Error('SQLite not initialized. Call initDb() first.');
    return db;
}

// ==================== 写入 ====================

export function dbInsertRequest(summary: DbRequestSummary, payload: DbRequestPayload): void {
    const stmt = getDb().prepare(
        'INSERT OR REPLACE INTO requests (request_id, timestamp, summary_json, payload_json) VALUES (?, ?, ?, ?)'
    );
    stmt.run(
        summary.requestId,
        summary.startTime,
        JSON.stringify(summary),
        JSON.stringify(payload)
    );
}

// ==================== 查询 ====================

/** 按需加载单条 payload（Web UI 点击时调用） */
export function dbGetPayload(requestId: string): DbRequestPayload | undefined {
    const row = getDb()
        .prepare('SELECT payload_json FROM requests WHERE request_id = ?')
        .get(requestId) as { payload_json: string } | undefined;
    if (!row?.payload_json) return undefined;
    try { return JSON.parse(row.payload_json) as DbRequestPayload; } catch { return undefined; }
}

export interface DbQueryOpts {
    limit: number;
    before?: number;    // timestamp < before（游标翻页）
    since?: number;     // timestamp >= since（时间范围）
    status?: string;    // 精确匹配 summary.status
    keyword?: string;   // 模糊匹配 title/model/request_id
}

/** 动态构建 WHERE 子句（参数化，防注入） */
function buildWhere(opts: Omit<DbQueryOpts, 'limit'>): { where: string; params: Record<string, unknown> } {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};
    if (opts.before !== undefined) {
        conditions.push('timestamp < :before');
        params.before = opts.before;
    }
    if (opts.since !== undefined) {
        conditions.push('timestamp >= :since');
        params.since = opts.since;
    }
    if (opts.status) {
        conditions.push("json_extract(summary_json,'$.status') = :status");
        params.status = opts.status;
    }
    if (opts.keyword) {
        conditions.push("(request_id LIKE :kw OR json_extract(summary_json,'$.title') LIKE :kw OR json_extract(summary_json,'$.model') LIKE :kw)");
        params.kw = `%${opts.keyword}%`;
    }
    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    return { where, params };
}

/**
 * 游标分页：返回最新的 limit 条，支持 status/keyword/since 后端过滤。
 * 结果按 timestamp 倒序（最新在前）。
 */
export function dbGetSummaries(opts: DbQueryOpts): DbRequestSummary[] {
    const { limit, ...filterOpts } = opts;
    const { where, params } = buildWhere(filterOpts);
    const sql = `SELECT summary_json FROM requests ${where} ORDER BY timestamp DESC LIMIT :limit`;
    const rows = getDb().prepare(sql).all({ ...params, limit }) as Array<{ summary_json: string }>;
    return rows.map(r => {
        try { return JSON.parse(r.summary_json) as DbRequestSummary; } catch { return null; }
    }).filter((s): s is DbRequestSummary => s !== null);
}

/** 返回符合过滤条件的记录总数 */
export function dbCountSummaries(opts: Omit<DbQueryOpts, 'limit' | 'before'> = {}): number {
    const { where, params } = buildWhere(opts);
    const sql = `SELECT COUNT(*) as cnt FROM requests ${where}`;
    const row = getDb().prepare(sql).get(params) as { cnt: number };
    return row.cnt;
}

/**
 * 返回各状态的计数（不含 status 过滤，仅受 keyword/since 影响）。
 * 用于状态筛选按钮上的计数显示，点击某状态后其他按钮数字不变。
 */
export function dbGetStatusCounts(opts: { keyword?: string; since?: number } = {}): Record<string, number> {
    const { where, params } = buildWhere(opts); // 不传 status，只用 keyword/since
    const sql = `SELECT json_extract(summary_json,'$.status') as status, COUNT(*) as cnt FROM requests ${where} GROUP BY status`;
    const rows = getDb().prepare(sql).all(params) as Array<{ status: string; cnt: number }>;
    const counts: Record<string, number> = { all: 0, success: 0, degraded: 0, error: 0, processing: 0, intercepted: 0 };
    for (const row of rows) {
        if (row.status) counts[row.status] = row.cnt;
        counts.all += row.cnt;
    }
    return counts;
}

/** 返回数据库中全部记录总数（无过滤） */
export function dbGetSummaryCount(): number {
    const row = getDb()
        .prepare('SELECT COUNT(*) as cnt FROM requests')
        .get() as { cnt: number };
    return row.cnt;
}

/**
 * 启动时加载：返回 timestamp >= cutoffTimestamp 的所有 summary（不含 payload）。
 * 用于恢复内存中的请求列表。
 */
export function dbGetSummariesSince(cutoffTimestamp: number): DbRequestSummary[] {
    const rows = getDb()
        .prepare('SELECT summary_json FROM requests WHERE timestamp >= ? ORDER BY timestamp ASC')
        .all(cutoffTimestamp) as Array<{ summary_json: string }>;
    return rows.map(r => {
        try { return JSON.parse(r.summary_json) as DbRequestSummary; } catch { return null; }
    }).filter((s): s is DbRequestSummary => s !== null);
}

/**
 * 聚合统计：通过 SQL 一次查询返回全量（或指定时间范围内）的 stats。
 * 仅在 db_enabled 时调用。
 */
export function dbGetStats(since?: number): {
    totalRequests: number;
    successCount: number;
    degradedCount: number;
    errorCount: number;
    interceptedCount: number;
    processingCount: number;
    avgResponseTime: number;
    avgTTFT: number;
} {
    const where = since !== undefined ? 'WHERE timestamp >= ?' : '';
    const params = since !== undefined ? [since] : [];
    const row = getDb().prepare(`
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN json_extract(summary_json,'$.status')='success'     THEN 1 ELSE 0 END) as success,
            SUM(CASE WHEN json_extract(summary_json,'$.status')='degraded'    THEN 1 ELSE 0 END) as degraded,
            SUM(CASE WHEN json_extract(summary_json,'$.status')='error'       THEN 1 ELSE 0 END) as error,
            SUM(CASE WHEN json_extract(summary_json,'$.status')='intercepted' THEN 1 ELSE 0 END) as intercepted,
            SUM(CASE WHEN json_extract(summary_json,'$.status')='processing'  THEN 1 ELSE 0 END) as processing,
            AVG(CASE WHEN json_extract(summary_json,'$.endTime') IS NOT NULL
                THEN json_extract(summary_json,'$.endTime') - timestamp END) as avgTime,
            AVG(CASE WHEN json_extract(summary_json,'$.ttft') IS NOT NULL
                THEN json_extract(summary_json,'$.ttft') END) as avgTTFT
        FROM requests ${where}
    `).get(...params) as {
        total: number; success: number; degraded: number; error: number;
        intercepted: number; processing: number; avgTime: number | null; avgTTFT: number | null;
    };
    return {
        totalRequests:    row.total      ?? 0,
        successCount:     row.success    ?? 0,
        degradedCount:    row.degraded   ?? 0,
        errorCount:       row.error      ?? 0,
        interceptedCount: row.intercepted ?? 0,
        processingCount:  row.processing  ?? 0,
        avgResponseTime:  row.avgTime != null ? Math.round(row.avgTime) : 0,
        avgTTFT:          row.avgTTFT != null ? Math.round(row.avgTTFT) : 0,
    };
}

// ==================== 清空 ====================

export function dbClear(): void {
    getDb().prepare('DELETE FROM requests').run();
}

// ==================== 状态 ====================

export function isDbInitialized(): boolean {
    return db !== null;
}
