'use strict';
// 数据源：B站专栏（Bilibili 文章），通过公开 API 抓取
const { get, sleep } = require('../http');
const { extractText } = require('../text');
const { isQualityContent } = require('../quality');

const NAME = 'B站专栏';

const KEYWORDS = [
  '高考满分作文范文',
  '人民日报作文素材摘抄',
  '高考作文万能素材',
  '高考议论文人物素材',
  '作文金句摘抄积累',
  '高考作文开头结尾',
  '作文素材人民日报',
  '高中语文作文素材大全'
];

async function crawl(opts) {
  opts = opts || {};
  const limit = opts.limit || 3; // 每个关键词取前 N 篇
  const items = [];
  const seen = {};

  for (const kw of KEYWORDS) {
    await sleep(1200 + Math.random() * 800);
    const searchUrl = 'https://api.bilibili.com/x/web-interface/search/type?search_type=article&keyword='
      + encodeURIComponent(kw) + '&page=1';
    const r = await get(searchUrl, {
      'Referer': 'https://www.bilibili.com/',
      'Origin': 'https://www.bilibili.com'
    });
    if (r.status !== 200) {
      console.log('  [' + NAME + '] ' + kw.slice(0, 15) + ' status=' + r.status);
      continue;
    }

    let d;
    try { d = JSON.parse(r.body); } catch (e) { continue; }
    if (d.code !== 0 || !d.data) continue;

    const articles = (d.data.result || []).slice(0, limit);
    for (const a of articles) {
      const aid = a.id;
      if (!aid || seen[aid]) continue;
      seen[aid] = true;

      await sleep(800 + Math.random() * 600);
      const detailUrl = 'https://api.bilibili.com/x/article/view?id=' + aid;
      const dr = await get(detailUrl, {
        'Referer': 'https://www.bilibili.com/read/cv' + aid,
        'Origin': 'https://www.bilibili.com'
      });
      if (dr.status !== 200) continue;

      try {
        const dd = JSON.parse(dr.body);
        if (dd.code !== 0 || !dd.data) continue;
        const art = dd.data;
        const title = String(art.title || '').replace(/<[^>]+>/g, '').trim().slice(0, 100);
        let content = extractText(art.content || '');
        const summary = extractText(art.summary || '');
        if (summary.length > content.length) content = summary;
        if (!title) continue;
        if (!isQualityContent(content)) {
          console.log('  [' + NAME + '] 跳过: ' + title.slice(0, 30) + ' (' + content.length + '字)');
          continue;
        }

        const tagNames = (art.tags || []).map(t => t.name || t).filter(Boolean);
        console.log('  [' + NAME + '] ✓ ' + title.slice(0, 40) + ' (' + content.length + '字)');
        items.push({
          title,
          content,
          source: NAME + ' - ' + (art.author_name || ''),
          raw_url: 'https://www.bilibili.com/read/cv' + aid,
          raw_tags: tagNames
        });
      } catch (e) {
        console.error('  [' + NAME + '] 解析失败:', e.message);
      }
    }
  }

  console.log('[' + NAME + '] 抓到 ' + items.length + ' 篇');
  return items;
}

module.exports = { name: NAME, crawl };
