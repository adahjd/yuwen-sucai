'use strict';
// 纯规则分类（不再依赖 AI）。
// 两级策略：① 源提供的分类标签（高置信度）直接命中；② 关键词规则兜底。
const { cleanTitle } = require('./text');

const CATEGORIES = ['名言警句', '好词好句', '诗词名句', '人物事例', '时事热点', '哲理故事', '优美段落', '其他'];

// 源子分类 / 常见标签 → 标准分类
const TAG_TO_CATEGORY = {
  '名言警句': '名言警句',
  '好词好句': '好词好句',
  '优美段落': '优美段落',
  '哲理故事': '哲理故事',
  '人物事例': '人物事例',
  '时事热点': '时事热点',
  '诗词名句': '诗词名句',
  '历史典故': '人物事例',
  '时事论据': '时事热点',
  '名人故事': '人物事例',
  '成语故事': '哲理故事',
  '时评': '时事热点'
};

// 关键词规则（兜底，注意避免单字关键词以免误匹配）
const RULES = [
  { c: '名言警句', k: ['名言', '格言', '警句', '金句', '语录', '说过', '曾说', '名人名言', '励志名言', '座右铭'] },
  { c: '诗词名句', k: ['唐诗', '宋词', '诗经', '诗词', '古诗', '古诗词', '诗句', '名句', '李白', '杜甫', '苏轼', '辞赋', '五言', '七言'] },
  { c: '人物事例', k: ['人物', '事例', '事迹', '榜样', '英雄', '传奇', '名人', '人物素材'] },
  { c: '时事热点', k: ['热点', '新闻', '事件', '科技', '人工智能', '时事', '时评', '2025', '2026', '2027'] },
  { c: '哲理故事', k: ['哲理', '寓言', '启示', '道理', '智慧', '感悟', '哲学'] },
  { c: '优美段落', k: ['优美', '描写', '段落', '散文', '风景', '景色', '排比', '文采', '美文', '开头', '结尾', '比喻'] },
  { c: '好词好句', k: ['好词', '好句', '成语', '词语', '词汇', '宛若', '摘抄', '佳句', '妙语'] }
];

const COMMON_TAGS = ['高考', '作文', '素材', '写作', '语文', '高中', '议论文', '满分作文', '人民日报'];

function build(item, category, tags) {
  const dedup = tags.filter((v, i, a) => a.indexOf(v) === i).slice(0, 5);
  return {
    title: cleanTitle(item.title, 200),
    content: String(item.content || '').slice(0, 10000),
    category,
    tags: dedup,
    source: item.source || '',
    raw_url: item.raw_url || '',
    notes: '爬取|' + (item.raw_url || '')
  };
}

function ruleClassify(item) {
  const rawTags = (item.raw_tags || []).slice();
  const txt = ((item.title || '') + ' ' + (item.content || '')).toLowerCase();
  const tags = rawTags.slice();

  for (const t of COMMON_TAGS) {
    if (txt.indexOf(t) >= 0 && tags.indexOf(t) < 0) tags.push(t);
  }

  // ① 源提供的分类标签优先
  for (const t of rawTags) {
    if (TAG_TO_CATEGORY[t]) return build(item, TAG_TO_CATEGORY[t], tags);
  }

  // ② 规则兜底
  let cat = '其他';
  for (const r of RULES) {
    if (r.k.some(k => txt.indexOf(k) >= 0)) { cat = r.c; break; }
  }
  return build(item, cat, tags);
}

module.exports = { ruleClassify, CATEGORIES, RULES, COMMON_TAGS, TAG_TO_CATEGORY };
