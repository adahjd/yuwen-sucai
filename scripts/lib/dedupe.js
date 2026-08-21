'use strict';
// 去重：基于 URL 与内容 hash（标题变化也不会重复入库）
const crypto = require('crypto');

function contentHash(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf-8').digest('hex');
}

module.exports = { contentHash };
