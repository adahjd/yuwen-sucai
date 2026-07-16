const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }
  } catch (e) { /* ignore */ }
  return { materials: [], nextId: 1 };
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

let data = loadData();

function now() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// GET /api/materials
app.get('/api/materials', (req, res) => {
  try {
    const { category, search, tag } = req.query;
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
    res.json(items);
  } catch (e) {
    console.error('GET list error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/materials/export
app.get('/api/materials/export', (req, res) => {
  try {
    const items = [...data.materials].sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return b.updated_at.localeCompare(a.updated_at);
    });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=materials-export.json');
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/materials/:id
app.get('/api/materials/:id', (req, res) => {
  const m = data.materials.find(m => m.id === parseInt(req.params.id));
  if (!m) return res.status(404).json({ error: '未找到' });
  res.json(m);
});

// POST /api/materials
app.post('/api/materials', (req, res) => {
  try {
    const { title, content, category, tags, source, notes } = req.body;
    if (!title || !content) return res.status(400).json({ error: '标题和内容不能为空' });
    const ts = now();
    const m = {
      id: data.nextId++,
      title,
      content,
      category: category || '其他',
      tags: tags || [],
      source: source || '',
      notes: notes || '',
      created_at: ts,
      updated_at: ts
    };
    data.materials.push(m);
    saveData(data);
    res.status(201).json(m);
  } catch (e) {
    console.error('POST error:', e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/materials/:id
app.put('/api/materials/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const idx = data.materials.findIndex(m => m.id === id);
    if (idx === -1) return res.status(404).json({ error: '未找到' });
    const { title, content, category, tags, source, notes } = req.body;
    if (!title || !content) return res.status(400).json({ error: '标题和内容不能为空' });
    data.materials[idx] = {
      ...data.materials[idx],
      title,
      content,
      category: category || '其他',
      tags: tags || [],
      source: source || '',
      notes: notes || '',
      updated_at: now()
    };
    saveData(data);
    res.json(data.materials[idx]);
  } catch (e) {
    console.error('PUT error:', e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/materials/:id
app.delete('/api/materials/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const idx = data.materials.findIndex(m => m.id === id);
  if (idx === -1) return res.status(404).json({ error: '未找到' });
  data.materials.splice(idx, 1);
  saveData(data);
  res.json({ success: true });
});

// POST /api/materials/import
app.post('/api/materials/import', (req, res) => {
  try {
    const items = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: '请提供有效的素材数组' });
    let added = 0, skipped = 0;
    const ts = now();
    for (const item of items) {
      const dup = data.materials.find(m => m.title === item.title && m.content === item.content);
      if (dup) { skipped++; continue; }
      data.materials.push({
        id: data.nextId++,
        title: item.title || '',
        content: item.content || '',
        category: item.category || '其他',
        tags: item.tags || [],
        source: item.source || '',
        notes: item.notes || '',
        created_at: item.created_at || ts,
        updated_at: ts
      });
      added++;
    }
    saveData(data);
    res.json({ added, skipped, total: items.length });
  } catch (e) {
    console.error('Import error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/categories
app.get('/api/categories', (req, res) => {
  const cats = [...new Set(data.materials.map(m => m.category))].sort();
  res.json(cats);
});

// GET /api/tags
app.get('/api/tags', (req, res) => {
  const tags = [...new Set(data.materials.flatMap(m => m.tags || []))].sort();
  res.json(tags);
});

app.listen(PORT, () => console.log(`语文素材库已启动: http://localhost:${PORT}`));
