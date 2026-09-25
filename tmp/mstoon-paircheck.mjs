/**
 * 用真实配对验 ⑦ 那两条 msToon 模板。
 *
 * 跑法：node tmp/mstoon-paircheck.mjs
 *
 * 判据是逐像素：我们的 applyPlan 跑出来的图，跟素材里那份产物比。
 * 对不上就报差多少像素、差在哪一档 —— 这些样本是同一套 UV 的「输入 → 产物」，
 * 是这个工程唯一认的那种地面真值。
 *
 * 读图用 tmp/png.mjs 的最小解码器（8bit 非隔行真彩/灰度）。
 *
 * 注意：这个文件曾经被 PowerShell 的 Get-Content/Set-Content 过一遍，加上了 BOM。
 * 已经用 write 工具重写成干净的 UTF-8 无 BOM —— 别再用 PowerShell 改它。
 */
import fs from 'node:fs';

await import('./register-loader.mjs');

const { decodePng } = await import('./png.mjs');
const { applyPlan, GAMES } = await import('../src/lib/modules/channels/ops.ts');

const ROOT = String.raw`E:\deepseek-harness\mmd集成工具\参考工具样本\参考工具制作的效果\MSToon`;

function load(p) {
  const d = decodePng(fs.readFileSync(p));
  return { width: d.w, height: d.h, data: d.data };
}

function compare(got, want) {
  if (got.width !== want.width || got.height !== want.height) {
    return { sizeMismatch: true };
  }
  const per = { r: { bad: 0, max: 0 }, g: { bad: 0, max: 0 }, b: { bad: 0, max: 0 }, a: { bad: 0, max: 0 } };
  const n = got.width * got.height;
  const hist = new Map();
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(got.data[i * 4 + c] - want.data[i * 4 + c]);
      if (d) {
        const k = 'rgba'[c];
        per[k].bad++;
        if (d > per[k].max) per[k].max = d;
        if (k === 'b') hist.set(d, (hist.get(d) || 0) + 1);
      }
    }
  }
  const worst = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return { n, per, worst };
}

/**
 * `hi` 是可选的：产物里那个 B 窗口是手填参数，每张贴图可以不一样。
 * 给了就用它覆盖模板里的窗口（模板里写的是 lo = 255 − hi）。
 */
const CASES = [
  {
    label: '原神 Vesna Body',
    dir: '原神\\Vesna',
    preset: 'mstoon-gi',
    src: 'Avatar_Girl_Sword_Vesna_Tex_Body_Lightmap.png',
    want: 'GI_Converted_Body_Lightmap.png'
  },
  {
    label: '原神 Vodyanitsa Body',
    dir: '原神\\Vodyanitsa',
    preset: 'mstoon-gi',
    src: 'Avatar_Girl_Catalyst_Vodyanitsa_Tex_Body_Lightmap.png',
    want: 'GI_Converted_Body_Lightmap.png'
  },
  {
    label: '原神 Vodyanitsa Hair',
    dir: '原神\\Vodyanitsa',
    preset: 'mstoon-gi',
    src: 'Avatar_Girl_Catalyst_Vodyanitsa_Tex_Hair_Lightmap.png',
    want: 'GI_Converted_Hair_Lightmap.png'
  },
  {
    label: '星铁 RobinS Body',
    dir: '崩坏：星穹铁道\\RobinS',
    preset: 'mstoon-hsr',
    src: 'Avatar_RobinS_00_Body_LightMap_L.png',
    want: 'HSR_Converted_Body_Lightmap.png'
  },
  {
    label: '星铁 RobinS Hair',
    dir: '崩坏：星穹铁道\\RobinS',
    preset: 'mstoon-hsr',
    src: 'Avatar_RobinS_00_Hair_LightMap.png',
    want: 'HSR_Converted_Hair_Lightmap.png',
    hi: 85
  },
  {
    label: '星铁 sparxie Body',
    dir: '崩坏：星穹铁道\\sparxie-elation-candy',
    preset: 'mstoon-hsr',
    src: 'Avatar_Sparxie_01_Body_LightMap_L.png',
    want: 'HSR_Converted_Body_Lightmap.png'
  },
  {
    label: '星铁 sparxie Hair',
    dir: '崩坏：星穹铁道\\sparxie-elation-candy',
    preset: 'mstoon-hsr',
    src: 'Avatar_Sparxie_01_Hair_LightMap.png',
    want: 'HSR_Converted_Hair_Lightmap.png',
    hi: 85
  },
  {
    label: '绝区零 Vivian Body',
    dir: '绝区零\\Vivian',
    preset: 'mstoon-zzz',
    src: 'Vivian_Body_2_M.png',
    want: 'ZZZ_Converted_Body.png'
  },
  {
    label: '绝区零 Pheony Hair',
    dir: '绝区零\\Pheony',
    preset: 'mstoon-zzz',
    src: 'Pheony_Body_M.png',
    want: 'ZZZ_Converted_Hair.png'
  }
];

let allGreen = true;
for (const c of CASES) {
  const preset = GAMES.find((g) => g.id === c.preset);
  if (!preset) {
    console.log(`✗ 找不到预设 ${c.preset}`);
    allGreen = false;
    continue;
  }
  const slotId = preset.slots[0].id;
  const src = load(`${ROOT}\\${c.dir}\\${c.src}`);
  const want = load(`${ROOT}\\${c.dir}\\${c.want}`);
  let plan = preset.plan;
  if (c.hi !== undefined) plan = { ...plan, b: { ...plan.b, lo: 255 - c.hi } };
  const got = applyPlan(want.width, want.height, plan, new Map([[slotId, src]]));
  const r = compare(got, want);
  const tag = r.sizeMismatch
    ? '尺寸对不上'
    : Object.entries(r.per).every(([, v]) => v.bad === 0)
      ? '四通道逐像素相同'
      : Object.entries(r.per)
          .filter(([, v]) => v.bad)
          .map(([k, v]) => `${k} 差 ${v.bad} 个（最大 ${v.max} 级）`)
          .join('  ');
  const ok = !r.sizeMismatch && Object.values(r.per).every((v) => v.bad === 0);
  if (!ok) allGreen = false;
  const win = c.hi === undefined ? '' : `  [窗口 ${c.hi}]`;
  console.log(`${ok ? '✓' : '✗'} ${c.label.padEnd(22)} 模板 ${c.preset.padEnd(12)} ${tag}${win}`);
  if (!ok && r.worst?.length) {
    console.log(`    B 的差值分布（差几级:几个像素）：${r.worst.map(([d, c2]) => `${d}:${c2}`).join('  ')}`);
  }
}

console.log(allGreen ? '\n全部逐像素相同' : '\n有对不上的，见上');

/* ============================================================
   FaceSDF 那条路：直接取通道（参照工具的做法）
   ------------------------------------------------------------
   只有星铁这组的源图跟产物同尺寸（脸图 1024²），能端到端比到逐像素。
   原神那组的源脸图跟产物尺寸不一样（中间缩放过），比不了 —— 别硬比。
   ============================================================ */
const { buildSdfFromChannel, channelGray } = await import('../src/lib/modules/mstoon/ops.ts');

const SDF_CASES = [
  {
    label: '星铁 RobinS SDF',
    dir: '崩坏：星穹铁道\\RobinS',
    src: 'W_160_Maid_FaceMap_02.png',
    want: 'HSR_Converted_Face_SDF.png',
    ch: 'a',
    invert: true
  },
  {
    label: '星铁 RobinS A 通道灰度',
    dir: '崩坏：星穹铁道\\RobinS',
    src: 'W_160_Maid_FaceMap_02.png',
    want: 'HSR_Converted_Face_SDF_A_Channel.png',
    ch: 'a',
    invert: false,
    gray: true
  },
  {
    label: '星铁 sparxie SDF',
    dir: '崩坏：星穹铁道\\sparxie-elation-candy',
    src: 'W_140_Girl_FaceMap_00.png',
    want: 'HSR_Converted_Face_SDF.png',
    ch: 'a',
    invert: true
  }
];

console.log('\n--- FaceSDF：取通道那条路 ---');
for (const c of SDF_CASES) {
  const src = load(`${ROOT}\\${c.dir}\\${c.src}`);
  const want = load(`${ROOT}\\${c.dir}\\${c.want}`);
  const got = c.gray
    ? channelGray(src, c.ch, c.invert)
    : buildSdfFromChannel(src, { ch: c.ch, invert: c.invert });
  const r = compare(got, want);
  const ok = !r.sizeMismatch && Object.values(r.per).every((v) => v.bad === 0);
  if (!ok) allGreen = false;
  const tag = r.sizeMismatch
    ? `尺寸对不上 ${got.width}×${got.height} vs ${want.width}×${want.height}`
    : Object.entries(r.per)
        .filter(([, v]) => v.bad)
        .map(([k, v]) => `${k} 差 ${v.bad} 个（最大 ${v.max} 级）`)
        .join('  ') || '四通道逐像素相同';
  console.log(`${ok ? '✓' : '✗'} ${c.label.padEnd(22)} ${tag}`);
}

process.exit(allGreen ? 0 : 1);
