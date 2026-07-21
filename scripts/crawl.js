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
      console.error('  [HTTP Error]', e.message);
      resolve({ status: 0, body: '' });
    });
  });
}

// ===== B站 =====
async function crawlBilibili() {
  console.log('[B站] 搜索中...');
  var items = [];
  var keywords = ['高考作文素材', '高考满分作文', '作文素材积累'];
  for (var i = 0; i < keywords.length; i++) {
    try {
      var url = 'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=' + encodeURIComponent(keywords[i]) + '&page=1';
      var r = await get(url, {
        'Referer': 'https://www.bilibili.com/',
        'Origin': 'https://www.bilibili.com'
      });
      console.log('  [' + keywords[i] + '] status=' + r.status + ' len=' + r.body.length);
      if (r.status !== 200) continue;

      var d = JSON.parse(r.body);
      if (d.code !== 0 || !d.data) {
        console.log('  B站 code=' + d.code + ' msg=' + (d.message || ''));
        continue;
      }
      var videos = (d.data.result || []).slice(0, 3);
      for (var j = 0; j < videos.length; j++) {
        var x = videos[j];
        var title = String(x.title || '').replace(/<[^>]+>/g, '').trim().slice(0, 100);
        var content = String(x.description || x.title || '').replace(/<[^>]+>/g, '').trim().slice(0, 500);
        var tagStr = String(x.tag || '');
        if (!title) continue;
        items.push({
          title: title,
          content: content || title,
          source: 'B站 - ' + (x.author || ''),
          raw_url: 'https://www.bilibili.com/video/' + x.bvid,
          raw_tags: tagStr.split(',').map(function(s) { return s.trim(); }).filter(Boolean)
        });
      }
    } catch(e) {
      console.error('  [B站异常]', e.message);
    }
  }
  console.log('[B站] 抓到 ' + items.length + ' 条');
  return items;
}

// ===== 纸条作文 =====
async function crawlZhiti() {
  console.log('[纸条] 尝试中...');
  // 纸条作文网页版：通过热门素材推荐接口
  var items = [];
  try {
    var url = 'https://www.zhitizuo.com/api/v1/materials/recommend?page=1&size=5';
    var r = await get(url, {
      'Referer': 'https://www.zhitizuo.com/',
      'Origin': 'https://www.zhitizuo.com'
    });
    console.log('  status=' + r.status + ' len=' + r.body.length);
    if (r.status === 200) {
      try {
        var d = JSON.parse(r.body);
        var list = (d.data && d.data.list) ? d.data.list : (Array.isArray(d.data) ? d.data : []);
        for (var j = 0; j < list.length; j++) {
          var x = list[j];
          var title = String(x.title || x.name || '').trim().slice(0, 100);
          var content = String(x.content || x.summary || x.description || '').trim().slice(0, 500);
          if (!title) continue;
          items.push({
            title: title,
            content: content || title,
            source: '纸条作文',
            raw_url: x.url || x.share_url || 'https://www.zhitizuo.com',
            raw_tags: (x.tags || x.keywords || []).map(function(t) { return typeof t === 'string' ? t : (t.name || ''); }).filter(Boolean)
          });
        }
      } catch(e2) { console.log('  纸条解析失败:', e2.message); }
    }
  } catch(e) {
    console.error('  [纸条异常]', e.message);
  }
  console.log('[纸条] 抓到 ' + items.length + ' 条');
  return items;
}

// ===== 人民日报评论 RSS =====
async function crawlPeopleDaily() {
  console.log('[人民日报] 尝试中...');
  var items = [];
  try {
    var url = 'https://comments.people.com.cn/rss/comment.xml';
    var r = await get(url, {});
    console.log('  status=' + r.status + ' len=' + r.body.length);
    if (r.status === 200) {
      var body = r.body;
      var re = /<item>([\s\S]*?)<\/item>/g;
      var match;
      var count = 0;
      while ((match = re.exec(body)) !== null && count < 5) {
        var block = match[1];
        var titleMatch = /<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(block) || /<title>(.*?)<\/title>/.exec(block);
        var descMatch = /<description><!\[CDATA\[(.*?)\]\]><\/description>/.exec(block) || /<description>(.*?)<\/description>/.exec(block);
        var linkMatch = /<link>(.*?)<\/link>/.exec(block);
        var title = titleMatch ? titleMatch[1].trim().slice(0, 100) : '';
        var content = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim().slice(0, 500) : '';
        if (title) {
          items.push({
            title: title,
            content: content || title,
            source: '人民日报评论',
            raw_url: linkMatch ? linkMatch[1] : '',
            raw_tags: ['人民日报', '评论', '时事']
          });
          count++;
        }
      }
    }
  } catch(e) {
    console.error('  [人民日报异常]', e.message);
  }
  console.log('[人民日报] 抓到 ' + items.length + ' 条');
  return items;
}

// ===== 规则分类 =====
function ruleClassify(item) {
  var txt = (item.title + ' ' + item.content).toLowerCase();
  var tags = (item.raw_tags || []).slice();
  var rules = [
    { c: '名言警句', k: ['名言', '格言', '警句', '说过', '曾说', '名言警句'] },
    { c: '诗词名句', k: ['诗', '词', '赋', '唐诗', '宋词', '诗经', '李白', '杜甫', '苏轼', '诗句', '古诗'] },
    { c: '人物事例', k: ['人物', '故事', '经历', '事迹', '榜样', '英雄', '传奇', '名人'] },
    { c: '时事热点', k: ['热点', '新闻', '事件', '2024', '2025', '科技', 'ai', '人工智能'] },
    { c: '哲理故事', k: ['哲理', '寓言', '启示', '道理', '智慧', '感悟'] },
    { c: '优美段落', k: ['优美', '描写', '段落', '散文', '风景', '景色', '排比'] },
    { c: '好词好句', k: ['好词', '好句', '成语', '词语', '词汇', '比喻', '宛若'] }
  ];
  var cat = '其他';
  for (var i = 0; i < rules.length; i++) {
    if (rules[i].k.some(function(k) { return txt.indexOf(k) >= 0; })) {
      cat = rules[i].c;
      break;
    }
  }
  ['高考', '作文', '素材', '写作', '语文', '高中'].forEach(function(t) {
    if (txt.indexOf(t) >= 0 && tags.indexOf(t) < 0) tags.push(t);
  });
  return {
    title: item.title,
    content: item.content,
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
        title: c.title || items[i].title,
        content: items[i].content,
        category: c.category || '其他',
        tags: tags,
        source: items[i].source,
        notes: 'AI|' + (items[i].raw_url || '')
      });
    } catch(e) {
      console.log('  AI降级为规则: ' + items[i].title.slice(0, 30));
      out.push(ruleClassify(items[i]));
    }
  }
  return out;
}

function ai(item) {
  var prompt = '你是一个语文素材分类助手。请将以下素材分类并返回JSON。\n标题:' + item.title + '\n内容:' + item.content.slice(0, 800) + '\n\n分类选项(8选1): 名言警句 / 好词好句 / 诗词名句 / 人物事例 / 时事热点 / 哲理故事 / 优美段落 / 其他\n\n只返回JSON: {"title":"简洁标题","category":"分类","tags":["标签1","标签2"]}';
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
          console.error('  AI解析失败:', e.message);
          resolve({ title: item.title, category: '其他', tags: [] });
        }
      });
    });
    req.on('error', function(e) { console.error('  AI请求失败:', e.message); reject(e); });
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
        VALUES (${id}, ${x.title.slice(0, 200)}, ${x.content.slice(0, 2000)}, ${x.category},
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
  console.log('=== 素材爬虫 ===');
  console.log('时间: ' + new Date().toISOString());
  console.log('AI: ' + (USE_AI ? 'DeepSeek' : '规则匹配'));
  console.log('');

  // 并行抓取
  var results = await Promise.all([
    crawlBilibili(),
    crawlZhiti(),
    crawlPeopleDaily()
  ]);
  var raw = [].concat.apply([], results);
  console.log('\n共抓取原始素材: ' + raw.length + ' 条');

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
