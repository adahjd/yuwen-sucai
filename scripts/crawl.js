const { neon } = require('@neondatabase/serverless');
const https = require('https');

const DB = process.env.DATABASE_URL;
const DEEPSEEK_KEY = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY;
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
          source: 'B站视频 ' + r.author,
          raw_url: 'https://www.bilibili.com/video/' + r.bvid,
          raw_tags: r.tag ? r.tag.split(',').map(function(t){return t.trim();}) : [],
        });
      }
    }
  } catch (e) { console.error('[B站] 错误:', e.message); }
  console.log('[B站] 获取到 ' + items.length + ' 条');
  return items;
}

// ===== Source: 知乎 =====
async function crawlZhihu() {
  console.log('[知乎] 开始爬取...');
  const items = [];
  try {
    const keywords = ['高考作文', '作文素材'];
    for (const kw of keywords) {
      const data = await fetchJSON('https://www.zhihu.com/api/v4/search_v3?t=general&q=' + encodeURIComponent(kw) + '&limit=5&offset=0');
      if (!data || !data.data) continue;
      for (const r of data.data) {
        if (r.type !== 'search_result' || !r.object) continue;
        const obj = r.object;
        const title = (obj.title || obj.excerpt || '').replace(/<[^>]+>/g, '').slice(0, 100);
        const content = (obj.excerpt || obj.content || '').replace(/<[^>]+>/g, '').slice(0, 500);
        if (!title || !content) continue;
        items.push({
          title: title,
          content: content,
          source: '知乎 — ' + (obj.author ? obj.author.name : '匿名用户'),
          raw_url: obj.url || 'https://www.zhihu.com/question/' + obj.id,
          raw_tags: (obj.topics || []).map(function(t){return t.name;}),
        });
      }
    }
  } catch (e) { console.error('[知乎] 错误:', e.message); }
  console.log('[知乎] 获取到 ' + items.length + ' 条');
  return items;
}

// ===== AI 分类 (DeepSeek) =====
async function classifyWithAI(items) {
  if (!DEEPSEEK_KEY || DEEPSEEK_KEY === 'your-key-here') {
    console.log('[AI] 未配置 API Key，使用规则分类');
    return items.map(ruleClassify);
  }

  console.log('[AI] DeepSeek 开始分类 ' + items.length + ' 条...');
  const results = [];
  for (const item of items) {
    try {
      const classification = await callDeepSeek(item.title, item.content, item.raw_tags || []);
      results.push({
        title: classification.title || item.title,
        content: item.content,
        category: classification.category || '其他',
        tags: [].concat(classification.tags || [], item.raw_tags || []).filter(function(v,i,a){return a.indexOf(v)===i;}).slice(0, 5),
        source: item.source,
        notes: 'AI自动爬取 | 原文: ' + (item.raw_url || item.source),
      });
    } catch (e) {
      console.error('[AI] 单条失败:', e.message);
      results.push(ruleClassify(item));
    }
  }
  return results;
}

function callDeepSeek(title, content, rawTags) {
  var prompt = [
    '你是高考语文作文素材分类助手。请对以下素材分类，返回JSON（不要其他文字）：',
    '',
    '标题：' + title,
    '内容：' + content.slice(0, 800),
    '',
    '格式: {"title":"简洁标题(15字)","category":"名言警句/好词好句/诗词名句/人物事例/时事热点/哲理故事/优美段落/其他","tags":["标签1","标签2"]}'
  ].join('\n');

  return new Promise(function(resolve, reject) {
    var body = JSON.stringify({
      model: 'deepseek-chat',
      messages: [{role:'user',content:prompt}],
      temperature: 0.3,
      max_tokens: 300
    });
    var req = https.request({
      hostname: 'api.deepseek.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + DEEPSEEK_KEY,
        'Content-Length': Buffer.byteLength(body)
      }
    }, function(res) {
      var d = '';
      res.on('data', function(c){d += c;});
      res.on('end', function() {
        try {
          var data = JSON.parse(d);
          var c = data.choices[0].message.content;
          resolve(JSON.parse(c));
        } catch(e) { resolve(ruleClassify({title:title, content:content, raw_tags:rawTags})); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ===== 规则分类 =====
function ruleClassify(item) {
  var text = (item.title + ' ' + item.content).toLowerCase();
  var tags = item.raw_tags || [];
  var allTags = tags.slice();

  var rules = [
    {cat:'名言警句',keys:['名言','格言','警句','说过','曾说','曰','云','名人','经典语录']},
    {cat:'诗词名句',keys:['诗','词','赋','唐诗','宋词','诗经','李白','杜甫','苏轼']},
    {cat:'人物事例',keys:['人物','故事','经历','事迹','榜样','英雄','传奇','人物素材']},
    {cat:'时事热点',keys:['热点','新闻','事件','最近','今日','2024','2025','科技','AI']},
    {cat:'哲理故事',keys:['哲理','寓言','启示','道理','智慧','感悟','人生']},
    {cat:'优美段落',keys:['优美','描写','段落','散文','风景','景色','春天','秋天']},
    {cat:'好词好句',keys:['好词','好句','成语','词语','词汇','比喻','排比']},
  ];

  var category = '其他';
  for (var i = 0; i < rules.length; i++) {
    var r = rules[i];
    if (r.keys.some(function(k){return text.indexOf(k) >= 0;})) { category = r.cat; break; }
  }

  var autoTags = ['高考','作文','素材','写作','语文','高中'];
  for (var j = 0; j < autoTags.length; j++) {
    if (text.indexOf(autoTags[j]) >= 0 && allTags.indexOf(autoTags[j]) < 0) allTags.push(autoTags[j]);
  }

  return {
    title: item.title, content: item.content, category: category,
    tags: allTags.slice(0, 5), source: item.source,
    notes: 'AI自动爬取 | 原文: ' + (item.raw_url || item.source),
  };
}

// ===== 保存到数据库 =====
async function saveToDB(items) {
  if (items.length === 0) return {added:0};
  console.log('[DB] 保存 ' + items.length + ' 条到 Neon...');
  var added = 0;
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var id = 'crawl_' + Date.now().toString(36) + '_' + i + '_' + Math.random().toString(36).slice(2, 6);
    var ts = new Date().toISOString().replace('T',' ').slice(0,19);
    try {
      await sql`
        INSERT INTO materials (id, title, content, category, tags, source, notes, status, created_at, updated_at)
        VALUES (${id}, ${item.title.slice(0,200)}, ${item.content.slice(0,2000)},
          ${item.category}, ${JSON.stringify(item.tags||[])},
          ${item.source}, ${item.notes||''},
          'pending', ${ts}, ${ts})
        ON CONFLICT (id) DO NOTHING
      `;
      added++;
    } catch(e) { console.error('[DB] 写入失败:', e.message); }
  }
  console.log('[DB] 成功写入 ' + added + ' 条');
  return {added:added};
}

// ===== HTTP =====
function fetchJSON(url) {
  return new Promise(function(resolve) {
    var proto = url.indexOf('https') === 0 ? https : require('http');
    proto.get(url, {headers:{'User-Agent':'Mozilla/5.0'}}, function(res) {
      var d = '';
      res.on('data', function(c){d += c;});
      res.on('end', function() {
        try { resolve(JSON.parse(d)); } catch(e) { resolve(null); }
      });
    }).on('error', function(){resolve(null);});
  });
}

// ===== Main =====
async function main() {
  if (!DB) { console.error('DATABASE_URL not set'); process.exit(1); }

  console.log('=== 语文素材库爬虫 ===');
  console.log('时间:', new Date().toISOString());

  var rawItems = [];
  rawItems = rawItems.concat(await crawlBilibili());
  rawItems = rawItems.concat(await crawlZhihu());

  console.log('\n总共获取 ' + rawItems.length + ' 条原始素材');
  if (rawItems.length === 0) { console.log('无新素材，结束'); process.exit(0); }

  var classified = await classifyWithAI(rawItems);
  var result = await saveToDB(classified);
  console.log('\n完成：新增 ' + result.added + ' 条待审核素材');
  process.exit(0);
}

main().catch(function(e){console.error(e);process.exit(1);});
