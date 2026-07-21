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
      category TEXT DEFAULT '其他', tags JSONB DEFAULT '[]',
      source TEXT DEFAULT '', notes TEXT DEFAULT '',
      created_at TEXT DEFAULT '', updated_at TEXT DEFAULT ''
    )
  `;
  try { await sql`ALTER TABLE materials ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'approved'`; } catch(e) {}
  await sql`UPDATE materials SET status = 'approved' WHERE status IS NULL`;
}

var initialized = false;

exports.handler = async function(event) {
  if (!initialized) { await initDB(); initialized = true; }

  var path = event.path.replace('/.netlify/functions/api', '').replace('/api', '');
  var method = event.httpMethod;

  try {
    // GET /api/materials — list (default: approved only)
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
      return json({success:true});
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
      return json({success:true});
    }

    // POST /api/materials/clear
    if (method === 'POST' && path === '/materials/clear') {
      await sql`DELETE FROM materials`;
      return json({success:true});
    }

    // POST /api/materials/sync
    if (method === 'POST' && path === '/materials/sync') {
      var items = JSON.parse(event.body);
      if (!Array.isArray(items)) return json({error:'Invalid'}, 400);
      var localIds = new Set();
      for (var i = 0; i < items.length; i++) {
        if (!items[i].id) continue;
        localIds.add(items[i].id);
        var st = items[i].status || 'approved';
        await sql`
          INSERT INTO materials (id, title, content, category, tags, source, notes, status, created_at, updated_at)
          VALUES (${items[i].id}, ${items[i].title||''}, ${items[i].content||''}, ${items[i].category||'其他'},
            ${JSON.stringify(items[i].tags||[])}, ${items[i].source||''}, ${items[i].notes||''},
            ${st}, ${items[i].created_at||''}, ${items[i].updated_at||''})
          ON CONFLICT (id) DO UPDATE SET
            title=EXCLUDED.title, content=EXCLUDED.content,
            category=EXCLUDED.category, tags=EXCLUDED.tags,
            source=EXCLUDED.source, notes=EXCLUDED.notes,
            status=EXCLUDED.status, updated_at=EXCLUDED.updated_at
        `;
      }
      if (localIds.size > 0) {
        var allIds = Array.from(localIds);
        await sql`DELETE FROM materials WHERE id NOT IN (SELECT unnest(${allIds}::text[]))`;
      }
      return json({synced:items.length});
    }

    return json({error:'Not found'}, 404);
  } catch(e) {
    console.error('API error:', e);
    return json({error:e.message}, 500);
  }
};

function now() { return new Date().toISOString().replace('T',' ').slice(0,19); }

function parseTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  try { return JSON.parse(tags); } catch(e) { return []; }
}

function json(data, status) {
  status = status || 200;
  return {
    statusCode: status,
    headers: {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},
    body: JSON.stringify(data)
  };
}
