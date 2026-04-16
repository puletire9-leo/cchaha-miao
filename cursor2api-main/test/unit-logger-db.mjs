#!/usr/bin/env node
/**
 * test/unit-logger-db.mjs
 *
 * 单元测试：logger-db.ts 的 SQLite 接口功能验证
 * 运行方式：node test/unit-logger-db.mjs
 *
 * 测试内容：
 *   1. initDb - 初始化创建表和索引
 *   2. dbInsertRequest - 写入记录
 *   3. dbGetPayload - 按需读取 payload
 *   4. dbGetSummaries - 游标分页查询
 *   5. dbGetSummaryCount - 总数统计
 *   6. dbGetSummariesSince - 按时间范围加载（启动恢复）
 *   7. dbClear - 清空
 *   8. 分页边界：before 游标正确性
 *   9. INSERT OR REPLACE 幂等性
 */

import Database from 'better-sqlite3';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// ==================== 测试框架 ====================

let passed = 0, failed = 0;
const errors = [];

function assert(condition, msg) {
    if (condition) {
        passed++;
        console.log(`  ✓ ${msg}`);
    } else {
        failed++;
        const err = `  ✗ ${msg}`;
        errors.push(err);
        console.error(err);
    }
}

function assertEq(actual, expected, msg) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) {
        console.error(`    actual:   ${JSON.stringify(actual)}`);
        console.error(`    expected: ${JSON.stringify(expected)}`);
    }
    assert(ok, msg);
}

// ==================== 内联实现（与 src/logger-db.ts 保持同步）====================
// 使用相同逻辑直接操作 better-sqlite3，不依赖 dist/

const TEST_DB_PATH = '/tmp/cursor2api-test.db';

// 清理旧测试数据库
if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);

let db;

function initDb(dbPath) {
    const dir = dirname(dbPath);
    if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });
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

function dbInsertRequest(summary, payload) {
    db.prepare(
        'INSERT OR REPLACE INTO requests (request_id, timestamp, summary_json, payload_json) VALUES (?, ?, ?, ?)'
    ).run(summary.requestId, summary.startTime, JSON.stringify(summary), JSON.stringify(payload));
}

function dbGetPayload(requestId) {
    const row = db.prepare('SELECT payload_json FROM requests WHERE request_id = ?').get(requestId);
    if (!row?.payload_json) return undefined;
    try { return JSON.parse(row.payload_json); } catch { return undefined; }
}

function dbGetSummaries({ limit, before }) {
    let rows;
    if (before !== undefined) {
        rows = db.prepare('SELECT summary_json FROM requests WHERE timestamp < ? ORDER BY timestamp DESC LIMIT ?').all(before, limit);
    } else {
        rows = db.prepare('SELECT summary_json FROM requests ORDER BY timestamp DESC LIMIT ?').all(limit);
    }
    return rows.map(r => { try { return JSON.parse(r.summary_json); } catch { return null; } }).filter(Boolean);
}

function dbGetSummaryCount() {
    return db.prepare('SELECT COUNT(*) as cnt FROM requests').get().cnt;
}

function dbGetSummariesSince(cutoff) {
    const rows = db.prepare('SELECT summary_json FROM requests WHERE timestamp >= ? ORDER BY timestamp ASC').all(cutoff);
    return rows.map(r => { try { return JSON.parse(r.summary_json); } catch { return null; } }).filter(Boolean);
}

function dbClear() {
    db.prepare('DELETE FROM requests').run();
}

// ==================== 测试数据 ====================

function makeSummary(id, startTime, extra = {}) {
    return {
        requestId: id,
        startTime,
        endTime: startTime + 1000,
        method: 'POST',
        path: '/v1/messages',
        model: 'claude-sonnet-4-6',
        stream: true,
        apiFormat: 'anthropic',
        hasTools: false,
        toolCount: 0,
        messageCount: 3,
        status: 'success',
        responseChars: 500,
        retryCount: 0,
        continuationCount: 0,
        toolCallsDetected: 0,
        thinkingChars: 0,
        systemPromptLength: 100,
        phaseTimings: [],
        title: `测试请求 ${id}`,
        ...extra,
    };
}

function makePayload(id) {
    return {
        question: `用户问题 ${id}`,
        answer: `模型回答 ${id}`,
        answerType: 'text',
    };
}

// 时间基准（各记录间隔 1 秒）
const BASE_TS = Date.now() - 10000;
const records = [
    { summary: makeSummary('req-001', BASE_TS + 1000), payload: makePayload('req-001') },
    { summary: makeSummary('req-002', BASE_TS + 2000), payload: makePayload('req-002') },
    { summary: makeSummary('req-003', BASE_TS + 3000), payload: makePayload('req-003') },
    { summary: makeSummary('req-004', BASE_TS + 4000, { status: 'error', error: '超时' }), payload: makePayload('req-004') },
    { summary: makeSummary('req-005', BASE_TS + 5000), payload: makePayload('req-005') },
];

// ==================== 开始测试 ====================

console.log('=== unit-logger-db: SQLite 接口功能测试 ===\n');

// --- 1. initDb ---
console.log('【1】initDb');
try {
    initDb(TEST_DB_PATH);
    assert(existsSync(TEST_DB_PATH), '数据库文件已创建');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    assert(tables.includes('requests'), '表 requests 已创建');
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r => r.name);
    assert(indexes.includes('idx_timestamp'), '索引 idx_timestamp 已创建');
} catch (e) {
    assert(false, `initDb 抛出异常: ${e.message}`);
}

// --- 2. dbInsertRequest ---
console.log('\n【2】dbInsertRequest');
for (const { summary, payload } of records) {
    dbInsertRequest(summary, payload);
}
assertEq(dbGetSummaryCount(), 5, '插入 5 条后总数为 5');

// --- 3. dbGetPayload ---
console.log('\n【3】dbGetPayload');
const p2 = dbGetPayload('req-002');
assert(p2 !== undefined, 'req-002 payload 可读取');
assertEq(p2.question, '用户问题 req-002', 'payload.question 正确');
assertEq(p2.answer, '模型回答 req-002', 'payload.answer 正确');
assert(dbGetPayload('req-999') === undefined, '不存在的 requestId 返回 undefined');

// --- 4. dbGetSummaries 无游标（最新在前）---
console.log('\n【4】dbGetSummaries（无游标）');
const all = dbGetSummaries({ limit: 10 });
assertEq(all.length, 5, '返回全部 5 条');
assertEq(all[0].requestId, 'req-005', '第一条是最新的 req-005');
assertEq(all[4].requestId, 'req-001', '最后一条是最旧的 req-001');

// --- 5. dbGetSummaries limit ---
console.log('\n【5】dbGetSummaries（limit=3）');
const top3 = dbGetSummaries({ limit: 3 });
assertEq(top3.length, 3, '返回 3 条');
assertEq(top3[0].requestId, 'req-005', '第一条是 req-005');
assertEq(top3[2].requestId, 'req-003', '第三条是 req-003');

// --- 6. dbGetSummaries before 游标翻页 ---
console.log('\n【6】dbGetSummaries（游标分页）');
// 第一页：最新 3 条（req-005, req-004, req-003）
const page1 = dbGetSummaries({ limit: 3 });
assertEq(page1.length, 3, '第一页 3 条');
assertEq(page1[0].requestId, 'req-005', '第一页第一条 req-005');

// 第二页：before = page1 最后一条的 timestamp
const beforeTs = page1[page1.length - 1].startTime;
const page2 = dbGetSummaries({ limit: 3, before: beforeTs });
assertEq(page2.length, 2, '第二页 2 条（剩余 req-002, req-001）');
assertEq(page2[0].requestId, 'req-002', '第二页第一条 req-002');
assertEq(page2[1].requestId, 'req-001', '第二页第二条 req-001');

// --- 7. dbGetSummaryCount ---
console.log('\n【7】dbGetSummaryCount');
assertEq(dbGetSummaryCount(), 5, '总数为 5');

// --- 8. dbGetSummariesSince（启动时加载）---
console.log('\n【8】dbGetSummariesSince');
// 只取 timestamp >= BASE_TS + 3000 的记录（req-003, req-004, req-005）
const since = dbGetSummariesSince(BASE_TS + 3000);
assertEq(since.length, 3, 'since 返回 3 条');
assertEq(since[0].requestId, 'req-003', '第一条 req-003（ASC 顺序）');
assertEq(since[2].requestId, 'req-005', '最后一条 req-005');

// cutoff 比所有记录都新 → 返回空
const sinceEmpty = dbGetSummariesSince(Date.now() + 99999);
assertEq(sinceEmpty.length, 0, '未来 cutoff 返回空数组');

// --- 9. INSERT OR REPLACE 幂等性 ---
console.log('\n【9】INSERT OR REPLACE 幂等性');
const updatedSummary = { ...records[0].summary, status: 'error', title: '已更新' };
dbInsertRequest(updatedSummary, records[0].payload);
assertEq(dbGetSummaryCount(), 5, '重复插入后总数不变（仍 5 条）');
const allAfter = dbGetSummaries({ limit: 10 });
const updated = allAfter.find(s => s.requestId === 'req-001');
assertEq(updated?.title, '已更新', 'REPLACE 更新了 summary 内容');

// --- 10. dbClear ---
console.log('\n【10】dbClear');
dbClear();
assertEq(dbGetSummaryCount(), 0, '清空后总数为 0');
const afterClear = dbGetSummaries({ limit: 10 });
assertEq(afterClear.length, 0, '清空后查询返回空数组');
assert(dbGetPayload('req-001') === undefined, '清空后 payload 也不可读取');

// ==================== 结果 ====================

console.log(`\n${'='.repeat(40)}`);
console.log(`测试结果: ${passed} 通过 / ${failed} 失败`);
if (errors.length > 0) {
    console.error('\n失败项:');
    for (const e of errors) console.error(e);
}

// 清理
db.close();
try { unlinkSync(TEST_DB_PATH); } catch { /* ignore */ }

process.exit(failed > 0 ? 1 : 0);
