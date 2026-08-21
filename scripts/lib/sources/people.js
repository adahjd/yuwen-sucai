'use strict';
// 数据源：人民网观点频道（人民时评等），UTF-8，高质量时事热点素材
const cheerio = require('cheerio');
const { get, sleep } = require('../http');
const { isQualityContent } = require('../quality');
const { cleanTitle } = require('../text');

const NAME = '人民网观点';
const LIST_URLS = [
  'http://opinion.people.com.cn/'
];

async function crawl(opts) {
  opts = opts || {};
  const limit = opts.limit || 6;
  const items = [];
  const seen = {};

  for (const listUrl of LIST_URLS) {
    const r = await get(listUrl);
    if (r.status !== 200) {
      console.log('  [' + NAME + '] 列表页失败 status=' + r.status);
      continue;
    }
    const $ = cheerio.load(r.body);
    const links = [];
    $('a[href]').each(function () {
      const h = $(this).attr('href') || '';
      if (/n1\/\d{4}\/\d{4}\/c\d+-\d+\.html/.test(h)) {
        const abs = /^https?:\/\//.test(h) ? h : 'http://opinion.people.com.cn' + (h.startsWith('/') ? '' : '/') + h;
        if (!seen[abs]) { seen[abs] = true; links.push(abs); }
      }
    });

    for (const url of links.slice(0, limit)) {
      await sleep(800 + Math.random() * 600);
      const ar = await get(url, { 'Referer': listUrl });
      if (ar.status !== 200) continue;
      try {
        const a$ = cheerio.load(ar.body);
        let title = a$('h1').first().text().trim() || a$('h2').first().text().trim() || a$('title').text().trim();
        title = title.split('--')[0].split('-人民网')[0].trim();
        if (!title) continue;

        const paras = a$('.rm_txt_con').find('p').map(function () { return a$(this).text().trim(); }).get().filter(Boolean);
        const content = paras.join('\n');
        if (content.length < 200) continue;
        if (!isQualityContent(content, { minLen: 400 })) {
          console.log('  [' + NAME + '] 跳过: ' + title.slice(0, 30) + ' (' + content.length + '字)');
          continue;
        }
        console.log('  [' + NAME + '] ✓ ' + title.slice(0, 40) + ' (' + content.length + '字)');
        items.push({
          title: cleanTitle(title),
          content,
          source: NAME,
          raw_url: url,
          raw_tags: ['时事热点', '时评']
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
