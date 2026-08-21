'use strict';
// 编排入口：多源抓取 → 质量过滤（在各源内完成）→ 纯规则分类 → 去重 → 入库
const { loadEnv } = require('./lib/env');
loadEnv();

const fs = require('fs');
const path = require('path');
const db = require('./lib/db');
const { ruleClassify } = require('./lib/classify');
const { contentHash } = require('./lib/dedupe');
const { SOURCES } = require('./lib/sources');

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

function pickSources() {
  const wanted = (process.env.SOURCES || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!wanted.length) return SOURCES;
  return SOURCES.filter(s => wanted.indexOf(s.name) >= 0);
}

async function main() {
  const active = pickSources();
  console.log('=== 语文素材爬虫 ===');
  console.log('时间: ' + new Date().toISOString());
  console.log('数据源: ' + active.map(s => s.name).join(', '));
  console.log('模式: ' + (DRY_RUN ? 'DRY_RUN（只抓取，不写库）' : '写入数据库'));
  console.log('');

  if (!DRY_RUN) {
    db.connect();
    await db.migrate();
  }

  let runId = null;
  if (!DRY_RUN) runId = await db.logRunStart(active.map(s => s.name));

  // 1) 多源抓取（每个源独立 try/catch，单个源失败不影响整体）
  let fetched = 0;
  const raw = [];
  for (const src of active) {
    try {
      const items = await src.crawl();
      fetched += items.length;
      raw.push(...items);
    } catch (e) {
      console.error('[' + src.name + '] 源异常:', e.message);
    }
  }
  console.log('\n共抓取: ' + fetched + ' 篇');

  if (!fetched) {
    if (!DRY_RUN) await db.logRunEnd(runId, 'success', { fetched: 0, added: 0 });
    console.log('无新素材，退出。');
    return;
  }

  // 2) 纯规则分类
  const classified = raw.map(ruleClassify);

  // 3) 去重（本次运行内 + 数据库历史）并入库
  const seenHashes = new Set();
  const seenUrls = new Set();
  const results = [];
  let added = 0;
  for (const item of classified) {
    const hash = contentHash(item.content);
    if (seenHashes.has(hash) || (item.raw_url && seenUrls.has(item.raw_url))) continue;
    seenHashes.add(hash);
    if (item.raw_url) seenUrls.add(item.raw_url);

    if (!DRY_RUN) {
      const dup = await db.exists(item.raw_url, hash);
      if (dup) { console.log('  [重复] 跳过: ' + item.title.slice(0, 30)); continue; }
    }
    item.content_hash = hash;
    results.push(item);
    added++;
    if (!DRY_RUN) await db.insertMaterial(item);
  }

  if (DRY_RUN) {
    const outFile = path.join(__dirname, '..', 'outputs', 'crawl-result.json');
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(results, null, 2), 'utf-8');
    console.log('\n[DRY_RUN] 结果已写入: ' + outFile);
  }

  if (!DRY_RUN) await db.logRunEnd(runId, 'success', { fetched, added });
  console.log('\n=== 完成: 新增 ' + added + ' 条 ===');
}

main().catch(e => {
  console.error('爬虫崩溃:', e.message);
  process.exit(1);
});
