// ===== State =====
let materials = [];
let currentCategory = '';
let currentSearch = '';
let selectedId = null;
let deleteTargetId = null;

// ===== DOM refs =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const el = {
  searchInput: $('#search-input'),
  btnClearSearch: $('#btn-clear-search'),
  categoryNav: $('#category-nav'),
  categoryCount: $('#category-count'),
  materialList: $('#material-list'),
  emptyState: $('#empty-state'),
  detailPanel: $('#detail-panel'),
  panelTitle: $('#panel-title'),
  panelBody: $('#panel-body'),
  settingsModal: $('#settings-modal'),
  editModal: $('#edit-modal'),
  deleteModal: $('#delete-modal'),
  detailModal: $('#detail-modal'),
  toast: $('#toast'),
  mobileNav: $('#mobile-nav'),
  sidebar: $('#sidebar'),
};

// ===== API =====
async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || '请求失败');
  }
  return res.json();
}

// ===== Toast =====
let toastTimer;
function showToast(msg) {
  clearTimeout(toastTimer);
  el.toast.textContent = msg;
  el.toast.style.display = 'block';
  toastTimer = setTimeout(() => { el.toast.style.display = 'none'; }, 2000);
}

// ===== Modal helpers =====
function openModal(elId) { $(elId).style.display = 'flex'; }
function closeModal(elId) { $(elId).style.display = 'none'; }

// Close modals on overlay click & close buttons
$$('.modal-overlay').forEach(ov => {
  ov.addEventListener('click', (e) => {
    if (e.target === ov) ov.style.display = 'none';
  });
});
$$('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.closest('.modal-overlay').style.display = 'none';
  });
});

// ===== Load Data =====
async function loadMaterials() {
  try {
    let url = '/api/materials?';
    if (currentCategory) url += `category=${encodeURIComponent(currentCategory)}&`;
    if (currentSearch) url += `search=${encodeURIComponent(currentSearch)}&`;
    materials = await api(url);
    renderList();
    updateCategories();
  } catch (e) {
    showToast('加载失败: ' + e.message);
  }
}

async function updateCategories() {
  try {
    const categories = await api('/api/categories');
    const counts = {};
    for (const m of materials) {
      counts[m.category] = (counts[m.category] || 0) + 1;
    }

    el.categoryNav.innerHTML = `<a href="#" class="category-item ${currentCategory === '' ? 'active' : ''}" data-category="">📋 全部 <span class="count">${materials.length}</span></a>`;
    const presetOrder = ['名言警句','好词好句','诗词名句','人物事例','时事热点','哲理故事','优美段落'];
    const others = categories.filter(c => !presetOrder.includes(c));
    const ordered = [...presetOrder.filter(c => categories.includes(c)), ...others];

    for (const cat of ordered) {
      const count = counts[cat] || 0;
      el.categoryNav.innerHTML += `<a href="#" class="category-item ${currentCategory === cat ? 'active' : ''}" data-category="${cat}">📌 ${cat} <span class="count">${count}</span></a>`;
    }

    // "其他" always at the end if not in preset
    if (!ordered.includes('其他') && counts['其他']) {
      el.categoryNav.innerHTML += `<a href="#" class="category-item ${currentCategory === '其他' ? 'active' : ''}" data-category="其他">📌 其他 <span class="count">${counts['其他']}</span></a>`;
    }
    el.categoryCount.textContent = categories.length;
  } catch (e) { /* ignore */ }
}

// ===== Render List =====
function renderList() {
  if (materials.length === 0) {
    el.emptyState.style.display = 'flex';
    el.materialList.innerHTML = '';
    el.materialList.appendChild(el.emptyState);
  } else {
    el.emptyState.style.display = 'none';
    el.materialList.innerHTML = materials.map(m => `
      <div class="material-card" data-id="${m.id}" onclick="viewDetail(${m.id})">
        <div class="card-header">
          <span class="card-title">${escHtml(m.title)}</span>
          <div class="card-actions" onclick="event.stopPropagation()">
            <button class="btn btn-icon btn-sm" onclick="copyMaterial(${m.id})" title="复制">📋</button>
          </div>
        </div>
        <div class="card-meta">
          <span class="card-category">${escHtml(m.category)}</span>
          ${(m.tags || []).map(t => `<span class="card-tag">${escHtml(t)}</span>`).join('')}
        </div>
        <div class="card-preview">${escHtml(m.content)}</div>
        ${m.source ? `<div class="card-source">📖 ${escHtml(m.source)}</div>` : ''}
      </div>
    `).join('');
  }
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

// ===== Copy =====
async function copyMaterial(id) {
  const m = materials.find(x => x.id === id);
  if (!m) return;
  try {
    await navigator.clipboard.writeText(m.content);
    showToast('已复制到剪贴板 ✅');
  } catch {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = m.content;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('已复制到剪贴板 ✅');
  }
}

// ===== View Detail (desktop panel or mobile modal) =====
function viewDetail(id) {
  selectedId = id;
  const m = materials.find(x => x.id === id);
  if (!m) return;

  const isMobile = window.innerWidth <= 1024;
  if (isMobile) {
    $('#detail-modal-title').textContent = m.title;
    $('#detail-modal-body').innerHTML = detailHTML(m);
    openModal('#detail-modal');
  } else {
    el.panelTitle.textContent = m.title;
    el.panelBody.innerHTML = detailHTML(m) + `
      <div class="panel-actions">
        <button class="btn btn-outline" onclick="copyMaterial(${m.id})">📋 复制内容</button>
        <button class="btn btn-primary" onclick="openEdit(${m.id})">✏️ 编辑</button>
        <button class="btn btn-danger" onclick="confirmDelete(${m.id})">🗑 删除</button>
      </div>
    `;
    el.detailPanel.style.display = 'flex';
  }
}

function detailHTML(m) {
  return `
    <div class="detail-field">
      <div class="detail-label">分类</div>
      <div class="detail-value"><span class="card-category">${escHtml(m.category)}</span></div>
    </div>
    ${m.tags && m.tags.length ? `<div class="detail-field"><div class="detail-label">标签</div><div class="detail-value">${m.tags.map(t => `<span class="card-tag">${escHtml(t)}</span>`).join(' ')}</div></div>` : ''}
    <div class="detail-field">
      <div class="detail-label">内容</div>
      <div class="detail-value"><pre>${escHtml(m.content)}</pre></div>
    </div>
    ${m.source ? `<div class="detail-field"><div class="detail-label">出处</div><div class="detail-value">${escHtml(m.source)}</div></div>` : ''}
    ${m.notes ? `<div class="detail-field"><div class="detail-label">备注</div><div class="detail-value">${escHtml(m.notes)}</div></div>` : ''}
    <div class="detail-field"><div class="detail-label">更新时间</div><div class="detail-value text-muted">${m.updated_at}</div></div>
  `;
}

// ===== Create / Edit =====
function openEdit(id) {
  const m = id ? materials.find(x => x.id === id) : null;
  $('#edit-modal-title').textContent = m ? '编辑素材' : '新增素材';
  $('#edit-title').value = m ? m.title : '';
  $('#edit-content').value = m ? m.content : '';
  $('#edit-category').value = m ? m.category : '名言警句';
  $('#edit-tags').value = m && m.tags ? m.tags.join(', ') : '';
  $('#edit-source').value = m ? m.source : '';
  $('#edit-notes').value = m ? m.notes : '';
  $('#edit-id').value = m ? m.id : '';
  openModal('#edit-modal');
}

$('#edit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#edit-id').value;
  const title = $('#edit-title').value.trim();
  const content = $('#edit-content').value.trim();
  const category = $('#edit-category').value;
  const tagsRaw = $('#edit-tags').value.trim();
  const tags = tagsRaw ? tagsRaw.split(/[,，]/).map(t => t.trim()).filter(Boolean) : [];
  const source = $('#edit-source').value.trim();
  const notes = $('#edit-notes').value.trim();

  if (!title || !content) { showToast('标题和内容不能为空'); return; }

  try {
    const body = { title, content, category, tags, source, notes };
    if (id) {
      await api(`/api/materials/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      showToast('素材已更新 ✅');
    } else {
      await api('/api/materials', { method: 'POST', body: JSON.stringify(body) });
      showToast('素材已添加 ✅');
    }
    closeModal('#edit-modal');
    closeModal('#detail-modal');
    el.detailPanel.style.display = 'none';
    await loadMaterials();
  } catch (e) {
    showToast('保存失败: ' + e.message);
  }
});

// ===== Delete =====
function confirmDelete(id) {
  deleteTargetId = id;
  openModal('#delete-modal');
}

$('#btn-confirm-delete').addEventListener('click', async () => {
  if (!deleteTargetId) return;
  try {
    await api(`/api/materials/${deleteTargetId}`, { method: 'DELETE' });
    showToast('已删除 ✅');
    closeModal('#delete-modal');
    closeModal('#detail-modal');
    el.detailPanel.style.display = 'none';
    deleteTargetId = null;
    await loadMaterials();
  } catch (e) {
    showToast('删除失败: ' + e.message);
  }
});

// ===== Export / Import =====
$('#btn-export').addEventListener('click', async () => {
  try {
    const data = await api('/api/materials/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `materials-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('导出成功 ✅');
  } catch (e) {
    showToast('导出失败: ' + e.message);
  }
});

$('#btn-import').addEventListener('click', () => {
  $('#import-file').click();
});

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const items = JSON.parse(text);
    if (!Array.isArray(items)) throw new Error('格式错误');
    const result = await api('/api/materials/import', { method: 'POST', body: JSON.stringify(items) });
    showToast(`导入完成：新增 ${result.added} 条，跳过 ${result.skipped} 条`);
    closeModal('#settings-modal');
    await loadMaterials();
  } catch (e) {
    showToast('导入失败: ' + e.message);
  }
  e.target.value = '';
});

// ===== Settings =====
$('#btn-settings').addEventListener('click', () => openModal('#settings-modal'));

// ===== Search =====
el.searchInput.addEventListener('input', () => {
  currentSearch = el.searchInput.value.trim();
  el.btnClearSearch.style.display = currentSearch ? 'block' : 'none';
  loadMaterials();
});

el.btnClearSearch.addEventListener('click', () => {
  el.searchInput.value = '';
  currentSearch = '';
  el.btnClearSearch.style.display = 'none';
  loadMaterials();
});

// ===== Category Nav =====
el.categoryNav.addEventListener('click', (e) => {
  const item = e.target.closest('.category-item');
  if (!item) return;
  e.preventDefault();
  currentCategory = item.dataset.category;
  loadMaterials();
});

// ===== Add button =====
$('#btn-add').addEventListener('click', () => openEdit(null));

// ===== Mobile Navigation =====
el.mobileNav.addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item');
  if (!btn) return;
  const tab = btn.dataset.tab;
  $$('.nav-item').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  if (tab === 'list') {
    el.sidebar.classList.remove('mobile-visible');
  } else if (tab === 'categories') {
    el.sidebar.classList.add('mobile-visible');
  } else if (tab === 'settings') {
    el.sidebar.classList.remove('mobile-visible');
    openModal('#settings-modal');
  }
});

// Close mobile sidebar when clicking a category on mobile
el.categoryNav.addEventListener('click', () => {
  if (window.innerWidth <= 768) {
    setTimeout(() => el.sidebar.classList.remove('mobile-visible'), 100);
  }
});

// ===== Keyboard shortcut =====
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    el.searchInput.focus();
  }
});

// ===== Init =====
loadMaterials();

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
