/**
 * 把法线那两对真实配对导成裸 RGBA，给 `tmp/法线转换.test.mjs` 当基准。
 *
 * 配对在 `参考工具样本\参考工具制作的效果\MSToon\绝区零\` 下（同一目录里既有解包源图
 * 又有产物）：`Vivian_Body_2_N.png` / `Pheony_Body_N.png` → `ZZZ_Converted_Normal.png`。
 * 那两张源图跟 `实战测试用例` 里养乐多那份**逐字节相同**（SHA256 比过）。
 *
 * 只落**左上 512×512** 的裁剪：这几个文件要进仓库，整张 1024² 是 4MB × 4。
 * 公式与取整的结论早在 Python 探针里按整张图量过（`tmp/probe-法线转换浮点.py`，
 * 两组 × 三路 100% 逐像素相同），这里要守的是"以后改坏了能发现"。
 *
 * 跑法：node tmp/normalcheck/dump-normal.mjs
 * 产出：tmp/normalcheck/data/*.raw + sizes.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { decodePng, crop } from './png.mjs';

const BASE = String.raw`E:\deepseek-harness\mmd集成工具\参考工具样本\参考工具制作的效果\MSToon\绝区零`;
const OUT = 'tmp/normalcheck/data';
const SIZE = 512;

const PAIRS = [
  ['vivian', path.join(BASE, 'Vivian', 'Vivian_Body_2_N.png'), path.join(BASE, 'Vivian', 'ZZZ_Converted_Normal.png')],
  ['pheony', path.join(BASE, 'Pheony', 'Pheony_Body_N.png'), path.join(BASE, 'Pheony', 'ZZZ_Converted_Normal.png')]
];

fs.mkdirSync(OUT, { recursive: true });
const sizes = {};
for (const [name, src, out] of PAIRS) {
  for (const [tag, file] of [['n', src], ['out', out]]) {
    const got = crop(decodePng(fs.readFileSync(file)), SIZE);
    const f = `${name}_${tag}.raw`;
    fs.writeFileSync(path.join(OUT, f), got.data);
    sizes[`${name}_${tag}`] = [got.w, got.h];
    console.log(`${f.padEnd(16)} ${got.w}x${got.h}  ${(got.data.length / 1048576).toFixed(1)}MB  ← ${path.basename(file)}`);
  }
}
fs.writeFileSync(path.join(OUT, 'sizes.json'), JSON.stringify(sizes, null, 2));
console.log('\nsizes.json 写好');
