'use strict';
// 极简 .env 加载器：从项目根目录读取 .env 合并进 process.env（不覆盖已存在的变量）
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  let lines;
  try {
    lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/);
  } catch (e) {
    return;
  }
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i <= 0) continue;
    let key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

module.exports = { loadEnv, ROOT };
