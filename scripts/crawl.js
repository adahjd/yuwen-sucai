const { neon } = require('@neondatabase/serverless');
const https = require('https');

const DB = process.env.DATABASE_URL;
const KEY = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY;
const USE_AI = process.env.USE_AI !== 'false' && !!KEY && KEY !== 'your-key-here';
let sql;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const BASE_HEADERS = {
  'User-Agent': UA,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9'
};

function delay(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

function get(url, extraHeaders) {
  return new Promise(function(resolve) {
    var headers = Object.assign({}, BASE_HEADERS, extraHeaders || {});
    https.get(url, { headers: headers }, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        resolve({ status: res.statusCode, body: data });
      });
    }).on('error', function(e) {
      console.error('  [HTTP]', e.message);
      resolve({ status: 0, body: '' });
    });
  });
}

// ===== 提取文章纯文本（处理HTML和Quill Delta两种格式）=====
function extractText(raw) {
  if (!raw) return '';
  if (raw.trim().startsWith('{')) {
    try {
      var delta = JSON.parse(raw);
      var ops = delta.ops || [];
      var text = '';
      for (var i = 0; i < ops.length; i++) {
        var ins = ops[i].insert;
        if (typeof ins === 'string') text += ins;
        else if (ins && ins['native-image']) text += '';
        else if (ins && ins.image) text += '';
        else if (typeof ins === 'object') text += '';
      }
      return text.replace(/\n{3,}/g, '\n\n').trim();
    } catch(e) {}
  }
  var t = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t.slice(0, 3000);
}

// ===== 过滤低质量/引流内容 =====
function isQualityContent(content) {
  if (!content || content.length < 200) return false;
  var adPatterns = ['完整版见文末','领完整版','关+留','斯我斯我','高中生人手一份','领取完整','私信领取','点赞收藏','文末领取','关注领取'];
  var adCount = 0;
  for (var i = 0; i < adPatterns.length; i++) { if (content.indexOf(adPatterns[i]) >= 0) adCount++; }
  if (content.length < 500 && adCount > 0) return false;
  // 内容超过1500字 -> 肯定是好内容
  if (content.length > 1500) return true;
  // 500-1500字 -> 如果广告词多就过滤
  if (content.length < 800 && adCount >= 3) return false;
  return true;
}

// ===== B站专栏 =====
async function crawlBilibili() {
  console.log('[B站专栏] 搜索中...');
  var items = [];
  var keywords = [
    '高考作文素材积累', '高考满分作文', '作文素材人物',
    '人民日报作文素材', '高考议论文素材', '语文作文万能素材',
    '高考作文名人名言', '高考作文热点素材', '高考作文优美段落'
  ];
  var seen = {};

  for (var i = 0; i < keywords.length; i++) {
    for (var page = 1; page <= 2; page++) {
      try {
        await delay(page === 1 ? 800 : 1200); // 页面间延迟，避免限流
        var searchUrl = 'https://api.bilibili.com/x/web-interface/search/type?search_type=article&keyword='
          + encodeURIComponent(keywords[i]) + '&page=' + page;
        var r = await get(searchUrl, {
          'Referer': 'https://www.bilibili.com/',
          'Origin': 'https://www.bilibili.com'
        });

        if (r.status === 412) {
          console.log('  搜索[' + keywords[i] + '] p' + page + ' 被限流(412)，等待5秒...');
          await delay(5000);
          continue;
        }
        if (r.status !== 200) continue;

        var d = JSON.parse(r.body);
        if (d.code !== 0 || !d.data) continue;

        var articles = (d.data.result || []).slice(0, 3);
        for (var j = 0; j < articles.length; j++) {
          var a = articles[j];
          var aid = a.id;
          if (!aid || seen[aid]) continue;
          seen[aid] = true;

          await delay(600); // 文章详情请求间延迟
          var detailUrl = 'https://api.bilibili.com/x/article/view?id=' + aid;
          var dr = await get(detailUrl, {
            'Referer': 'https://www.bilibili.com/read/cv' + aid,
            'Origin': 'https://www.bilibili.com'
          });

          if (dr.status === 412) {
            console.log('    [限流] 等待...');
            await delay(5000);
            dr = await get(detailUrl, {
              'Referer': 'https://www.bilibili.com/read/cv' + aid,
              'Origin': 'https://www.bilibili.com'
            });
          }
          if (dr.status !== 200) continue;

          try {
            var dd = JSON.parse(dr.body);
            if (dd.code !== 0 || !dd.data) continue;
            var articleData = dd.data;
            var title = String(articleData.title || '').replace(/<[^>]+>/g, '').trim().slice(0, 100);
            var content = extractText(articleData.content || '');
            var summary = String(articleData.summary || '').trim();
            if (content.length < 200 && summary.length > content.length) {
              content = summary;
            }
            if (!title) continue;
            if (!isQualityContent(content)) {
              console.log('    跳过: ' + title.slice(0, 30) + ' (' + content.length + '字)');
              continue;
            }

            var tagNames = (articleData.tags || []).map(function(t) { return t.name || t; }).filter(Boolean);
            console.log('    ✓ ' + title.slice(0, 40) + ' (' + content.length + '字)');
            items.push({
              title: title,
              content: content,
              source: 'B站专栏 - ' + (articleData.author_name || ''),
              raw_url: 'https://www.bilibili.com/read/cv' + aid,
              raw_tags: tagNames
            });
          } catch(e2) {
            console.error('    解析失败:', e2.message);
          }
        }
      } catch(e) {
        console.error('  [B站异常]', e.message);
      }
    }
  }
  console.log('[B站专栏] 抓到 ' + items.length + ' 篇');
  return items;
}

// ===== 规则分类 =====
function ruleClassify(item) {
  var txt = (item.title + ' ' + item.content).toLowerCase();
  var tags = (item.raw_tags || []).slice();
  var rules = [
    { c: '名言警句', k: ['名言', '格言', '警句', '金句', '语录', '说过', '曾说', '名人名言', '励志名言', '摘抄', '金句'] },
    { c: '诗词名句', k: ['诗', '词', '赋', '唐诗', '宋词', '诗经', '李白', '杜甫', '苏轼', '诗句', '古诗', '古诗词'] },
    { c: '人物事例', k: ['人物', '故事', '经历', '事迹', '榜样', '英雄', '传奇', '名人', '人物素材', '事例'] },
    { c: '时事热点', k: ['热点', '新闻', '事件', '科技', 'ai', '人工智能', '时事', '时评', '2025'] },
    { c: '哲理故事', k: ['哲理', '寓言', '启示', '道理', '智慧', '感悟', '哲学'] },
    { c: '优美段落', k: ['优美', '描写', '段落', '散文', '风景', '景色', '排比', '文采', '美文', '开头', '结尾'] },
    { c: '好词好句', k: ['好词', '好句', '成语', '词语', '词汇', '比喻', '宛若', '摘抄', '佳句', '妙语'] }
  ];
  var cat = '其他';
  for (var i = 0; i < rules.length; i++) {
    if (rules[i].k.some(function(k) { return txt.indexOf(k) >= 0; })) {
      cat = rules[i].c;
      break;
    }
  }
  ['高考', '作文', '素材', '写作', '语文', '高中', '议论文', '满分作文', '人民日报'].forEach(function(t) {
    if (txt.indexOf(t) >= 0 && tags.indexOf(t) < 0) tags.push(t);
  });
  return {
    title: item.title.replace(/<[^>]+>/g, '').trim().slice(0, 200),
    content: item.content.slice(0, 3000),
    category: cat,
    tags: tags.slice(0, 5),
    source: item.source,
    notes: '爬取|' + (item.raw_url || '')
  };
}

// ===== AI分类 (DeepSeek) =====
async function classify(items) {
  if (!USE_AI) {
    console.log('[分类] 规则模式');
    return items.map(ruleClassify);
  }
  console.log('[分类] DeepSeek AI, ' + items.length + ' 条...');
  var out = [];
  for (var i = 0; i < items.length; i++) {
    try {
      var c = await ai(items[i]);
      var tags = [].concat(c.tags || [], items[i].raw_tags || [])
        .filter(function(v, i, a) { return a.indexOf(v) === i; })
        .slice(0, 5);
      out.push({
        title: c.title || items[i].title.replace(/<[^>]+>/g, '').trim().slice(0, 200),
        content: items[i].content.slice(0, 3000),
        category: c.category || '其他',
        tags: tags,
        source: items[i].source,
        notes: 'AI|' + (items[i].raw_url || '')
      });
    } catch(e) {
      console.log('  AI降级: ' + items[i].title.slice(0, 30));
      out.push(ruleClassify(items[i]));
    }
  }
  return out;
}

function ai(item) {
  var prompt = '你是语文素材分类助手。请分类并返回JSON。\n\n标题:' + item.title.replace(/<[^>]+>/g, '').slice(0, 100) + '\n内容:' + item.content.slice(0, 1000) + '\n\n分类(8选1): 名言警句 / 好词好句 / 诗词名句 / 人物事例 / 时事热点 / 哲理故事 / 优美段落 / 其他\n\n只返回JSON: {"title":"简洁标题","category":"分类","tags":["标签1","标签2"]}';
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 200
    });
    var req = https.request({
      hostname: 'api.deepseek.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + KEY,
        'Content-Length': Buffer.byteLength(body)
      }
    }, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          var json = JSON.parse(data);
          var content = json.choices[0].message.content;
          var result = JSON.parse(content);
          resolve(result);
        } catch(e) {
          resolve({ title: item.title, category: '其他', tags: [] });
        }
      });
    });
    req.on('error', function(e) { reject(e); });
    req.write(body);
    req.end();
  });
}

// ===== 写入数据库 =====
async function save(items) {
  if (!items.length) return { added: 0 };
  console.log('[DB] 写入 ' + items.length + ' 条...');
  var added = 0;
  for (var i = 0; i < items.length; i++) {
    var x = items[i];
    var id = 'cr_' + Date.now().toString(36) + '_' + i + '_' + Math.random().toString(36).slice(2, 6);
    var ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    try {
      await sql`
        INSERT INTO materials (id, title, content, category, tags, source, notes, status, created_at, updated_at)
        VALUES (${id}, ${x.title.slice(0, 200)}, ${x.content.slice(0, 5000)}, ${x.category},
          ${JSON.stringify(x.tags || [])}, ${x.source}, ${x.notes || ''}, 'pending', ${ts}, ${ts})
        ON CONFLICT (id) DO NOTHING
      `;
      added++;
    } catch(e) {
      console.error('  DB写入失败:', e.message);
    }
  }
  console.log('[DB] 成功 ' + added + ' 条');
  return { added: added };
}

// ===== 主流程 =====
async function main() {
  if (!DB) { console.error('缺少 DATABASE_URL 环境变量'); process.exit(1); }
  sql = neon(DB);
  console.log('=== 语文素材爬虫 ===');
  console.log('时间: ' + new Date().toISOString());
  console.log('AI: ' + (USE_AI ? 'DeepSeek' : '规则匹配'));
  console.log('');

  var raw = await crawlBilibili();
  console.log('\n共抓取: ' + raw.length + ' 篇');

  if (!raw.length) {
    console.log('无新素材，退出。');
    process.exit(0);
  }

  var classified = await classify(raw);
  var result = await save(classified);
  console.log('\n=== 完成: +' + result.added + ' ===');
  process.exit(0);
}

main().catch(function(e) {
  console.error('爬虫崩溃:', e.message);
  process.exit(1);
});
