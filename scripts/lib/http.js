'use strict';
// 带重试 / 限流退避 / 超时的 HTTP 客户端。返回 { status, body, buf }：
//   body 为按 UTF-8 解码的文本（JSON / UTF-8 站点用），buf 为原始字节（GBK 等编码站点用）。
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

const BASE_HEADERS = {
  'User-Agent': UA,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9'
};

async function get(url, extraHeaders, opts) {
  opts = opts || {};
  const retries = opts.retries == null ? 3 : opts.retries;
  const timeout = opts.timeout || 15000;
  const headers = Object.assign({}, BASE_HEADERS, extraHeaders || {});
  let last = { status: 0, body: '', buf: null };

  for (let i = 0; i <= retries; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      const res = await fetch(url, { headers, signal: ctrl.signal, redirect: 'follow' });
      clearTimeout(timer);
      const buf = await res.arrayBuffer();
      const body = new TextDecoder('utf-8').decode(buf);
      last = { status: res.status, body, buf };
      if (res.status === 412 || res.status === 429 || res.status === 403) {
        await sleep(5000 * (i + 1));
        continue;
      }
      return last;
    } catch (e) {
      last = { status: 0, body: '', buf: null };
      await sleep(2000 * (i + 1));
    }
  }
  return last;
}

async function getJson(url, extraHeaders, opts) {
  const r = await get(url, extraHeaders, opts);
  if (r.status !== 200) return null;
  try { return JSON.parse(r.body); } catch (e) { return null; }
}

module.exports = { get, getJson, sleep, UA, BASE_HEADERS };
