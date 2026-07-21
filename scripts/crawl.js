const { neon } = require('@neondatabase/serverless');
const https = require('https');

const DB = process.env.DATABASE_URL;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const API_URL = process.env.API_URL || 'https://yuwensucai.netlify.app';
const sql = neon(DB);

// ===== Source: B站 搜索高考作文 =====
async function crawlBilibili() {
  console.log('[B站] 开始爬取...');
  const items = [];
  try {
    const keywords = ['高考作文素材', '高考满分作文', '作文素材积累'];
    for (const kw of keywords) {
      const data = await fetchJSON(`https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(kw)}&page=1`);
      if (!data || data.code !== 0) continue;
      const results = (data.data && data.data.result) || [];
      for (const r of results.slice(0, 3)) {
        items.push({
          title: r.title.replace(/<[^>]+>/g, '').slice(0, 100),
          content: r.description ? r.description.replace(/<[^>]+>/g, '').slice(0, 500) : r.title,
          source: `B站视频 BV${r.bvid} — ${r.author}`,
          raw_url: `https://www.bilibili.com/video/${r.bvid}`,
          raw_tags: r.tag ? r.tag.split(',').map(t => t.trim()) : [],
        });
      }
    }
  } catch (e) { console.error('[B站] 错误:', e.message); }
  console.log(`[B站] 获取到 ${items.length} 条`);
  return items;
}

// ===== Source: 知乎 搜索高考作文 =====
async function crawlZhihu() {
  console.log('[知乎] 开始爬取...');
  const items = [];
  try {
    const keywords = ['高考作文', '作文素材'];
    for (const kw of keywords) {
      const data = await fetchJSON(`https://www.zhihu.com/api/v4/search_v3?t=general&q=${encodeURIComponent(kw)}&limit=5&offset=0`);
      if (!data || !data.data) continue;
      for (const r of data.data) {
        if (r.type !== 'search_result' || !r.object) continue;
        const obj = r.object;
        const title = (obj.title || obj.excerpt || '').replace(/<[^>]+>/g, '').slice(0, 100);
        const content = (obj.excerpt || obj.content || '').replace(/<[^>]+>/g, '').slice(0, 500);
        if (!title || !content) continue;
        items.push({
          title,
          content,
          source: `知乎 — ${obj.author ? obj.author.name : '匿名用户'}`,
          raw_url: obj.url || `https://www.zhihu.com/question/${obj.id}`,
          raw_tags: (obj.topics || []).map(t => t.name),
        });
      }
    }
  } catch (e) { console.error('[知乎] 错误:', e.message); }
  console.log(`[知乎] 获取到 ${items.length} 条`);
  return items;
}

// ===== Source: 作文纸条 =====
async function crawlZhitiao() {
  console.log('[纸条] 开始爬取...');
  const items = [];
  try {
    // 纸条App的公开素材接口
    const data = await fetchJSON('https://zuowen.zhitiao.cc/api/v1/materials?page=1&size=10');
    if (!data || !data.data) {
      console.log('[纸条] API 不可用，跳过');
      return items;
    }
    const results = Array.isArray(data.data) ? data.data : (data.data.list || []);
    for (const r of results.slice(0, 5)) {
      items.push({
        title: (r.title || r.name || '').slice(0, 100),
        content: (r.content || r.desc || r.summary || '').slice(0, 500),
        source: '纸条作文',
        raw_url: r.url || '',
        raw_tags: (r.tags || []).map(t => typeof t === 'string' ? t : t.name).filter(Boolean),
      });
    }
  } catch (e) { console.error('[纸条] 错误:', e.message); }
  console.log(`[纸条] 获取到 ${items.length} 条`);
  return items;
}

// ===== AI 分类 =====
async function classifyWithAI(items) {
  if (!OPENAI_KEY || OPENAI_KEY === 'your-key-here') {
    console.log('[AI] 未配置 API Key，使用规则分类');
    return items.map(ruleClassify);
  }

  console.log(`[AI] 开始分类 ${items.length} 条素材...`);
  const results = [];
  for (const item of items) {
    try {
      const classification = await callOpenAI(item.title, item.content, item.raw_tags || []);
      results.push({
        ...item,
        title: classification.title || item.title,
        category: classification.category || '其他',
        tags: [...new Set([...(classification.tags || []), ...(item.raw_tags || [])])].slice(0, 5),
        notes: `AI自动爬取 | 原文: ${item.raw_url || item.source}`,
      });
    } catch (e) {
      console.error('[AI] 单条分类失败:', e.message);
      results.push(ruleClassify(item));
    }
  }
  return results;
}

async function callOpenAI(title, content, rawTags) {
  const prompt = `你是一个高考语文作文素材分类助手。请对以下素材进行分类。

素材标题：${title}
素材内容：${content.slice(0, 800)}

请返回一个JSON对象（不要其他文字），格式如下：
{
  "title": "简洁有吸引力的标题（15字以内）",
  "category": "名言警句/好词好句/诗词名句/人物事例/时事热点/哲理故事/优美段落/其他",
  "tags": ["标签1", "标签2", "标签3"]
}

分类标准：
- 名言警句：名人名言、警句格言
- 好词好句：优美的词语或句子
- 诗词名句：古诗词相关
- 人物事例：人物故事、榜样事迹
- 时事热点：新闻热点、社会事件
- 哲理故事：寓言、哲理小故事
- 优美段落：优美的散文段落
- 其他：无法归类的`;

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 300
    });
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(d);
          const content = data.choices[0].message.content;
          resolve(JSON.parse(content));
        } catch (e) { resolve(ruleClassify({title, content, raw_tags: rawTags})); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ===== 规则分类（降级方案）=====
function ruleClassify(item) {
  const text = (item.title + ' ' + item.content).toLowerCase();
  const tags = item.raw_tags || [];
  const allTags = [...tags];

  // Category matching
  const rules = [
    { cat: '名言警句', keys: ['名言', '格言', '警句', '说过', '曾说', '曰', '云', '名人', '经典语录'] },
    { cat: '诗词名句', keys: ['诗', '词', '赋', '唐诗', '宋词', '诗经', '李白', '杜甫', '苏轼'] },
    { cat: '人物事例', keys: ['人物', '故事', '经历', '事迹', '榜样', '英雄', '传奇', '人物素材'] },
    { cat: '时事热点', keys: ['热点', '新闻', '事件', '最近', '今日', '2024', '2025', '科技', 'AI'] },
    { cat: '哲理故事', keys: ['哲理', '寓言', '启示', '道理', '智慧', '感悟', '人生'] },
    { cat: '优美段落', keys: ['优美', '描写', '段落', '散文', '风景', '景色', '春天', '秋天'] },
    { cat: '好词好句', keys: ['好词', '好句', '成语', '词语', '词汇', '比喻', '排比'] },
  ];

  let category = '其他';
  for (const rule of rules) {
    if (rule.keys.some(k => text.includes(k))) {
      category = rule.cat;
      break;
    }
  }

  // Auto-tag from content
  const autoTags = ['高考', '作文', '素材', '写作', '语文', '高中'];
  for (const t of autoTags) {
    if (text.includes(t) && !allTags.includes(t)) allTags.push(t);
  }

  return {
    ...item,
    category,
    tags: [...new Set(allTags)].slice(0, 5),
    notes: `AI自动爬取 | 原文: ${item.raw_url || item.source}`,
  };
}

// ===== 保存到数据库 =====
async function saveToDB(items) {
  if (items.length === 0) return { added: 0 };
  console.log(`[DB] 保存 ${items.length} 条到 Neon...`);
  let added = 0;
  for (const item of items) {
    const id = 'crawl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    try {
      await sql`
        INSERT INTO materials (id, title, content, category, tags, source, notes, status, created_at, updated_at)
        VALUES (${id}, ${item.title.slice(0, 200)}, ${item.content.slice(0, 2000)},
          ${item.category}, ${JSON.stringify(item.tags || [])},
          ${item.source}, ${item.notes || ''},
          'pending', ${now}, ${now})
        ON CONFLICT (id) DO NOTHING
      `;
      added++;
    } catch (e) {
      console.error('[DB] 写入失败:', e.message);
    }
  }
  console.log(`[DB] 成功写入 ${added} 条`);
  return { added };
}

// ===== HTTP Helpers =====
function fetchJSON(url) {
  return new Promise((resolve) => {
    const proto = url.startsWith('https') ? https : require('http');
    proto.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YuwenSucai/1.0)' } }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

// ===== Main =====
async function main() {
  if (!DB) { console.error('DATABASE_URL not set'); process.exit(1); }

  console.log('=== 语文素材库爬虫 ===');
  console.log('时间:', new Date().toISOString());

  // Crawl
  const rawItems = [];
  rawItems.push(...await crawlBilibili());
  rawItems.push(...await crawlZhihu());
  rawItems.push(...await crawlZhitiao());

  console.log(`\n总共获取 ${rawItems.length} 条原始素材`);

  if (rawItems.length === 0) {
    console.log('无新素材，结束');
    process.exit(0);
  }

  // Classify
  const classified = await classifyWithAI(rawItems);

  // Save
  const result = await saveToDB(classified);

  console.log(`\n完成：新增 ${result.added} 条待审核素材`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
