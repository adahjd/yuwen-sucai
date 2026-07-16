const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===== Storage backend =====
let backend; // { getAll, getById, create, update, remove, exportAll, importItems, getCategories, getTags }

async function initBackend() {
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    console.log('Using PostgreSQL backend');
    backend = await createPgBackend(dbUrl);
  } else {
    console.log('Using JSON file backend');
    backend = createJsonBackend();
  }
}

// ===== JSON file backend =====
function createJsonBackend() {
  const DATA_FILE = path.join(__dirname, 'data.json');

  function load() {
    try {
      if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    } catch (e) { /* ignore */ }
    return { materials: [], nextId: 1 };
  }

  function save(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  }

  let data = load();

  return {
    getAll({ category, search, tag }) {
      let items = data.materials;
      if (category) items = items.filter(m => m.category === category);
      if (search) {
        const kw = search.toLowerCase();
        items = items.filter(m =>
          (m.title || '').toLowerCase().includes(kw) ||
          (m.content || '').toLowerCase().includes(kw) ||
          (m.source || '').toLowerCase().includes(kw) ||
          (m.notes || '').toLowerCase().includes(kw)
        );
      }
      if (tag) items = items.filter(m => (m.tags || []).includes(tag));
      items.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      return items;
    },
    getById(id) {
      return data.materials.find(m => m.id === id) || null;
    },
    create({ title, content, category, tags, source, notes }) {
      const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const m = {
        id: data.nextId++, title, content,
        category: category || '其他', tags: tags || [],
        source: source || '', notes: notes || '',
        created_at: ts, updated_at: ts
      };
      data.materials.push(m);
      save(data);
      return m;
    },
    update(id, { title, content, category, tags, source, notes }) {
      const idx = data.materials.findIndex(m => m.id === id);
      if (idx === -1) return null;
      data.materials[idx] = {
        ...data.materials[idx], title, content,
        category: category || '其他', tags: tags || [],
        source: source || '', notes: notes || '',
        updated_at: new Date().toISOString().replace('T', ' ').slice(0, 19)
      };
      save(data);
      return data.materials[idx];
    },
    remove(id) {
      const idx = data.materials.findIndex(m => m.id === id);
      if (idx === -1) return false;
      data.materials.splice(idx, 1);
      save(data);
      return true;
    },
    exportAll() {
      return [...data.materials].sort((a, b) => {
        if (a.category !== b.category) return a.category.localeCompare(b.category);
        return b.updated_at.localeCompare(a.updated_at);
      });
    },
    importItems(items) {
      let added = 0, skipped = 0;
      const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
      for (const item of items) {
        const dup = data.materials.find(m => m.title === item.title && m.content === item.content);
        if (dup) { skipped++; continue; }
        data.materials.push({
          id: data.nextId++, title: item.title || '', content: item.content || '',
          category: item.category || '其他', tags: item.tags || [],
          source: item.source || '', notes: item.notes || '',
          created_at: item.created_at || ts, updated_at: ts
        });
        added++;
      }
      save(data);
      return { added, skipped, total: items.length };
    },
    getCategories() {
      return [...new Set(data.materials.map(m => m.category))].sort();
    },
    getTags() {
      return [...new Set(data.materials.flatMap(m => m.tags || []))].sort();
    }
  };
}

// ===== PostgreSQL backend =====
async function createPgBackend(connectionString) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS materials (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT DEFAULT '其他',
      tags JSONB DEFAULT '[]',
      source TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  function toObj(row) {
    return { ...row, tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags };
  }

  return {
    async getAll({ category, search, tag }) {
      let conditions = [];
      let params = [];
      let idx = 1;
      if (category) { conditions.push(`category = $${idx++}`); params.push(category); }
      if (search) {
        const kw = `%${search}%`;
        conditions.push(`(title ILIKE $${idx} OR content ILIKE $${idx} OR source ILIKE $${idx} OR notes ILIKE $${idx})`);
        params.push(kw); idx++;
      }
      if (tag) { conditions.push(`tags::text LIKE $${idx}`); params.push(`%"${tag}"%`); idx++; }
      const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
      const result = await pool.query(`SELECT * FROM materials${where} ORDER BY updated_at DESC`, params);
      return result.rows.map(toObj);
    },
    async getById(id) {
      const result = await pool.query('SELECT * FROM materials WHERE id = $1', [id]);
      return result.rows.length ? toObj(result.rows[0]) : null;
    },
    async create({ title, content, category, tags, source, notes }) {
      const result = await pool.query(
        `INSERT INTO materials (title, content, category, tags, source, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [title, content, category || '其他', JSON.stringify(tags || []), source || '', notes || '']
      );
      return toObj(result.rows[0]);
    },
    async update(id, { title, content, category, tags, source, notes }) {
      const result = await pool.query(
        `UPDATE materials SET title=$1, content=$2, category=$3, tags=$4, source=$5, notes=$6, updated_at=NOW() WHERE id=$7 RETURNING *`,
        [title, content, category || '其他', JSON.stringify(tags || []), source || '', notes || '', id]
      );
      return result.rows.length ? toObj(result.rows[0]) : null;
    },
    async remove(id) {
      const result = await pool.query('DELETE FROM materials WHERE id = $1', [id]);
      return result.rowCount > 0;
    },
    async exportAll() {
      const result = await pool.query('SELECT * FROM materials ORDER BY category, updated_at DESC');
      return result.rows.map(toObj);
    },
    async importItems(items) {
      let added = 0, skipped = 0;
      for (const item of items) {
        const dup = await pool.query('SELECT id FROM materials WHERE title = $1 AND content = $2', [item.title || '', item.content || '']);
        if (dup.rows.length > 0) { skipped++; continue; }
        await pool.query(
          `INSERT INTO materials (title, content, category, tags, source, notes, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [item.title || '', item.content || '', item.category || '其他', JSON.stringify(item.tags || []), item.source || '', item.notes || '', item.created_at || new Date().toISOString()]
        );
        added++;
      }
      return { added, skipped, total: items.length };
    },
    async getCategories() {
      const result = await pool.query('SELECT DISTINCT category FROM materials ORDER BY category');
      return result.rows.map(r => r.category);
    },
    async getTags() {
      const result = await pool.query('SELECT DISTINCT jsonb_array_elements_text(tags) AS tag FROM materials ORDER BY tag');
      return result.rows.map(r => r.tag);
    }
  };
}

// ===== Routes =====
app.get('/api/materials', async (req, res) => {
  try {
    const items = await backend.getAll(req.query);
    res.json(items);
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.get('/api/materials/export', async (req, res) => {
  try {
    const items = await backend.exportAll();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=materials-export.json');
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/materials/:id', async (req, res) => {
  const m = await backend.getById(parseInt(req.params.id));
  if (!m) return res.status(404).json({ error: '未找到' });
  res.json(m);
});

app.post('/api/materials', async (req, res) => {
  try {
    const { title, content } = req.body;
    if (!title || !content) return res.status(400).json({ error: '标题和内容不能为空' });
    const m = await backend.create(req.body);
    res.status(201).json(m);
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.put('/api/materials/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { title, content } = req.body;
    if (!title || !content) return res.status(400).json({ error: '标题和内容不能为空' });
    const m = await backend.update(id, req.body);
    if (!m) return res.status(404).json({ error: '未找到' });
    res.json(m);
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.delete('/api/materials/:id', async (req, res) => {
  const ok = await backend.remove(parseInt(req.params.id));
  if (!ok) return res.status(404).json({ error: '未找到' });
  res.json({ success: true });
});

app.post('/api/materials/import', async (req, res) => {
  try {
    const items = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: '请提供有效的素材数组' });
    const result = await backend.importItems(items);
    res.json(result);
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.get('/api/categories', async (req, res) => {
  try {
    const cats = await backend.getCategories();
    res.json(cats);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tags', async (req, res) => {
  try {
    const tags = await backend.getTags();
    res.json(tags);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

initBackend().then(() => {
  app.listen(PORT, () => console.log(`语文素材库已启动: http://localhost:${PORT}`));
});
