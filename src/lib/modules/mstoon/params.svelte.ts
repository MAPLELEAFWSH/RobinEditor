/**
 * ④ 那四个手画分区的参数，**按游戏各存一套**。
 *
 * 用户要的："lightmap 之外的分区也应该分游戏生成效果"。但这三个分区
 * （ShadowRate / SubLightRate / EdgeRate）在三个模型库和参考样本里**都没有每游戏的实测样本**
 * （扫过：只有原神有 7 张 `Avatar_*_FaceSDF.png`），所以这里**不编"实测默认值"** ——
 * 存的是**用户自己调的那一套**，切游戏就是切他的两套设置。默认值三套相同，
 * 谁调过就在界面上标出来。
 *
 * 存法：localStorage 一个键，JSON。跟 `recent.svelte.ts` 一样自己管自己的 key，
 * 不塞进全局 `prefs`（那是外观设置，混在一起会让"重置外观"顺手清掉手上的参数）。
 */
import type { ChSpec, EdgeOpts, SdfOpts } from './ops';

export type GameKey = 'gi' | 'hsr' | 'zzz';

export const GAME_LABEL: Record<GameKey, string> = {
  gi: '原神',
  hsr: '星铁',
  zzz: '绝区零'
};

/**
 * 游戏键 → SDF 排法键。两边叫法不一样（这边 `gi`、`$lib/sdf` 那边 `genshin`），
 * 映射只写这一处，别在面板里散着写。
 */
export const SDF_GAME: Record<GameKey, 'genshin' | 'hsr' | 'zzz'> = {
  gi: 'genshin',
  hsr: 'hsr',
  zzz: 'zzz'
};

/** 一个游戏那一套参数。四个分区各一组 */
export type GameParams = {
  sr: Record<string, ChSpec>;
  sl: Record<string, ChSpec>;
  edge: EdgeOpts;
  sdf: SdfOpts & { game: GameKey };
  /** 用户改过没有 —— 界面上标"你存的"还是"默认" */
  touched: boolean;
};

const KEY = 'robin.mstoon.params.v1';

export function loadParams(): Partial<Record<GameKey, GameParams>> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : {};
  } catch {
    /* 存坏了就当没存过 —— 参数丢了比整页打不开好 */
    return {};
  }
}

export function saveParams(all: Partial<Record<GameKey, GameParams>>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* 写不进去（隐私模式、配额）不该影响正在做的事 */
  }
}

export function clearParams(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 同上 */
  }
}
