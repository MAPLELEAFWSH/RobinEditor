/**
 * 图层预设 —— 一套图层栈存下来，下次一键搭好。
 *
 * 纯逻辑放这儿（不引 rune），存放那一半在 `layers-preset.svelte.ts`。
 * 这么分是因为「把预设套到当前槽位上」这段最容易出错，而它又完全可测 ——
 * 槽位对不对得上是靠**下标**兜底的，错一格整套图层的源就全指错了。
 *
 * 为什么不存具体槽位 id 就完事：槽位是固定的四个（diffuse / lightmap / s3 / s4），
 * 但用户存的预设里可能引用了当时有数据、现在没数据的槽。套的时候要能降级成常量，
 * 而不是做一个源是空的图层（那种图层看起来在、实际什么都没画）。
 */

import type { Layer, LayerChannel } from './modules/channels/ops';

/** 预设里的一层：跟 Layer 一样，但没有 id（id 套的时候才发） */
export type LayerSeed = {
  name: string;
  on: boolean;
  /** 槽位 id。套的时候这个槽没数据就降级成常量 */
  slot: string;
  ch: LayerChannel;
  invert: boolean;
  constant: number;
  /** 调整链照抄（是纯数据，没有副作用） */
  adjust: Layer['adjust'];
  adjustScope: Layer['adjustScope'];
  blend: Layer['blend'];
  opacity: number;
  mask: Layer['mask'];
};

export type LayerPreset = {
  id: string;
  name: string;
  /** 一句话，界面上当提示 */
  hint: string;
  builtin?: boolean;
  layers: LayerSeed[];
};

const MASK_OFF = {
  on: false,
  slot: '',
  ch: 'b' as const,
  invert: false,
  black: 0,
  white: 255,
  gamma: 1,
  blur: 0
};

/** 写预设时的简写，只有要改的字段才有 */
function seed(p: Partial<LayerSeed> & { name: string }): LayerSeed {
  return {
    on: true,
    slot: '',
    ch: 'rgb',
    invert: false,
    constant: 128,
    adjust: [],
    adjustScope: 'all',
    blend: 'normal',
    opacity: 1,
    mask: { ...MASK_OFF },
    ...p
  };
}

/**
 * 内置那几套。
 *
 * 前三套是原来写在 `Channels.svelte` 里的那三套「现成流程」，这轮并过来的 ——
 * 之前界面上**同时存在两份预设列表**（那边的三套 + 这模块的三套），
 * 同一个面板里两排按钮干同一件事，那是重复不是功能。
 * 并过来之后保留下来的就是这三套：它们用的是真槽位名（diffuse / lightmap）
 * 和 lightmap 的 **B 通道** —— B 才是这套打包里的金属度（见 ⑦ 游戏分区那页的实测结论），
 * 我原来自己写的那两套用 G 通道，方向是错的，删了。
 *
 * 后面两套是这模块新加的，那边原来没有：一套走 A 路蒙版、一套是纯调整。
 */
const LM_MASK = (): Layer['mask'] => ({
  on: true,
  slot: 'lightmap',
  ch: 'b',
  invert: false,
  black: 8,
  white: 210,
  gamma: 1,
  blur: 1
});

export const BUILTIN_PRESETS: LayerPreset[] = [
  {
    id: 'metal-mask',
    name: 'diffuse + LM.B 蒙版',
    hint: 'diffuse 一个图层，蒙版取 lightmap 的 B 通道。金属材质那条流程的起点。',
    builtin: true,
    layers: [seed({ name: 'diffuse', slot: 'diffuse', mask: LM_MASK() })]
  },
  {
    id: 'metal-bright',
    name: '金属区提亮',
    hint: '底层 diffuse 带 LM.B 蒙版，上面再叠一层 B 通道走滤色。',
    builtin: true,
    layers: [
      seed({ name: 'diffuse', slot: 'diffuse', mask: LM_MASK() }),
      seed({
        name: '金属区',
        slot: 'lightmap',
        ch: 'b',
        blend: 'screen',
        opacity: 0.6,
        mask: LM_MASK()
      })
    ]
  },
  {
    id: 'metal-dark',
    name: '金属区压暗',
    hint: '同上，改用正片叠底。',
    builtin: true,
    layers: [
      seed({ name: 'diffuse', slot: 'diffuse', mask: LM_MASK() }),
      seed({
        name: '金属区',
        slot: 'lightmap',
        ch: 'b',
        blend: 'multiply',
        opacity: 0.8,
        mask: LM_MASK()
      })
    ]
  },
  {
    id: 'bi-darken-by-alpha',
    name: '按 A 路压暗',
    hint: '拿 diffuse 的透明通道当蒙版，往暗里乘一层。抠图边缘和半透明区会自然过渡。',
    builtin: true,
    layers: [
      seed({
        name: '压暗',
        constant: 70,
        blend: 'multiply',
        opacity: 0.8,
        mask: { ...MASK_OFF, on: true, slot: 'diffuse', ch: 'a' }
      })
    ]
  },
  {
    id: 'bi-punch',
    name: '整体加对比 + 提饱和',
    hint: '一层，源就是 diffuse 本身，调整栈里放了对比和 HSL。当"最后统一走一遍"用。',
    builtin: true,
    layers: [
      seed({
        name: '统一调色',
        slot: 'diffuse',
        adjust: [
          { k: 'brightness-contrast', brightness: 0, contrast: 18 },
          { k: 'hsl', h: 0, s: 12, l: 0 }
        ] as Layer['adjust']
      })
    ]
  }
];

/**
 * 新一层该用哪个槽当源。
 *
 * **挑第一个还没被占的**，不是永远用第一个。
 * 上一版写死"取第一个槽"，结果连点两次"加图层"得到的两层源是同一张图 ——
 * 界面上看着加了两层，其实叠的是同一张，得自己点开一层改源才发现。
 *
 * `reserved` 是栈以外已经用掉的槽（混合页的底层就是这种：它不在 layers 里，
 * 但那个槽归它）。不排掉的话新层会做成"底图的副本"，标题写「图层 2 底层」。
 *
 * 槽都用完了就退回第一个没被 reserved 的 —— 那时候说明层比槽多，
 * 只能靠常量或者手动改源，给个能用的起点就行。
 */
export function nextFreeSlot(
  usedSlots: string[],
  slotIds: string[],
  reserved: string[] = []
): string {
  const used = new Set([...usedSlots, ...reserved].filter(Boolean));
  const free = slotIds.find((id) => !used.has(id));
  if (free) return free;
  return slotIds.find((id) => !reserved.includes(id)) ?? slotIds[0] ?? '';
}

export type SlotLookup = (slotId: string) => boolean;

/**
 * 把种子套成真图层。`idOf` 负责发 id（测试里给个计数器就行）。
 *
 * `hasSlot` 问的是「**当前这个页面有没有这个槽位**」，不是「这个槽位里现在有没有图」。
 * 这两件事差别很大：
 *
 * - 做成"槽里有没有图"的话，用户的正常用法就坏了 —— 常见顺序是**先套预设搭好架子，
 *   再往槽里放图**。那时候槽是空的，整套图层会被降级成常量色，放图进去也不会变回来。
 * - 按"槽位存不存在"判就够了：存的是自己存的预设，可能是从别的页（那页槽位叫 s1/s2）
 *   存下来的，拿到这页套，槽位根本不存在 —— 那种才该降级。
 *
 * 槽位不存在就退成常量色的原因：源指向一个不存在的 id，运算那边会拿到 undefined，
 * 与其让它静默变成一层看不见的空图层，不如出一层纯色让人一眼看见不对。
 */
export function materializeSeeds(
  seeds: LayerSeed[],
  hasSlot: SlotLookup,
  idOf: () => string
): Layer[] {
  return seeds.map((s) => {
    const slotOk = !!s.slot && hasSlot(s.slot);
    const slot = slotOk ? s.slot : '';
    // 蒙版槽位同样按"存不存在"判。槽位在、只是还没放图，蒙版要留着 ——
    // 放图进去之后蒙版就该生效。槽位不存在才关掉。
    const maskSlotOk = !s.mask.on || !s.mask.slot || hasSlot(s.mask.slot);
    return {
      id: idOf(),
      name: s.name,
      on: s.on,
      slot,
      ch: s.ch,
      invert: s.invert,
      constant: s.constant,
      adjust: s.adjust.map((a) => ({ ...a })),
      adjustScope: s.adjustScope,
      blend: s.blend,
      opacity: s.opacity,
      mask: maskSlotOk ? { ...s.mask } : { ...MASK_OFF }
    };
  });
}

/** 把当前图层栈倒成种子，好存成预设 */
export function toSeeds(layers: Layer[]): LayerSeed[] {
  return layers.map((l) => ({
    name: l.name,
    on: l.on,
    slot: l.slot,
    ch: l.ch,
    invert: l.invert,
    constant: l.constant,
    adjust: l.adjust.map((a) => ({ ...a })),
    adjustScope: l.adjustScope,
    blend: l.blend,
    opacity: l.opacity,
    mask: { ...l.mask }
  }));
}

/**
 * localStorage 里读出来的东西不可信，过一遍。
 *
 * 字段缺了要补默认，不然 `buildLayerRgba` 那些地方会拿到 undefined 直接炸；
 * 一层都没有的预设直接丢掉 —— 套上去等于什么都没发生，留着只会让人以为坏了。
 */
export function sanitizePresets(raw: unknown): LayerPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: LayerPreset[] = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const name = typeof p.name === 'string' ? p.name.trim().slice(0, 24) : '';
    if (!name) continue;
    const layers = Array.isArray(p.layers) ? p.layers : [];
    if (!layers.length) continue;
    const seeds: LayerSeed[] = [];
    for (const l of layers) {
      if (!l || typeof l !== 'object') continue;
      const base = seed({ name: typeof l.name === 'string' && l.name ? l.name : '图层' });
      seeds.push({
        ...base,
        on: l.on !== false,
        slot: typeof l.slot === 'string' ? l.slot : '',
        ch: (typeof l.ch === 'string' ? l.ch : 'rgb') as LayerChannel,
        invert: l.invert === true,
        constant: Number.isFinite(l.constant) ? Math.max(0, Math.min(255, l.constant)) : 128,
        adjust: Array.isArray(l.adjust) ? (l.adjust as Layer['adjust']) : [],
        adjustScope: (typeof l.adjustScope === 'string' ? l.adjustScope : 'all') as Layer['adjustScope'],
        blend: (typeof l.blend === 'string' ? l.blend : 'normal') as Layer['blend'],
        opacity: Number.isFinite(l.opacity) ? Math.max(0, Math.min(1, l.opacity)) : 1,
        mask: l.mask && typeof l.mask === 'object' ? { ...MASK_OFF, ...l.mask } : { ...MASK_OFF }
      });
    }
    if (!seeds.length) continue;
    out.push({
      id: typeof p.id === 'string' && p.id ? p.id : `up-${out.length}-${name}`,
      name,
      hint: typeof p.hint === 'string' ? p.hint : '',
      layers: seeds
    });
  }
  return out.slice(0, 40);
}
