'use strict';
// 数据源注册表：新增数据源时在此处登记即可（每个源导出 { name, crawl }）
const bilibili = require('./bilibili');
const people = require('./people');
const zuowen = require('./zuowen');

const SOURCES = [bilibili, people, zuowen];

module.exports = { SOURCES };
