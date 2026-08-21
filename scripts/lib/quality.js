'use strict';
// 质量检测：过滤过短、图片引流、广告软文
const AD_KEYWORDS = [
  '完整版见文末', '领完整版', '关+留', '斯我斯我', '高中生人手一份',
  '领取完整', '私信领取', '点赞收藏', '文末领取', '关注领取', '见文末',
  '斯我', '求三连', '一键三连', '关注我'
];

// opts.minLen 默认 800；短素材（名言/金句）源可传更小值
function isQualityContent(content, opts) {
  opts = opts || {};
  const minLen = opts.minLen || 800;
  if (!content || content.length < minLen) return false;

  const lines = String(content).split('\n').filter(l => l.trim().length > 10);
  if (lines.length < 5) return false;

  let adc = 0;
  for (const w of AD_KEYWORDS) if (content.indexOf(w) >= 0) adc++;
  if (content.length < 1500 && adc >= 3) return false;

  const firstHalf = content.slice(0, Math.floor(content.length / 3));
  let adcFirst = 0;
  for (const w of AD_KEYWORDS) if (firstHalf.indexOf(w) >= 0) adcFirst++;
  if (adcFirst >= 2 && firstHalf.length < 400) return false;

  return true;
}

module.exports = { isQualityContent, AD_KEYWORDS };
