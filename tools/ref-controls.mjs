// 从参考项目里抽出"可调参数"面板：每个控件的 id / 类型 / 标签 / 范围。
import fs from 'node:fs';

const file = process.argv[2];
const html = fs.readFileSync(file, 'utf8');

// 每个控件往前找最近的 <label ...> 文本或最近的 <div class="...row..."> 里的标题
const ctrlRe = /<(input|select)\b([^>]*)>/gi;
const rows = [];
let m;
while ((m = ctrlRe.exec(html))) {
  const tag = m[1].toLowerCase();
  const attrs = m[2];
  const at = (n) => (attrs.match(new RegExp(`${n}="([^"]*)"`)) || [])[1] ?? '';
  const id = at('id');
  const type = at('type') || tag;
  if (type === 'hidden') continue;
  // 往回 900 字符找标签文字
  const back = html.slice(Math.max(0, m.index - 900), m.index);
  const labels = [...back.matchAll(/<label[^>]*>([^<]{1,40})</g)].map((x) => x[1].trim());
  const heads = [...back.matchAll(/class="[^"]*(?:name|title|label|field)[^"]*"[^>]*>([^<]{1,40})</g)].map(
    (x) => x[1].trim()
  );
  const near = (labels.at(-1) || heads.at(-1) || '').replace(/\s+/g, ' ');
  rows.push({
    id: id || '(no id)',
    type,
    label: near,
    min: at('min'),
    max: at('max'),
    step: at('step'),
    value: at('value'),
    options: tag === 'select' ? (html.slice(m.index, m.index + 900).match(/<option[^>]*>([^<]{1,24})</g) || []).length : ''
  });
}

const seen = new Set();
const uniq = rows.filter((r) => {
  const k = r.id + '|' + r.type;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

console.log(`共 ${rows.length} 个控件（去重 ${uniq.length}）\n`);
for (const r of uniq) {
  const range = r.min || r.max ? ` [${r.min}~${r.max}${r.step ? ' step ' + r.step : ''}]` : '';
  const opt = r.options ? ` (${r.options} 个选项)` : '';
  console.log(`${r.type.padEnd(9)} ${r.id.padEnd(26)}${r.label.padEnd(16)}${range}${opt}`);
}
