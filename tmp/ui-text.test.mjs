/**
 * 界面文案里不许有 Markdown 残留。
 *
 * Svelte 不渲染 Markdown —— 模板里写 `**粗体**`，用户看到的就是四个星号。
 * 这个坑真的踩过：Glitch 的词表提示、上限提示、Mstoon 的生成规则说明、
 * Ray 的编码说明，四处都带着 `**` 上过界面。
 *
 * 扫的是**模板部分**（去掉 <script> / <style> / <!-- -->），
 * 注释里写 `**` 是正常的，不算。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

let n = 0;
const ok = (c, m) => {
  n++;
  if (!c) {
    console.error(`FAIL ${m}`);
    process.exitCode = 1;
  }
};

/** 去掉脚本、样式、HTML 注释，剩下的才是真渲染出来的部分 */
export function stripSvelte(src) {
  return src
    .replace(/<script[\s\S]*?<\/script>/g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/<style[\s\S]*?<\/style>/g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ''));
}

/** 返回 [{ line, text }]，line 是**原文件**里的行号 */
export function findResidue(src) {
  const out = [];
  stripSvelte(src)
    .split('\n')
    .forEach((text, i) => {
      if (text.includes('**')) out.push({ line: i + 1, text: text.trim() });
    });
  return out;
}

/**
 * `<script>` 里**字符串字面量**含 `**` 的地方。
 *
 * 为什么还要扫脚本：界面文案不都写在模板里 —— 迁移那页的完成提示、乱码那页的
 * "现在是离线"，都是模板串拼出来的，用户在界面上看到的就是原样的四个星号。
 * 只扫模板的写法**看不见这一类**（所以漏过去过一次）。
 * 注释里写 `**` 是本工程的常态（满篇都是），必须跳过。
 */
export function findScriptResidue(src) {
  const out = [];
  for (const block of src.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
    const 起行 = src.slice(0, block.index).split('\n').length;
    const 码 = block[1];
    let i = 0;
    let 行 = 起行;
    let 串 = null;
    let 串起行 = 0;
    let 串起点 = 0;
    let 注 = null;
    while (i < 码.length) {
      const c = 码[i];
      const d = 码[i + 1];
      if (注 === 'line') {
        if (c === '\n') {
          注 = null;
          行++;
        }
        i++;
        continue;
      }
      if (注 === 'block') {
        if (c === '*' && d === '/') {
          注 = null;
          i += 2;
          continue;
        }
        if (c === '\n') 行++;
        i++;
        continue;
      }
      if (串) {
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === 串) {
          const 文 = 码.slice(串起点, i);
          if (文.includes('**')) {
            const 那行 = 文.split('\n').find((x) => x.includes('**')) ?? 文;
            out.push({ line: 串起行, text: 那行.trim() });
          }
          串 = null;
          i++;
          continue;
        }
        if (c === '\n') 行++;
        i++;
        continue;
      }
      if (c === '/' && d === '/') {
        注 = 'line';
        i += 2;
        continue;
      }
      if (c === '/' && d === '*') {
        注 = 'block';
        i += 2;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        串 = c;
        串起行 = 行;
        串起点 = i + 1;
        i++;
        continue;
      }
      if (c === '\n') 行++;
      i++;
    }
  }
  return out;
}

/* 先证伪：探测器本身得抓得住。不写这条的话，正则写错会变成"全绿" */
const probe = '<script>let a = 1; /** 注释里的 ** 不算 */</script>\n<p>这是**粗体**</p>\n<!-- **注释** -->';
const hit = findResidue(probe);
ok(hit.length === 1, `探测器漏了：期望 1 处，实际 ${hit.length}`);
ok(hit[0]?.line === 2, `行号不对：期望 2，实际 ${hit[0]?.line}`);
ok(hit[0]?.text === '<p>这是**粗体**</p>', `抓到的行不对：${hit[0]?.text}`);
ok(findResidue('<p>没有星号</p>').length === 0, '干净模板被误报');

/* 脚本那半也要先证伪 */
const probe2 = [
  '<script>',
  '// **注释**里的不算',
  '/* **块注释**也不算 */',
  'const a = "**去 MMD 拖这一个**";',
  'const b = `普通 ${1} 模板串`;',
  '</script>',
].join('\n');
const hit2 = findScriptResidue(probe2);
ok(hit2.length === 1, `脚本探测器漏了：期望 1 处，实际 ${hit2.length}（${JSON.stringify(hit2)}）`);
ok(hit2[0]?.line === 4, `脚本探测器行号不对：期望 4，实际 ${hit2[0]?.line}`);
ok(findScriptResidue('<script>const b = `没有星号 ${1}`;</script>').length === 0, '干净脚本被误报');

/* 再扫真文件 */
const files = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.svelte')) files.push(p);
  }
})('src');

ok(files.length > 20, `应该在 src 下扫到一票 .svelte，只扫到 ${files.length} 个`);

let total = 0;
let 脚本处 = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const r of findResidue(src)) {
    total++;
    console.error(`  模板 ${f}:${r.line}  ${r.text}`);
  }
  for (const r of findScriptResidue(src)) {
    脚本处++;
    console.error(`  脚本 ${f}:${r.line}  ${r.text}`);
  }
}
ok(total === 0, `模板里有 ${total} 处 Markdown 残留（见上），换成 <b>…</b>`);
ok(脚本处 === 0, `脚本里的界面文案还有 ${脚本处} 处 Markdown 残留（见上），去掉星号或换「」`);

console.log(`ui-text：${files.length} 个 .svelte，模板 ${total} 处残留、脚本 ${脚本处} 处，${n} 条断言通过`);
