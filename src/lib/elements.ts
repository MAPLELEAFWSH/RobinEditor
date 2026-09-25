/**
 * 七个元素色。色相取自原神那套配色，
 * `c` 只用于色板小圆点，页面配色一律走 `--hue` 派生。
 */
export type Element = { id: string; name: string; hue: number; c: string };

export const ELEMENTS: Element[] = [
  { id: 'anemo', name: '风', hue: 175, c: '#74c2a8' },
  { id: 'geo', name: '岩', hue: 75, c: '#fab72e' },
  { id: 'electro', name: '雷', hue: 305, c: '#af8ec1' },
  { id: 'dendro', name: '草', hue: 125, c: '#a5c83b' },
  { id: 'hydro', name: '水', hue: 230, c: '#4cc2f1' },
  { id: 'pyro', name: '火', hue: 40, c: '#ef7938' },
  { id: 'cryo', name: '冰', hue: 200, c: '#9fd6e3' }
];
