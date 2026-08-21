'use strict';
// 数据库层：Neon Postgres 连接 + 幂等迁移（绝不 DROP 表）+ 素材写入 + 爬取日志
const { neon } = require('@neondatabase/serverless');

let sql = null;

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('缺少 DATABASE_URL 环境变量（复制 .env.example 为 .env 并填写）');
  sql = neon(url);
  return sql;
}

function getSql() {
  return sql;
}

// 幂等迁移：CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS，不会删表/丢数据
async function migrate() {
  await sql`CREATE TABLE IF NOT EXISTS materials (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT DEFAULT '其他',
    tags JSONB DEFAULT '[]',
    source TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    raw_url TEXT DEFAULT '',
    content_hash TEXT DEFAULT '',
    created_at TEXT DEFAULT '',
    updated_at TEXT DEFAULT ''
  )`;

  // 兼容旧库缺失的列
  await sql`ALTER TABLE materials ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'approved'`;
  await sql`ALTER TABLE materials ADD COLUMN IF NOT EXISTS raw_url TEXT DEFAULT ''`;
  await sql`ALTER TABLE materials ADD COLUMN IF NOT EXISTS content_hash TEXT DEFAULT ''`;
  await sql`UPDATE materials SET status = 'approved' WHERE status IS NULL`;

  await sql`CREATE INDEX IF NOT EXISTS idx_materials_raw_url ON materials (raw_url)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_materials_content_hash ON materials (content_hash)`;

  await sql`CREATE TABLE IF NOT EXISTS crawl_runs (
    id SERIAL PRIMARY KEY,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT DEFAULT 'running',
    sources TEXT DEFAULT '',
    total_fetched INTEGER DEFAULT 0,
    total_added INTEGER DEFAULT 0,
    error TEXT DEFAULT ''
  )`;
}

function now() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// 是否已存在（按原始链接或内容 hash）
async function exists(rawUrl, hash) {
  const rows = await sql`
    SELECT id FROM materials
    WHERE (raw_url = ${rawUrl || ''} AND raw_url <> '') OR (content_hash = ${hash || ''} AND content_hash <> '')
    LIMIT 1
  `;
  return rows.length > 0;
}

// 写入一条素材（status 固定为 pending，走待审核流程）
async function insertMaterial(m) {
  const id = 'cr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  const ts = now();
  await sql`
    INSERT INTO materials (id, title, content, category, tags, source, notes, status, raw_url, content_hash, created_at, updated_at)
    VALUES (${id}, ${String(m.title || '').slice(0, 200)}, ${String(m.content || '').slice(0, 10000)}, ${m.category || '其他'},
      ${JSON.stringify(m.tags || [])}, ${m.source || ''}, ${m.notes || ''}, 'pending',
      ${m.raw_url || ''}, ${m.content_hash || ''}, ${ts}, ${ts})
    ON CONFLICT (id) DO NOTHING
  `;
  return id;
}

async function logRunStart(sources) {
  const rows = await sql`
    INSERT INTO crawl_runs (started_at, status, sources) VALUES (${now()}, 'running', ${sources.join(',')})
    RETURNING id
  `;
  return rows[0].id;
}

async function logRunEnd(id, status, data) {
  data = data || {};
  await sql`
    UPDATE crawl_runs SET finished_at = ${now()}, status = ${status},
      total_fetched = ${data.fetched || 0}, total_added = ${data.added || 0}, error = ${data.error || ''}
    WHERE id = ${id}
  `;
}

module.exports = { connect, getSql, migrate, exists, insertMaterial, logRunStart, logRunEnd, now };
