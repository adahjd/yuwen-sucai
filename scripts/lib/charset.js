'use strict';
// 根据 <meta charset> 或字节特征自动解码 HTML（处理 GB2312/GBK 与 UTF-8 混用站点）
function decodeHtml(buf) {
  if (!buf) return '';
  // 用 latin1 读取头部 ASCII 部分，定位 meta charset
  const head = new TextDecoder('latin1').decode(buf.slice(0, 2000));
  const m = head.match(/charset=["']?([a-zA-Z0-9_-]+)/i);
  const cs = m ? m[1].toLowerCase() : '';
  if (cs.includes('gb') || cs.includes('2312')) {
    return new TextDecoder('gbk').decode(buf);
  }
  if (cs.includes('utf')) {
    return new TextDecoder('utf-8').decode(buf);
  }
  // 无声明：先按 UTF-8，若出现大量替换符则回退 GBK
  const u8 = new TextDecoder('utf-8').decode(buf);
  const reps = (u8.match(/\uFFFD/g) || []).length;
  return reps > 0 ? new TextDecoder('gbk').decode(buf) : u8;
}

module.exports = { decodeHtml };
