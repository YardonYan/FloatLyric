'use strict';

(function () {

const FONTS = {
  system: 'system-ui, "Segoe UI Variable Display", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif',
  yahei: '"Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
  dengxian: '"DengXian", "等线", "Microsoft YaHei", sans-serif',
  simhei: '"SimHei", "黑体", "Microsoft YaHei", sans-serif',
  simsun: '"SimSun", "宋体", serif',
  kaiti: '"KaiTi", "楷体", "STKaiti", serif',
  segoe: '"Segoe UI", system-ui, sans-serif'
};

const api = { FONTS, stack: k => FONTS[k] || FONTS.system };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.Fonts = api;

})();