/**
 * ① 文本栏「选文件」这条路的**参数穿透**测试。
 *
 * 为什么要专门测这条：用户 2026-09-24 报"选了文件、点还原没反应"，查出**两层**：
 *   ① 前端 `readTextFixed(path, mode)` 压根没有编码这个参数；
 *   ② 后端 `read_text_fixed` 也只收 path+mode，走的是 `repair_text_quiet` / `fix_fx_comments`
 *      两个"保留老签名"的薄包装 —— 于是界面上选日文编码，在这条路上**一次都没生效过**。
 *
 * 后端那一层由 `cargo test --lib` 的编码用例盯着；这里钉**前端这一层**：
 * 在 Node 里桩掉 `window.__TAURI_INTERNALS__.invoke`，看它到底把什么参数递出去了 ——
 * 不用开浏览器、不用起应用。
 *
 * 用法：node --import ./tmp/register-loader.mjs tmp\①编码传参.test.mjs
 */

let n = 0;
let bad = 0;
const ok = (c, m) => {
  n++;
  if (!c) {
    bad++;
    console.log(`  FAIL ${m}`);
  } else {
    console.log(`  ok   ${m}`);
  }
};

/** 桩：Tauri 的 invoke 只认 window.__TAURI_INTERNALS__，这里把它记下来 */
const 记录 = [];
globalThis.window = {
  __TAURI_INTERNALS__: {
    invoke: async (cmd, args) => {
      记录.push({ cmd, args });
      return { text: '', original: '', encoding: 'shift_jis', bom: false, changed: false, segments: [] };
    }
  }
};

const { readTextFixed } = await import('../src/lib/io.ts');

await readTextFixed('E:\\假\\a.txt', 'whole', 'shift_jis');
ok(记录.length === 1, '调用了一次 invoke');
ok(记录[0].cmd === 'read_text_fixed', `命令名对（实得 ${记录[0].cmd}）`);
ok(记录[0].args.path === 'E:\\假\\a.txt', '路径传过去了');
ok(记录[0].args.mode === 'whole', '模式传过去了');
ok(记录[0].args.targetEncoding === 'shift_jis', '**目标编码传过去了**（这条就是这次修的那个洞）');

记录.length = 0;
await readTextFixed('E:\\假\\b.fx', 'fx-comments', 'euc-jp');
ok(记录[0].args.targetEncoding === 'euc-jp', '换一档编码也照样传过去（euc-jp）');
ok(记录[0].args.mode === 'fx-comments', '注释那条路也带上了编码');

记录.length = 0;
await readTextFixed('E:\\假\\c.txt');
ok(记录[0].args.targetEncoding === undefined, '不传编码时是 undefined（后端按"自动认"处理）');

console.log(`\n通过 ${n} 条，失败 ${bad} 条`);
process.exit(bad ? 1 : 0);
