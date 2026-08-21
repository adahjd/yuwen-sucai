'use strict';
// 数据源：作文网素材（名言警句/好词好句/优美段落/哲理故事/人物/时事论据/典故）
// 文章链接形如 /e/YYYYMMDD/<hash>.shtml（帝国CMS），列表页多为 GB2312、文章页多为 UTF-8
const cheerio = require('cheerio');
const { get, sleep } = require('../http');
const { decodeHtml } = require('../charset');
const { isQualityContent } = require('../quality');
const { cleanTitle } = require('../text');

const NAME = '作文网';
const BASE = 'https://www.zuowen.com';

const SUBCATEGORIES = [
  ['/sucai/mingyan/', '名言警句'],
  ['/sucai/haocihaoju/', '好词好句'],
  ['/sucai/duanluo/', '优美段落'],
  ['/sucai/zheli/', '哲理故事'],
  ['/sucai/mingren/', '人物事例'],
  ['/sucai/lunju/', '时事热点'],
  ['/sucai/diangu/', '历史典故']
];

function extractContent($) {
  const selectors = ['.news_con', '#news_con', '.content', '.con', '.article', '.zw_con', '.nr_con', '.main_con'];
  for (const sel of selectors) {
    const el = $(sel).first();
    if (el.length) {
      const txt = el.find('p').map(function () { return $(this).text().trim(); }).get().filter(Boolean).join('\n');
      if (txt.length > 100) return txt;
    }
  }
  const ps = $('p').map(function () { return $(this).text().trim(); }).get().filter(t => t.length > 8);
  return ps.join('\n');
}

function extractTitle($) {
  let t = $('h1').first().text().trim();
  if (t && t.length > 2) return cleanTitle(t);
  t = $('title').text().trim();
  return cleanTitle(t.split(/[|_]/)[0].split('-作文网')[0]);
}

async function crawl(opts) {
  opts = opts || {};
  const limit = opts.limit || 4; // 每个子分类取前 N 篇
  const items = [];
  const seenArticles = {};

  for (const [path, tag] of SUBCATEGORIES) {
    const listUrl = BASE + path;
    await sleep(600 + Math.random() * 400);
    const r = await get(listUrl, { 'Referer': BASE + '/sucai/' });
    if (r.status !== 200) {
      console.log('  [' + NAME + '] ' + path + ' status=' + r.status);
      continue;
    }
    const html = decodeHtml(r.buf);
    const $ = cheerio.load(html);
    const links = [];
    $('a[href]').each(function () {
      const h = $(this).attr('href') || '';
      if (/\/e\/\d{8}\/[a-f0-9]+\.shtml/i.test(h)) {
        const abs = /^https?:\/\//.test(h) ? h : BASE + (h.startsWith('/') ? '' : '/') + h;
        if (!seenArticles[abs]) { seenArticles[abs] = true; links.push(abs); }
      }
    });

    for (const url of links.slice(0, limit)) {
      await sleep(500 + Math.random() * 400);
      const ar = await get(url, { 'Referer': listUrl });
      if (ar.status !== 200) continue;
      try {
        const aHtml = decodeHtml(ar.buf);
        const a$ = cheerio.load(aHtml);
        const title = extractTitle(a$);
        if (!title) continue;
        const content = extractContent(a$);
        if (content.length < 120) continue;
        if (!isQualityContent(content, { minLen: 120 })) {
          console.log('  [' + NAME + '] 跳过: ' + title.slice(0, 30) + ' (' + content.length + '字)');
          continue;
        }
        console.log('  [' + NAME + '] ✓ ' + title.slice(0, 40) + ' (' + content.length + '字)');
        items.push({
          title,
          content,
          source: NAME + ' - ' + tag,
          raw_url: url,
          raw_tags: [tag]
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
