const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function initDB() {
  try {
    var cols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'materials' AND column_name = 'id'`;
    if (cols.length > 0 && cols[0].data_type === 'integer') {
      await sql`DROP TABLE materials`;
    }
  } catch (e) {}
  await sql`
    CREATE TABLE IF NOT EXISTS materials (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
      category TEXT DEFAULT 'Other', tags JSONB DEFAULT '[]',
      source TEXT DEFAULT '', notes TEXT DEFAULT '',
      created_at TEXT DEFAULT '', updated_at TEXT DEFAULT ''
    )
  `;
  try { await sql`ALTER TABLE materials ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'approved'`; } catch(e) {}
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

async function miniCrawl() {
  var keywords = ['高考作文素材', '人民日报作文素材', '高考议论文素材'];
  var seen = {};
  var items = [];

  for (var i = 0; i < keywords.length && items.length < 5; i++) {
    try {
      var searchUrl = 'https://api.bilibili.com/x/web-interface/search/type?search_type=article&keyword=' + encodeURIComponent(keywords[i]) + '&page=1';
      var searchData = await fetchJson(searchUrl, {
        'Referer': 'https://www.bilibili.com/',
        'Origin': 'https://www.bilibili.com'
      });
      if (!searchData || searchData.code !== 0 || !searchData.data) continue;

      var articles = (searchData.data.result || []).slice(0, 3);
      for (var j = 0; j < articles.length && items.length < 5; j++) {
        var a = articles[j];
        var aid = a.id;
        if (!aid || seen[aid]) continue;
        seen[aid] = true;

        var detailUrl = 'https://api.bilibili.com/x/article/view?id=' + aid;
        var detailData = await fetchJson(detailUrl, {
          'Referer': 'https://www.bilibili.com/read/cv' + aid,
          'Origin': 'https://www.bilibili.com'
        });
        if (!detailData || detailData.code !== 0 || !detailData.data) continue;

        var art = detailData.data;
        var title = String(art.title || '').replace(/<[^>]+>/g, '').trim().slice(0, 100);
        var content = extractText(art.content || '');
        if (!title || content.length < 500) continue;

        var cls = quickClassify({ title: title, content: content });
        var existing = await sql`SELECT id FROM materials WHERE title = ${title.slice(0,100)} LIMIT 1`;
        if (existing.length > 0) continue;
        var id = 'cr_' + Date.now().toString(36) + '_' + items.length + '_' + Math.random().toString(36).slice(2, 6);
        var ts = now();
        await sql`
          INSERT INTO materials (id, title, content, category, tags, source, notes, status, created_at, updated_at)
          VALUES (${id}, ${title.slice(0, 200)}, ${content.slice(0, 5000)}, ${cls.category},
            ${JSON.stringify(cls.tags)}, ${'B站专栏'}, ${'快速爬取'}, 'pending', ${ts}, ${ts})
          ON CONFLICT (id) DO NOTHING
        `;
        items.push({ title: title, len: content.length });
      }
    } catch(e) {}
  }
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
      var crawled = await miniCrawl();
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
