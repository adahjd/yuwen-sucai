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
}

var initialized = false;

exports.handler = async function(event) {
  if (!initialized) { await initDB(); initialized = true; }

  var path = event.path.replace('/.netlify/functions/api', '').replace('/api', '');
  var method = event.httpMethod;

  try {
    if (method === 'GET' && path === '/materials') {
      var rows = await sql`SELECT * FROM materials ORDER BY updated_at DESC`;
      return json(rows.map(function(r) { r.tags = parseTags(r.tags); return r; }));
    }

    if (method === 'GET' && path === '/materials/export') {
      var rows = await sql`SELECT * FROM materials ORDER BY category, updated_at DESC`;
      return json(rows.map(function(r) { r.tags = parseTags(r.tags); return r; }));
    }

    if (method === 'DELETE' && path.startsWith('/materials/')) {
      var id = path.split('/')[2];
      await sql`DELETE FROM materials WHERE id = ${id}`;
      return json({success:true});
    }

    if (method === 'POST' && path === '/materials/clear') {
      await sql`DELETE FROM materials`;
      return json({success:true});
    }

    if (method === 'POST' && path === '/materials/sync') {
      var items = JSON.parse(event.body);
      if (!Array.isArray(items)) return json({error:'Invalid'}, 400);
      // Gather local IDs
      var localIds = new Set();
      for (var i = 0; i < items.length; i++) {
        if (!items[i].id) continue;
        localIds.add(items[i].id);
        await sql`
          INSERT INTO materials (id, title, content, category, tags, source, notes, created_at, updated_at)
          VALUES (${items[i].id}, ${items[i].title||''}, ${items[i].content||''}, ${items[i].category||'其他'},
            ${JSON.stringify(items[i].tags||[])}, ${items[i].source||''}, ${items[i].notes||''},
            ${items[i].created_at||''}, ${items[i].updated_at||''})
          ON CONFLICT (id) DO UPDATE SET
            title=EXCLUDED.title, content=EXCLUDED.content,
            category=EXCLUDED.category, tags=EXCLUDED.tags,
            source=EXCLUDED.source, notes=EXCLUDED.notes,
            updated_at=EXCLUDED.updated_at
        `;
      }
      // Delete cloud records not in local
      if (localIds.size > 0) {
        // Build exclusion list - delete all where id NOT IN localIds
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
