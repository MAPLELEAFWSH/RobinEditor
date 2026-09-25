/**
 * 图层预设的存放。
 *
 * 内置那几套写在 `layers-preset.ts` 里（纯数据，跟着程序走）；
 * 用户自己存的放这儿，进 localStorage。
 *
 * 为什么用户预设也要过一遍 `sanitizePresets`：localStorage 是可以被手改的
 * （调试、迁移、别的版本写过），字段缺一个就会在后端运算里炸成 undefined。
 */

import { BUILTIN_PRESETS, type LayerPreset, sanitizePresets, toSeeds } from './layers-preset';
import type { Layer } from './modules/channels/ops';

const KEY = 'robin.layerPresets';

function load(): LayerPreset[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    return sanitizePresets(raw === null ? [] : JSON.parse(raw));
  } catch {
    return [];
  }
}

export const userPresets = $state<LayerPreset[]>(load());

/** 内置 + 自己存的，界面上一个列表 */
export function allPresets(): LayerPreset[] {
  return [...BUILTIN_PRESETS, ...userPresets];
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(userPresets));
  } catch {
    /* 隐私模式写不了就算了 */
  }
}

/** 名字撞了就加序号，不覆盖别人存的 */
function uniqueName(base: string): string {
  const taken = new Set(userPresets.map((p) => p.name));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const n = `${base} ${i}`;
    if (!taken.has(n)) return n;
  }
  return `${base} ${Date.now() % 10000}`;
}

export function savePreset(name: string, layers: Layer[], hint = ''): LayerPreset | null {
  const seeds = toSeeds(layers);
  if (!seeds.length) return null;
  const p: LayerPreset = {
    id: `up-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: uniqueName(name.trim().slice(0, 24) || '未命名'),
    hint,
    layers: seeds
  };
  userPresets.push(p);
  save();
  return p;
}

export function removePreset(id: string): void {
  const i = userPresets.findIndex((p) => p.id === id);
  if (i < 0) return;
  userPresets.splice(i, 1);
  save();
}

export function renamePreset(id: string, name: string): void {
  const p = userPresets.find((x) => x.id === id);
  if (!p) return;
  const n = name.trim().slice(0, 24);
  if (!n) return;
  p.name = n;
  save();
}

/** 内置的不让删，但用户可能想改名字 —— 这里只允许改自己存的 */
export function isUserPreset(id: string): boolean {
  return userPresets.some((p) => p.id === id);
}
