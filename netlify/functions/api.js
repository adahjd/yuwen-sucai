const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
const cheerio = require('cheerio');
const sql = neon(process.env.DATABASE_URL);

async function initDB() {
  // 幂等迁移：绝不 DROP 表（旧逻辑会因 id 为 integer 而清空整表，存在丢数据风险）
  await sql`
    CREATE TABLE IF NOT EXISTS materials (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
      category TEXT DEFAULT '其他', tags JSONB DEFAULT '[]',
      source TEXT DEFAULT '', notes TEXT DEFAULT '',
      status TEXT DEFAULT 'pending', raw_url TEXT DEFAULT '', content_hash TEXT DEFAULT '',
      created_at TEXT DEFAULT '', updated_at TEXT DEFAULT ''
    )
  `;
  await sql`ALTER TABLE materials ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'approved'`;
  await sql`ALTER TABLE materials ADD COLUMN IF NOT EXISTS raw_url TEXT DEFAULT ''`;
  await sql`ALTER TABLE materials ADD COLUMN IF NOT EXISTS content_hash TEXT DEFAULT ''`;
  await sql`UPDATE materials SET status = 'approved' WHERE status IS NULL`;
}

var initialized = false;

// ===== Mini crawler =====
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchJson(url, extraHeaders) {
  var headers = Object.assign({
    'User-Agent': UA,
    'Accept': 'application/json',
    'Accept-Language': 'zh-CN,zh;q=0.9'
  }, extraHeaders || {});
  try {
    var res = await fetch(url, { headers: headers });
    if (!res.ok) return null;
    return await res.json();
  } catch(e) { return null; }
}

function extractText(raw) {
  if (!raw) return '';
  if (raw.trim().startsWith('{')) {
    try {
      var delta = JSON.parse(raw);
      var ops = delta.ops || [];
      var text = '';
      for (var i = 0; i < ops.length; i++) {
        var ins = ops[i].insert;
        if (typeof ins === 'string') text += ins;
      }
      return text.replace(/\n{3,}/g, '\n\n').trim();
    } catch(e) {}
  }
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function quickClassify(item) {
  var txt = (item.title + ' ' + item.content).toLowerCase();
  var tags = [];
  var rules = [
    { c: '名言警句', k: ['名言', '格言', '警句', '金句'] },
    { c: '诗词名句', k: ['诗', '词', '唐诗', '宋词', '李白', '杜甫'] },
    { c: '人物事例', k: ['人物', '事例', '事迹', '榜样', '英雄'] },
    { c: '时事热点', k: ['热点', '新闻', '事件', '科技', 'ai'] },
    { c: '哲理故事', k: ['哲理', '寓言', '启示', '道理'] },
    { c: '优美段落', k: ['优美', '描写', '段落', '散文', '排比'] },
    { c: '好词好句', k: ['好词', '好句', '成语', '摘抄', '佳句'] }
  ];
  var cat = '其他';
  for (var i = 0; i < rules.length; i++) {
    if (rules[i].k.some(function(k) { return txt.indexOf(k) >= 0; })) { cat = rules[i].c; break; }
  }
  ['高考', '作文', '素材', '写作', '语文'].forEach(function(t) {
    if (txt.indexOf(t) >= 0 && tags.indexOf(t) < 0) tags.push(t);
  });
  return { category: cat, tags: tags.slice(0, 5) };
}

// ===== 快速爬取（人民网 + 作文网；B站海外被屏蔽，故按钮不抓它）=====
function decodeHtml(buf) {
  var head = new TextDecoder('latin1').decode(buf.slice(0, 1500));
  var m = head.match(/charset=["']?([a-zA-Z0-9_-]+)/i);
  var cs = m ? m[1].toLowerCase() : '';
  if (cs.indexOf('gb') >= 0 || cs.indexOf('2312') >= 0) return new TextDecoder('gbk').decode(buf);
  return new TextDecoder('utf-8').decode(buf);
}

async function fetchBuf(url) {
  try {
    var res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' } });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch (e) { return null; }
}

async function quickCrawl() {
  var items = [];
  var seen = {};

  async function addMaterial(title, content, category, tags, source, url) {
    if (!title || !content || content.length < 120) return;
    var hash = crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
    var existing = await sql`SELECT id FROM materials WHERE content_hash = ${hash} OR (raw_url = ${url} AND raw_url <> '') LIMIT 1`;
    if (existing.length > 0) return;
    var id = 'cr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    var ts = now();
    await sql`
      INSERT INTO materials (id, title, content, category, tags, source, notes, status, raw_url, content_hash, created_at, updated_at)
      VALUES (${id}, ${title.slice(0, 200)}, ${content.slice(0, 5000)}, ${category}, ${JSON.stringify(tags)},
        ${source}, ${'爬取|' + url}, 'pending', ${url}, ${hash}, ${ts}, ${ts})
      ON CONFLICT (id) DO NOTHING
    `;
    items.push({ title: title, len: content.length });
  }

  // ① 人民网观点（时事热点）
  try {
    var listBuf = await fetchBuf('http://opinion.people.com.cn/');
    if (listBuf) {
      var $ = cheerio.load(new TextDecoder('utf-8').decode(listBuf));
      var links = [];
      $('a[href]').each(function () {
        var h = $(this).attr('href') || '';
        if (/n1\/\d{4}\/\d{4}\/c\d+-\d+\.html/.test(h)) {
          var abs = /^https?:\/\//.test(h) ? h : 'http://opinion.people.com.cn' + (h.charAt(0) === '/' ? '' : '/') + h;
          if (!seen[abs]) { seen[abs] = true; links.push(abs); }
        }
      });
      for (var i = 0; i < links.length && i < 3; i++) {
        var aBuf = await fetchBuf(links[i]);
        if (!aBuf) continue;
        var a$ = cheerio.load(new TextDecoder('utf-8').decode(aBuf));
        var title = a$('h1').first().text().trim() || a$('h2').first().text().trim() || a$('title').text().trim();
        title = title.split('--')[0].split('-人民网')[0].trim();
        var content = a$('.rm_txt_con').find('p').map(function () { return a$(this).text().trim(); }).get().filter(Boolean).join('\n');
        await addMaterial(title, content, '时事热点', ['时事热点', '时评'], '人民网观点', links[i]);
      }
    }
  } catch (e) { console.error('人民网快速爬取失败:', e.message); }

  // ② 作文网（名言警句）
  try {
    var zBuf = await fetchBuf('https://www.zuowen.com/sucai/mingyan/');
    if (zBuf) {
      var z$ = cheerio.load(decodeHtml(zBuf));
      var zlinks = [];
      z$('a[href]').each(function () {
        var h = z$(this).attr('href') || '';
        if (/\/e\/\d{8}\/[a-f0-9]+\.shtml/i.test(h)) {
          var abs = /^https?:\/\//.test(h) ? h : 'https://www.zuowen.com' + (h.charAt(0) === '/' ? '' : '/') + h;
          if (!seen[abs]) { seen[abs] = true; zlinks.push(abs); }
        }
      });
      for (var j = 0; j < zlinks.length && j < 3; j++) {
        var zaBuf = await fetchBuf(zlinks[j]);
        if (!zaBuf) continue;
        var za$ = cheerio.load(decodeHtml(zaBuf));
        var ztitle = za$('h1').first().text().trim() || za$('title').text().trim().split(/[|_]/)[0].split('-作文网')[0].trim();
        var zcontent = za$('.news_con, .content, .con').first().find('p').map(function () { return za$(this).text().trim(); }).get().filter(Boolean).join('\n');
        if (zcontent.length < 120) {
          zcontent = za$('p').map(function () { return za$(this).text().trim(); }).get().filter(function (t) { return t.length > 8; }).join('\n');
        }
        await addMaterial(ztitle, zcontent, '名言警句', ['名言警句'], '作文网', zlinks[j]);
      }
    }
  } catch (e) { console.error('作文网快速爬取失败:', e.message); }

  return items;
}

// ===== Main handler =====
exports.handler = async function(event) {
  if (!initialized) { await initDB(); initialized = true; }

  var path = event.path.replace('/.netlify/functions/api', '').replace('/api', '');
  var method = event.httpMethod;

  try {
    // POST /api/crawl
    if (method === 'POST' && path === '/crawl') {
      var crawled = await quickCrawl();
      return json({ added: crawled.length, items: crawled });
    }

    // GET /api/materials
    if (method === 'GET' && path === '/materials') {
      var all = event.queryStringParameters && event.queryStringParameters.all === '1';
      var rows = all
        ? await sql`SELECT * FROM materials ORDER BY updated_at DESC`
        : await sql`SELECT * FROM materials WHERE status = 'approved' ORDER BY updated_at DESC`;
      return json(rows.map(function(r) { r.tags = parseTags(r.tags); return r; }));
    }

    // GET /api/materials/pending
    if (method === 'GET' && path === '/materials/pending') {
      var rows = await sql`SELECT * FROM materials WHERE status = 'pending' ORDER BY updated_at DESC`;
      return json(rows.map(function(r) { r.tags = parseTags(r.tags); return r; }));
    }

    // POST /api/materials/:id/approve
    if (method === 'POST' && path.endsWith('/approve')) {
      var id = path.split('/')[2];
      await sql`UPDATE materials SET status = 'approved', updated_at = ${now()} WHERE id = ${id}`;
      return json({ success: true });
    }

    // GET /api/materials/export
    if (method === 'GET' && path === '/materials/export') {
      var rows = await sql`SELECT * FROM materials ORDER BY category, updated_at DESC`;
      return json(rows.map(function(r) { r.tags = parseTags(r.tags); return r; }));
    }

    // DELETE /api/materials/:id
    if (method === 'DELETE' && path.startsWith('/materials/') && !path.endsWith('/approve')) {
      var id = path.split('/')[2];
      await sql`DELETE FROM materials WHERE id = ${id}`;
      return json({ success: true });
    }

    // POST /api/materials/clear
    if (method === 'POST' && path === '/materials/clear') {
      await sql`DELETE FROM materials`;
      return json({ success: true });
    }

    // POST /api/materials/sync
    if (method === 'POST' && path === '/materials/sync') {
      var items = JSON.parse(event.body);
      if (!Array.isArray(items)) return json({ error: 'Invalid' }, 400);
      var localIds = new Set();
      for (var i = 0; i < items.length; i++) {
        if (!items[i].id) continue;
        localIds.add(items[i].id);
        var st = items[i].status || 'approved';
        await sql`
          INSERT INTO materials (id, title, content, category, tags, source, notes, status, created_at, updated_at)
          VALUES (${items[i].id}, ${items[i].title || ''}, ${items[i].content || ''}, ${items[i].category || '其他'},
            ${JSON.stringify(items[i].tags || [])}, ${items[i].source || ''}, ${items[i].notes || ''},
            ${st}, ${items[i].created_at || ''}, ${items[i].updated_at || ''})
          ON CONFLICT (id) DO UPDATE SET
            title=EXCLUDED.title, content=EXCLUDED.content,
            category=EXCLUDED.category, tags=EXCLUDED.tags,
            source=EXCLUDED.source, notes=EXCLUDED.notes,
            status=EXCLUDED.status, updated_at=EXCLUDED.updated_at
        `;
      }
      if (localIds.size > 0) {
        var allIds = Array.from(localIds);
        await sql`DELETE FROM materials WHERE id NOT IN (SELECT unnest(${allIds}::text[])) AND status != 'pending'`;
      } else {
        await sql`DELETE FROM materials WHERE status = 'approved'`;
      }
      return json({ synced: items.length });
    }

    return json({ error: 'Not found' }, 404);
  } catch(e) {
    console.error('API error:', e);
    return json({ error: e.message }, 500);
  }
};

function now() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }

function parseTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  try { return JSON.parse(tags); } catch(e) { return []; }
}

function json(data, status) {
  status = status || 200;
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(data)
  };
}
