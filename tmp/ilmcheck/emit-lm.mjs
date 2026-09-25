/**
 * 用真代码把 vivian 那两套的 LM 打出来，落成裸 RGBA。
 *
 * 跑法：node tmp/ilmcheck/emit-lm.mjs
 * 产出：tmp/ilmcheck/data/out_<stem>_lm.raw（跟 dump-vivian.mjs 的命名对齐）
 *
 * 走的就是 run.mjs 验过的那条路。上游做对比图时读这个文件，
 * 保证图里画的是真代码的产物，不是另写的复现。
 */
import fs from 'node:fs';

// 跟 run.mjs 一样：垫片和 $lib 别名都从 register-loader 来，加载的是真文件
await import('../register-loader.mjs');

const ops = await import('../../src/lib/modules/ilm/ops.ts');

const DATA = new URL('./data/', import.meta.url);
const dataPath = (name) => new URL(name, DATA);
const sizes = JSON.parse(fs.readFileSync(dataPath('sizes.json'), 'utf8'));

const load = (name) => {
  const [w, h] = sizes[name];
  const raw = fs.readFileSync(dataPath(`${name}.raw`));
  return new ImageData(new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength), w, h);
};

const KERNEL = process.argv[2] ?? 'lanczos';
for (const stem of ['body_1', 'body_2']) {
  const A = load(`${stem}_A`);
  const M = load(`${stem}_M`);
  const N = load(`${stem}_N`);
  const LM = load(`${stem}_LM`);
  const t0 = Date.now();
  const out = ops.packLm(
    LM.width,
    LM.height,
    ops.ZZZ_MAP,
    new Map([
      ['A', A],
      ['M', M],
      ['N', N]
    ]),
    KERNEL,
    0
  );
  const d = ops.diffAgainst(out, LM);
  const byCh = Object.fromEntries(d.perChannel.map((c) => [c.ch, c]));
  fs.writeFileSync(
    dataPath(`out_${stem}_lm.raw`),
    Buffer.from(out.data.buffer, out.data.byteOffset, out.data.byteLength)
  );
  sizes[`out_${stem}_lm`] = [out.width, out.height];
  console.log(
    `${stem} ${KERNEL}  R ${(byCh.r.identical * 100).toFixed(2)}%` +
      `  G ${(byCh.g.identical * 100).toFixed(2)}% / MAE ${byCh.g.meanDiff.toFixed(3)}` +
      `  B ${(byCh.b.identical * 100).toFixed(2)}%   ${Date.now() - t0}ms`
  );
}
fs.writeFileSync(dataPath('sizes.json'), JSON.stringify(sizes, null, 2));
