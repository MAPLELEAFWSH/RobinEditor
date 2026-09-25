/**
 * 长路径断行的守卫。
 *
 * 为什么要有这套：用户实测报过两次「完成提示撑破卡片 / 路径跟旁边的字叠在一起」。
 * 病根不在 ⑥ 那个模块，在全局 CSS —— 一条一百多字符的路径落在
 * `white-space:nowrap` 上、或者落在没写 `min-width:0` 的 flex 子项里，就一定溢出。
 * 修完容易、**再被人改回去也容易**，所以把这几条钉住。
 *
 * 判据只认**规则本身在不在**（不去猜哪一行会不会溢出）：CSS 是全局的，
 * 这几条一没，全库所有放路径的地方都跟着松。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'src', 'styles', 'wb.css'), 'utf8');

let n = 0;
let bad = 0;
const ok = (c, m) => {
  n++;
  if (!c) {
    bad++;
    console.log(`  FAIL ${m}`);
  }
};

/** 取出某个选择器的声明块（`.mono { … }` 这种，只取第一段） */
function 块(选择器) {
  const i = css.indexOf(`\n${选择器} {`);
  if (i < 0) return '';
  const j = css.indexOf('}', i);
  return j < 0 ? '' : css.slice(i, j);
}

/* ---- 1. `.mono` 就是"路径/代码/数值"，必须一律允许断行 ---- */
const mono = 块('.mono');
ok(mono !== '', 'wb.css 里有 `.mono` 规则');
ok(/overflow-wrap:\s*anywhere/.test(mono), '`.mono` 要 overflow-wrap:anywhere（长路径得能断）');
ok(/min-width:\s*0/.test(mono), '`.mono` 要 min-width:0（否则 flex/grid 子项按内容撑开，压不下去）');

/* ---- 2. `.nowrap` 不许挡住路径的断行 ---- */
ok(/\.nowrap\.mono\s*\{[^}]*white-space:\s*normal/.test(css), '要有 `.nowrap.mono { white-space: normal }`（短标签照旧不折，是路径就让它断）');
ok(/\.nowrap\s*\{[^}]*white-space:\s*nowrap/.test(css), '`.nowrap` 本身仍然是 nowrap（别为了路径把所有短标签都放开）');

/* ---- 3. 完成提示：正文那一格必须能压窄 ---- */
const noteDiv = /\.note\s*>\s*div\s*\{([^}]*)\}/.exec(css);
ok(!!noteDiv, '要有 `.note > div` 规则（完成提示的正文就在这一格）');
ok(noteDiv && /min-width:\s*0/.test(noteDiv[1]), '`.note > div` 要 min-width:0（flex 子项不写它，一条长路径就把提示条顶出去）');
ok(noteDiv && /overflow-wrap:\s*anywhere/.test(noteDiv[1]), '`.note > div` 要 overflow-wrap:anywhere');

/* ---- 4. 标题+读数那一行：第二列原来是 `auto`，长路径顶宽整行 ---- */
const row = 块('.wb .row');
ok(row !== '', 'wb.css 里有 `.wb .row` 规则');
ok(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*auto\)/.test(row), '`.wb .row` 第二列要 minmax(0,auto)（写成裸 auto 就不肯变窄）');
ok(/overflow-wrap:\s*anywhere/.test(块('.wb .row__v')), '`.wb .row__v` 要 overflow-wrap:anywhere');

/* ---- 5. 键值行 / 清单行：子项都要能被压窄 ---- */
ok(/overflow-wrap:\s*anywhere/.test(块('.kv__r span')), '`.kv__r span` 要 overflow-wrap:anywhere');
ok(/flex-wrap:\s*wrap/.test(块('.kv__r')), '`.kv__r` 要 flex-wrap:wrap');
ok(/min-width:\s*0/.test(块('.list li > *')), '`.list li > *` 要 min-width:0');

/* ---- 6. 规范 §十一：中区＝整幅、参数＝浮层抽屉（**§八 的"收窄/可收起"已被否掉**）----
   用户原话："别死都护着右栏了，占空间还不承认"。 ---- */
const tokens = fs.readFileSync(path.join(ROOT, 'src', 'styles', 'tokens.css'), 'utf8');
const wb = 块('.wb');
const side块 = 块('.wb__side');

ok(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/.test(wb), '`.wb` 默认必须**只有一列**（中区＝整幅，没有别的列在吃宽度）');
ok(/html\.side-pin\s+\.wb\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(/.test(css), '只有"钉住"时才允许出现第二列（`html.side-pin .wb`）');
ok(/position:\s*fixed/.test(side块), '参数必须是**浮层**（`.wb__side` position: fixed），盖在中区之上');
ok(/transform:\s*translateX\(/.test(css) && /html\.side-open\s+\.wb__side\s*\{[^}]*translateX\(0\)/.test(css), '抽屉默认要滑出去（translateX），`.side-open` 才滑回来 —— 默认收起');
ok(/html\.side-pin\s+\.wb__side\s*\{[^}]*position:\s*sticky/.test(css), '钉住时才改成占一列（sticky）');

const 上限 = /--side-max:\s*([\d.]+)rem/.exec(tokens);
ok(!!上限, 'tokens.css 里要有 `--side-max`');
ok(上限 && Number(上限[1]) <= 18, `参数宽度上限要 ≤ 18rem（规范 §十一；实得 ${上限?.[1]}rem）`);
const 默认宽 = /--side-w:\s*([\d.]+)rem/.exec(tokens);
ok(默认宽 && Number(默认宽[1]) <= 18, `参数默认宽度也要 ≤ 18rem（实得 ${默认宽?.[1]}rem）`);

/* 算一遍：1707 视口 − 左导航(21rem) → 中区应当就是这么多（页面自己左右各 16px 留白） */
const 左导航rem = Number(/--rail-width:\s*([\d.]+)rem/.exec(tokens)?.[1] ?? 21);
const 中区应有 = 1707 - 左导航rem * 16;
ok(中区应有 === 1371, `1707 视口扣掉左导航（${左导航rem}rem）应当是 1371px（实得 ${中区应有}）`);

console.log(`wrap-css：${n} 条断言，${bad} 条没过`);
process.exit(bad ? 1 : 0);
