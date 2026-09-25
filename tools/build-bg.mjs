/**
 * 生成内置壁纸（1600×900 的 SVG）。
 *
 * 为什么不直接放照片：参考项目那七张 bg-0*.jpg 是它自己的素材，不能拿过来。
 * 它自己的 assets/paper/*.svg 也是程序化生成的 —— 这里照同样的路子自己画。
 *
 * 画法上刻意压了对比度：壁纸上还要盖正文，压不住就全靠 --cover-veil 硬遮，
 * 那样会变成一块灰纱，难看。所以每张都控制在"能看出是张图，但不抢字"。
 *
 * 用法：node tools/build-bg.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const W = 1600;
const H = 900;

/** 用确定性随机，保证每次生成的文件一致（便于版本管理） */
let seed = 20260214;
function rnd() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}

const defs = (id, from, to, angle = 160) => `
  <linearGradient id="g${id}" gradientTransform="rotate(${angle} 0.5 0.5)">
    <stop offset="0" stop-color="${from}"/>
    <stop offset="1" stop-color="${to}"/>
  </linearGradient>`;

function vignette() {
  return `
  <radialGradient id="vig" cx="50%" cy="42%" r="78%">
    <stop offset="55%" stop-color="#000" stop-opacity="0"/>
    <stop offset="100%" stop-color="#000" stop-opacity="0.16"/>
  </radialGradient>`;
}

const wrap = (body, extraDefs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>${extraDefs}${vignette()}</defs>
${body}
<rect width="${W}" height="${H}" fill="url(#vig)"/>
</svg>
`;

const BGS = [
  {
    id: 'dawn',
    name: '晨',
    svg: wrap(
      `<rect width="${W}" height="${H}" fill="url(#g1)"/>
       <circle cx="1180" cy="300" r="120" fill="#fff" opacity="0.5"/>
       <circle cx="1180" cy="300" r="200" fill="#fff" opacity="0.18"/>
       <path d="M0 620 C 260 560 520 660 780 610 C 1040 560 1320 640 1600 590 L1600 900 L0 900 Z" fill="#fff" opacity="0.22"/>
       <path d="M0 730 C 300 690 600 760 900 720 C 1200 680 1400 740 1600 710 L1600 900 L0 900 Z" fill="#fff" opacity="0.3"/>`,
      defs(1, '#cfe3f5', '#fdf3e4', 150)
    )
  },
  {
    id: 'tea',
    name: '茶',
    svg: wrap(
      `<rect width="${W}" height="${H}" fill="url(#g2)"/>
       <g stroke="#8a6a4a" stroke-opacity="0.10" stroke-width="1">
         ${Array.from({ length: 26 }, (_, i) => `<line x1="0" y1="${i * 36}" x2="${W}" y2="${i * 36}"/>`).join('')}
         ${Array.from({ length: 46 }, (_, i) => `<line x1="${i * 36}" y1="0" x2="${i * 36}" y2="${H}"/>`).join('')}
       </g>
       <circle cx="1240" cy="640" r="150" fill="#b98a5e" opacity="0.13"/>
       <circle cx="1240" cy="640" r="205" fill="none" stroke="#b98a5e" stroke-opacity="0.16" stroke-width="2"/>`,
      defs(2, '#f7ecdc', '#eee0c8', 200)
    )
  },
  {
    id: 'dusk',
    name: '暮',
    svg: wrap(
      `<rect width="${W}" height="${H}" fill="url(#g3)"/>
       <circle cx="420" cy="470" r="96" fill="#ffd9a0" opacity="0.72"/>
       <g fill="#2b1d3a" opacity="0.16">
         <path d="M0 640 L150 610 L300 650 L460 605 L640 655 L820 612 L1010 660 L1200 618 L1400 662 L1600 625 L1600 900 L0 900 Z"/>
       </g>
       <g fill="#1d1428" opacity="0.2">
         <path d="M0 740 L190 716 L380 752 L580 712 L800 756 L1020 718 L1250 758 L1450 722 L1600 750 L1600 900 L0 900 Z"/>
       </g>`,
      defs(3, '#f7c489', '#6d5a8c', 120)
    )
  },
  {
    id: 'night',
    name: '夜',
    svg: wrap(
      `<rect width="${W}" height="${H}" fill="url(#g4)"/>
       <g fill="#fff">
         ${Array.from({ length: 130 }, () => {
           const x = Math.round(rnd() * W);
           const y = Math.round(rnd() * 620);
           const r = (rnd() * 1.5 + 0.5).toFixed(2);
           const o = (rnd() * 0.55 + 0.25).toFixed(2);
           return `<circle cx="${x}" cy="${y}" r="${r}" opacity="${o}"/>`;
         }).join('')}
       </g>
       <circle cx="1290" cy="210" r="88" fill="#e8eefc" opacity="0.9"/>
       <circle cx="1256" cy="192" r="88" fill="#1b2440" opacity="0.95"/>
       <path d="M0 700 C 300 660 620 730 920 686 C 1220 642 1420 706 1600 676 L1600 900 L0 900 Z" fill="#050a18" opacity="0.5"/>`,
      defs(4, '#1b2440', '#101728', 170)
    )
  },
  {
    id: 'rain',
    name: '雨',
    svg: wrap(
      `<rect width="${W}" height="${H}" fill="url(#g5)"/>
       <g stroke="#fff" stroke-linecap="round">
         ${Array.from({ length: 150 }, () => {
           const x = Math.round(rnd() * (W + 200)) - 100;
           const y = Math.round(rnd() * H);
           const len = Math.round(rnd() * 40 + 18);
           const o = (rnd() * 0.28 + 0.06).toFixed(2);
           const w = (rnd() * 1.2 + 0.7).toFixed(2);
           return `<line x1="${x}" y1="${y}" x2="${x - 22}" y2="${y + len}" stroke-opacity="${o}" stroke-width="${w}"/>`;
         }).join('')}
       </g>
       <ellipse cx="800" cy="880" rx="900" ry="120" fill="#fff" opacity="0.16"/>`,
      defs(5, '#b9c7d4', '#8d9dae', 160)
    )
  },
  {
    id: 'sakura',
    name: '樱',
    svg: wrap(
      `<rect width="${W}" height="${H}" fill="url(#g6)"/>
       <g fill="#e0869f">
         ${Array.from({ length: 90 }, () => {
           const x = Math.round(rnd() * W);
           const y = Math.round(rnd() * H);
           const r = (rnd() * 7 + 3).toFixed(1);
           const o = (rnd() * 0.34 + 0.14).toFixed(2);
           const rot = Math.round(rnd() * 360);
           return `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${(r * 0.62).toFixed(1)}" opacity="${o}" transform="rotate(${rot} ${x} ${y})"/>`;
         }).join('')}
       </g>
       <path d="M0 760 C 340 730 700 800 1060 762 C 1320 736 1460 770 1600 750 L1600 900 L0 900 Z" fill="#fff" opacity="0.34"/>`,
      defs(6, '#fbe6ec', '#f7d3de', 150)
    )
  },
  {
    id: 'paper',
    name: '纸',
    svg: wrap(
      `<rect width="${W}" height="${H}" fill="url(#g7)"/>
       <g fill="#5d7089">
         ${Array.from({ length: 24 }, (_, r) =>
           Array.from({ length: 42 }, (_, c) => `<circle cx="${c * 39 + 20}" cy="${r * 39 + 20}" r="1.3"/>`).join('')
         ).join('')}
       </g>
       <rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#5d7089" stroke-opacity="0.12" stroke-width="2"/>`,
      defs(7, '#fbfcfd', '#eef2f7', 190)
    )
  }
];

const dir = path.join('static', 'bg');
fs.mkdirSync(dir, { recursive: true });

const index = [];
for (const b of BGS) {
  const file = path.join(dir, `${b.id}.svg`);
  fs.writeFileSync(file, b.svg, 'utf8');
  index.push({ id: b.id, name: b.name, size: b.svg.length });
  console.log(`${file}  ${(b.svg.length / 1024).toFixed(1)} KB`);
}

fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
console.log(`\n共 ${index.length} 张，清单写在 static/bg/index.json`);
