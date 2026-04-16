#!/usr/bin/env node
/**
 * test/migrate-jsonl-to-sqlite.mjs
 *
 * 将现有 JSONL 日志文件迁移到 SQLite 数据库。
 * 运行方式：node test/migrate-jsonl-to-sqlite.mjs [--db ./logs/cursor2api.db] [--dir ./logs] [--dry-run]
 *
 * 选项：
 *   --db <path>      SQLite 文件路径（默认 ./logs/cursor2api.db）
 *   --dir <path>     JSONL 日志目录（默认 ./logs）
 *   --dry-run        只统计不写入
 *   --clear          写入前清空数据库已有数据
 */

import Database from 'better-sqlite3';
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

// ==================== 参数解析 ====================

const args = process.argv.slice(2);
function getArg(name) {
    const idx = args.indexOf(name);
    return idx >= 0 ? args[idx + 1] : null;
}
const DB_PATH = getArg('--db') || './logs/cursor2api.db';
const LOG_DIR = getArg('--dir') || './logs';
const DRY_RUN = args.includes('--dry-run');
const CLEAR = args.includes('--clear');

console.log('=== JSONL → SQLite 迁移工具 ===');
console.log(`日志目录: ${LOG_DIR}`);
console.log(`SQLite:   ${DB_PATH}`);
console.log(`模式:     ${DRY_RUN ? 'dry-run（只统计）' : '写入'}`);
if (CLEAR && !DRY_RUN) console.log('清空模式: 是');
console.log();

// ==================== 检查日志目录 ====================

if (!existsSync(LOG_DIR)) {
    console.error(`日志目录不存在: ${LOG_DIR}`);
    process.exit(1);
}

const jsonlFiles = readdirSync(LOG_DIR)
    .filter(f => f.startsWith('cursor2api-') && f.endsWith('.jsonl'))
    .sort();

if (jsonlFiles.length === 0) {
    console.log('未找到 JSONL 日志文件，退出。');
    process.exit(0);
}

console.log(`找到 ${jsonlFiles.length} 个 JSONL 文件:`);
for (const f of jsonlFiles) {
    const content = readFileSync(join(LOG_DIR, f), 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    console.log(`  ${f}  (${lines.length} 行)`);
}
console.log();

if (DRY_RUN) {
    let total = 0;
    for (const f of jsonlFiles) {
        const lines = readFileSync(join(LOG_DIR, f), 'utf-8').split('\n').filter(Boolean);
        total += lines.length;
    }
    console.log(`[dry-run] 共 ${total} 条记录，无写入操作。`);
    process.exit(0);
}

// ==================== 初始化 SQLite ====================

const dbDir = dirname(DB_PATH);
if (dbDir && !existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });

const db = new Database(DB_PATH);
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

if (CLEAR) {
    const { changes } = db.prepare('DELETE FROM requests').run();
    console.log(`已清空数据库（删除 ${changes} 条）`);
}

const existingCount = db.prepare('SELECT COUNT(*) as cnt FROM requests').get().cnt;
console.log(`数据库现有记录: ${existingCount} 条`);
console.log();

// ==================== 迁移 ====================

const insert = db.prepare(
    'INSERT OR IGNORE INTO requests (request_id, timestamp, summary_json, payload_json) VALUES (?, ?, ?, ?)'
);

const migrate = db.transaction((lines) => {
    let inserted = 0, skipped = 0, malformed = 0;
    for (const line of lines) {
        try {
            const record = JSON.parse(line);
            const summary = record.summary;
            if (!summary?.requestId) { malformed++; continue; }
            const result = insert.run(
                summary.requestId,
                summary.startTime || record.timestamp || Date.now(),
                JSON.stringify(summary),
                record.payload ? JSON.stringify(record.payload) : null
            );
            if (result.changes > 0) inserted++;
            else skipped++;
        } catch {
            malformed++;
        }
    }
    return { inserted, skipped, malformed };
});

let totalInserted = 0, totalSkipped = 0, totalMalformed = 0;

for (const f of jsonlFiles) {
    const content = readFileSync(join(LOG_DIR, f), 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    process.stdout.write(`迁移 ${f} (${lines.length} 行)... `);
    const { inserted, skipped, malformed } = migrate(lines);
    console.log(`插入 ${inserted}，跳过(重复) ${skipped}，格式错误 ${malformed}`);
    totalInserted += inserted;
    totalSkipped += skipped;
    totalMalformed += malformed;
}

// ==================== 结果统计 ====================

const finalCount = db.prepare('SELECT COUNT(*) as cnt FROM requests').get().cnt;

console.log();
console.log('=== 迁移完成 ===');
console.log(`插入新记录:  ${totalInserted}`);
console.log(`跳过(重复):  ${totalSkipped}`);
console.log(`格式错误:    ${totalMalformed}`);
console.log(`数据库总计:  ${finalCount} 条`);

// 验证：读取最新 5 条
console.log();
console.log('=== 验证：最新 5 条记录 ===');
const rows = db.prepare('SELECT request_id, timestamp, summary_json FROM requests ORDER BY timestamp DESC LIMIT 5').all();
for (const row of rows) {
    const s = JSON.parse(row.summary_json);
    const date = new Date(row.timestamp).toISOString();
    console.log(`  [${date}] ${row.request_id} | ${s.model || '?'} | ${s.status || '?'} | ${s.title ? s.title.slice(0, 40) : '(无标题)'}`);
}

db.close();
console.log();
console.log('完成。');
