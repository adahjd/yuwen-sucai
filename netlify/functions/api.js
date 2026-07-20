const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

async function initDB() {
  // Drop old table if id is INTEGER (migration from old schema)
  try {
    const cols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'materials' AND column_name = 'id'`;
    if (cols.length > 0 && cols[0].data_type === 'integer') {
      await sql`DROP TABLE materials`;
    }
  } catch (e) { /* table might not exist yet */ }

  await sql`
    CREATE TABLE IF NOT EXISTS materials (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT DEFAULT '其他',
      tags JSONB DEFAULT '[]',
      source TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT '',
      updated_at TEXT DEFAULT ''
    )
  `;
}

let initialized = false;

exports.handler = async (event) => {
  if (!initialized) {
    await initDB();
    initialized = true;
  }

  const path = event.path.replace('/.netlify/functions/api', '').replace('/api', '');
  const method = event.httpMethod;

  try {
    if (method === 'GET' && path === '/materials') {
      const rows = await sql`SELECT * FROM materials ORDER BY updated_at DESC`;
      return json(rows.map(r => ({ ...r, tags: parseTags(r.tags) })));
    }

    if (method === 'GET' && path === '/materials/export') {
      const rows = await sql`SELECT * FROM materials ORDER BY category, updated_at DESC`;
      return json(rows.map(r => ({ ...r, tags: parseTags(r.tags) })));
    }

    if (method === 'GET' && path.startsWith('/materials/')) {
      const id = path.split('/')[2];
      const rows = await sql`SELECT * FROM materials WHERE id = ${id}`;
      if (rows.length === 0) return json({ error: '未找到' }, 404);
      return json({ ...rows[0], tags: parseTags(rows[0].tags) });
    }

    if (method === 'POST' && path === '/materials') {
      const body = JSON.parse(event.body);
      if (!body.title || !body.content) return json({ error: '标题和内容不能为空' }, 400);
      const id = body.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      await sql`
        INSERT INTO materials (id, title, content, category, tags, source, notes, created_at, updated_at)
        VALUES (${id}, ${body.title}, ${body.content}, ${body.category || '其他'},
          ${JSON.stringify(body.tags || [])}, ${body.source || ''}, ${body.notes || ''},
          ${body.created_at || now}, ${now})
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title, content = EXCLUDED.content,
          category = EXCLUDED.category, tags = EXCLUDED.tags,
          source = EXCLUDED.source, notes = EXCLUDED.notes,
          updated_at = EXCLUDED.updated_at
      `;
      return json({ success: true, id }, 201);
    }

    if (method === 'POST' && path === '/materials/sync') {
      const body = JSON.parse(event.body);
      if (!Array.isArray(body)) return json({ error: 'Invalid data' }, 400);
      let synced = 0;
      for (const m of body) {
        if (!m.id) continue;
        await sql`
          INSERT INTO materials (id, title, content, category, tags, source, notes, created_at, updated_at)
          VALUES (${m.id}, ${m.title || ''}, ${m.content || ''}, ${m.category || '其他'},
            ${JSON.stringify(m.tags || [])}, ${m.source || ''}, ${m.notes || ''},
            ${m.created_at || ''}, ${m.updated_at || ''})
          ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title, content = EXCLUDED.content,
            category = EXCLUDED.category, tags = EXCLUDED.tags,
            source = EXCLUDED.source, notes = EXCLUDED.notes,
            updated_at = EXCLUDED.updated_at
        `;
        synced++;
      }
      return json({ synced });
    }

    if (method === 'DELETE' && path.startsWith('/materials/')) {
      const id = path.split('/')[2];
      await sql`DELETE FROM materials WHERE id = ${id}`;
      return json({ success: true });
    }

    return json({ error: 'Not found' }, 404);
  } catch (e) {
    console.error('API error:', e);
    return json({ error: e.message }, 500);
  }
};

function parseTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  try { return JSON.parse(tags); } catch { return []; }
}

function json(data, status = 200) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(data)
  };
}
