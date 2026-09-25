/**
 * 从 @iconify-json/mdi 里挑出本项目要用的图标，生成 src/lib/icons.ts。
 *
 * 为什么这么做：之前手写的 SVG path 是"看着像"的，线条比例和 24 栅格对不上，
 * 缩放后就露馅。这里直接取 Material Design Icons（GMM 用的也是 MDI）的官方
 * path，只把需要的几十个内联进来，不引运行时依赖、不走 CDN。
 *
 * 用法：node tools/build-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const data = JSON.parse(
  fs.readFileSync(require.resolve('@iconify-json/mdi/icons.json'), 'utf8')
);

/** 逻辑名 → MDI 图标名。逻辑名是代码里引用的稳定键。 */
const WANT = {
  // 一级分组
  'group.work': 'view-dashboard-outline',
  'group.texture': 'image-multiple-outline',
  'group.grade': 'palette-outline',
  'group.text': 'translate',
  'group.render': 'lightbulb-on-outline',
  'group.proj': 'folder-swap-outline',
  'nav.settings': 'cog-outline',
  'nav.about': 'information-outline',

  // 工作区
  'leaf.overview': 'view-grid-outline',
  'leaf.recent': 'history',
  'leaf.quick': 'lightning-bolt-outline',

  // 各功能
  'leaf.channels': 'layers-triple-outline',
  'leaf.ilm': 'texture-box',
  'leaf.mstoon': 'palette-swatch-outline',
  'leaf.ikclut': 'gradient-horizontal',
  'leaf.glitch': 'file-document-outline',
  'leaf.ray': 'tune-variant',
  'leaf.yaku': 'bottle-tonic-outline',
  'leaf.migrate': 'folder-move-outline',

  // 界面
  'ui.collapse': 'chevron-double-left',
  'ui.expand': 'chevron-double-right',
  'ui.caret': 'chevron-right',
  'ui.import': 'tray-arrow-down',
  'ui.folder': 'folder-open-outline',
  'ui.export': 'content-save-outline',
  'ui.backup': 'backup-restore',
  'ui.check': 'check',
  'ui.close': 'close',
  'ui.search': 'magnify',
  'ui.warn': 'alert-outline',
  'ui.dark': 'weather-night',
  'ui.light': 'white-balance-sunny',
  'ui.hue': 'eyedropper-variant',
  'ui.run': 'lightning-bolt',
  'ui.open': 'open-in-new',
  'ui.delete': 'delete-outline',
  'ui.add': 'plus',
  'ui.refresh': 'refresh',

  // 设置面板与状态栏
  'ui.speed': 'speedometer',
  'ui.tune': 'tune',
  'ui.wallpaper': 'wallpaper',
  'ui.contrast': 'theme-light-dark',
  'ui.cards': 'cards-outline',
  'ui.blur': 'blur',
  'ui.motion': 'motion-play-outline',
  'ui.swatch': 'palette-swatch',
  'ui.shuffle': 'shuffle-variant',
  'ui.restore': 'restore',
  'ui.chevronUp': 'chevron-up',
  'ui.chevronDown': 'chevron-down',
  'ui.pause': 'pause',
  'ui.play': 'play',

  // brand.* 见下面的 WANT_BRAND
  'brand.link': 'link-variant',

  // 工作台通用件
  'ui.image': 'image-outline',
  'ui.images': 'image-multiple-outline',
  'ui.preview': 'eye-outline',
  'ui.code': 'code-braces',
  'ui.file': 'file-outline',
  'ui.dir': 'folder-outline',
  'ui.copy': 'content-copy',
  'ui.save': 'content-save-outline',
  'ui.compare': 'compare',
  'ui.grid': 'grid',
  'ui.list': 'format-list-bulleted',
  'ui.arrowRight': 'arrow-right',
  'ui.info': 'information-outline',
  'ui.help': 'help-circle-outline',
  'ui.lock': 'lock-outline',
  'ui.unlock': 'lock-open-variant-outline',
  'ui.undo': 'undo',
  'ui.redo': 'redo',
  'ui.plusCircle': 'plus-circle-outline',
  'ui.minusCircle': 'minus-circle-outline',
  'ui.eyedropper': 'eyedropper',
  'ui.download': 'download-outline',
  'ui.upload': 'upload-outline',
  'ui.table': 'table',
  'ui.curve': 'chart-timeline-variant',
  'ui.channel': 'layers-outline',
  'ui.pack': 'package-variant-closed',
  'ui.palette': 'palette',
  'ui.text': 'format-text',
  'ui.replace': 'find-replace',
  'ui.alert': 'alert-circle-outline',
  'ui.shadow': 'circle-half-full',
  'ui.face': 'face-man-outline',
  'ui.bottle': 'bottle-tonic-outline',
  'ui.engine': 'engine-outline'
};

/**
 * 品牌图标走 simple-icons。
 * MDI 里没有 bilibili（那个是厂商 logo，MDI 不收），github 两边都有，
 * 但放一起取更省事。simple-icons 和 MDI 一样是 24 栅格、currentColor。
 */
const WANT_BRAND = {
  'brand.bilibili': 'bilibili',
  'brand.github': 'github'
};

const out = [];
const missing = [];
for (const [key, name] of Object.entries(WANT)) {
  const ic = data.icons[name];
  if (!ic) {
    missing.push(`${key} → ${name}`);
    continue;
  }
  out.push([key, ic.body]);
}

const brandData = JSON.parse(
  fs.readFileSync(require.resolve('@iconify-json/simple-icons/icons.json'), 'utf8')
);
for (const [key, name] of Object.entries(WANT_BRAND)) {
  const ic = brandData.icons[name];
  if (!ic) {
    missing.push(`${key} → simple-icons/${name}`);
    continue;
  }
  out.push([key, ic.body]);
}

if (missing.length) {
  console.error('这些图标在图标集里找不到，请换名字：\n  ' + missing.join('\n  '));
  process.exitCode = 1;
}

const header = `/**
 * 图标表 —— 自动生成，不要手改。
 * 生成脚本：tools/build-icons.mjs （数据源 @iconify-json/mdi，Material Design Icons）
 *
 * 全部是 24×24 栅格上的填充路径，用 currentColor 上色。
 * 界面图标取 Material Design Icons，品牌图标取 simple-icons。
 * 用 <Icon name="ui.import" /> 引用（见 src/lib/components/Icon.svelte）。
 */
export const ICONS: Record<string, string> = {
`;
const body = out.map(([k, v]) => `  '${k}': '${v.replace(/'/g, "\\'")}',`).join('\n');
const footer = `
};

/** MDI 都是 24 栅格，这里留个明口，将来混别的图标集时不至于写死。 */
export const ICON_VIEWBOX = '0 0 24 24';
`;

fs.mkdirSync('src/lib', { recursive: true });
fs.writeFileSync('src/lib/icons.ts', header + body + footer, 'utf8');
console.log(`已写出 src/lib/icons.ts，共 ${out.length} 个图标（缺失 ${missing.length} 个）`);
