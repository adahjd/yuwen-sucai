'use strict';
// 文本提取与清洗：统一处理 HTML / Quill Delta JSON → 纯文本
function extractText(raw) {
  if (!raw) return '';
  raw = String(raw);
  let t = '';
  if (raw.trim().startsWith('{')) {
    try {
      const delta = JSON.parse(raw);
      const ops = delta.ops || [];
      let text = '';
      for (const op of ops) {
        if (typeof op.insert === 'string') text += op.insert;
      }
      t = text.replace(/\n{3,}/g, '\n\n').trim();
    } catch (e) {
      t = '';
    }
  } else {
    t = raw
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<p[^>]*>/gi, '')
      .replace(/<\/h\d>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/figure>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&mdash;/g, '—')
      .replace(/&ldquo;/g, '"')
      .replace(/&rdquo;/g, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  return t;
}

// 去除标题中的 HTML 标签并限制长度
function cleanTitle(raw, maxLen) {
  maxLen = maxLen || 200;
  return String(raw || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

// 归一化内容用于 hash 去重：去空白差异
function normalize(content) {
  return String(content || '').replace(/\s+/g, '').trim();
}

module.exports = { extractText, cleanTitle, normalize };
