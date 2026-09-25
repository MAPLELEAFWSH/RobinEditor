/**
 * 全量测试入口：pnpm test
 *
 * 三部分：
 *   1. tmp/*.test.mjs 那批（各自都过 register-loader）
 *   2. tmp/ilmcheck/run.mjs —— ⑤ 的真实配对核对，不在上面那个 glob 里
 *   3. cargo test --lib —— ① 编码、PMX、路径、原子写的单测
 *
 * 任何一项非零都整体非零退出。以前没有这个入口，约 900 条断言
 * 谁也不拦，改了代码没人跑。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const LOADER = new URL('../tmp/register-loader.mjs', import.meta.url).href;
const results = [];

/** shell 交给 Node 自己的 spawn，不经 cmd —— 参数里有中文路径也不会被拆坏 */
function run(label, cmd, args) {
  console.log(`\n${'='.repeat(64)}\n${label}\n${'='.repeat(64)}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  const status = r.error ? `启动失败：${r.error.message}` : (r.status ?? '被杀掉');
  const ok = r.status === 0;
  results.push({ label, ok, status });
  return ok;
}

const suites = fs
  .readdirSync(path.join(ROOT, 'tmp'))
  .filter((f) => f.endsWith('.test.mjs'))
  .sort();

if (!suites.length) {
  console.error('tmp 里一套 *.test.mjs 都没有，glob 写错了');
  process.exit(1);
}

for (const f of suites) run(f, process.execPath, ['--import', LOADER, path.join('tmp', f)]);

run('ilmcheck（⑤ 真实配对）', process.execPath, [path.join('tmp', 'ilmcheck', 'run.mjs')]);

run('cargo test --lib', 'cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml', '--lib']);

const bad = results.filter((r) => !r.ok);
console.log(`\n${'='.repeat(64)}\n汇总：${results.length - bad.length} / ${results.length} 项通过\n${'='.repeat(64)}`);
for (const r of results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'}  ${r.label}${r.ok ? '' : `   （${r.status}）`}`);
if (bad.length) {
  console.log(`\n${bad.length} 项没过：`);
  for (const r of bad) console.log(`  - ${r.label}`);
}
process.exit(bad.length ? 1 : 0);
