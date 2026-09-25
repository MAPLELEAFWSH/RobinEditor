// 检查几个刚被 PowerShell 改过的文件是否完好（用布尔值输出，避开控制台编码问题）。
import fs from 'node:fs';

const checks = [
  ['src/app.html', '<title>RobinEditor</title>'],
  ['src/app.html', '<!doctype html>'],
  ['src/app.html', 'localStorage.getItem'],
  ['package.json', '"name": "robin-editor"'],
  ['package.json', '"@sveltejs/kit"'],
  ['src-tauri/src/main.rs', 'fn main()'],
  ['src-tauri/src/main.rs', 'robin_editor_lib::run()'],
  ['src-tauri/Cargo.toml', 'name = "robin_editor_lib"'],
  ['src-tauri/Cargo.toml', 'tauri-plugin-opener'],
  ['src-tauri/tauri.conf.json', '"productName": "RobinEditor"'],
  ['src-tauri/tauri.conf.json', '"longDescription"'],
  ['src/routes/welcome/+page.svelte', 'RobinEditor'],
  ['src/routes/welcome/+page.svelte', '<script lang="ts">'],
  ['svelte.config.js', 'adapter-static'],
  ['vite.config.js', 'port'],
  ['src/lib/icons.ts', 'export const ICONS'],
  ['src/styles/tokens.css', '--rail-item-bg']
];

let bad = 0;
for (const [f, needle] of checks) {
  let txt = '';
  try {
    txt = fs.readFileSync(f, 'utf8');
  } catch (e) {
    console.log(`MISSING  ${f}`);
    bad++;
    continue;
  }
  const ok = txt.includes(needle);
  if (!ok) bad++;
  console.log(`${ok ? 'ok   ' : 'BROKEN'}  ${f}  ←  ${JSON.stringify(needle)}`);
}
console.log(`\n不合格项: ${bad}`);
