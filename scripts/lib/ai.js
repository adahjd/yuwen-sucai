'use strict';
// 智谱 GLM-4-Flash（免费模型）可选 AI 增强。
// 未配置 API Key 时 enabled() 返回 false，爬虫走纯规则分类（零成本、零依赖）。
const KEY = process.env.ZHIPU_API_KEY || process.env.GLM_API_KEY || '';
const MODEL = process.env.GLM_MODEL || 'glm-4-flash';
const CATEGORIES = ['名言警句', '好词好句', '诗词名句', '人物事例', '时事热点', '哲理故事', '优美段落', '其他'];

function enabled() {
  return !!KEY && KEY !== 'your-key-here';
}

// 对一条素材做增强：返回 { title, category, tags }，失败返回 null（调用方降级为规则结果）
async function enhance(item) {
  const prompt = [
    '你是高考语文作文素材整理助手。根据下面的素材，输出 JSON：',
    '{"title":"简洁标题","category":"分类","tags":["适用主题1","适用主题2","适用主题3"]}',
    '分类必须是这8个之一：' + CATEGORIES.join('、'),
    'tags 是 3~5 个该素材可用的作文主题关键词（如：坚持、创新、爱国、成长、奋斗、责任、诚信、梦想、感恩等）。',
    '只输出 JSON，不要多余文字。',
    '',
    '标题：' + String(item.title || '').slice(0, 100),
    '内容：' + String(item.content || '').slice(0, 800)
  ].join('\n');

  try {
    const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + KEY
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 300
      })
    });
    if (!res.ok) return null;
    const json = await res.json();
    const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    if (!content) return null;

    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const obj = JSON.parse(content.slice(start, end + 1));

    return {
      title: (obj.title && String(obj.title).trim()) || item.title,
      category: CATEGORIES.indexOf(obj.category) >= 0 ? obj.category : (item.category || '其他'),
      tags: Array.isArray(obj.tags) ? obj.tags.map(String).filter(Boolean).slice(0, 5) : (item.tags || [])
    };
  } catch (e) {
    return null;
  }
}

module.exports = { enabled, enhance };
