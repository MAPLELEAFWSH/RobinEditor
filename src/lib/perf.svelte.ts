/**
 * 逐帧调度和性能统计。
 *
 * 两条规矩：
 *  1. 全站只开一条 rAF。各自开循环空转的话页面永远进不了空闲，风扇一直转。
 *     所以东西都 add 到这一个调度器上，没人订阅就自动停。
 *  2. 光看 fps 没用。60fps 但每帧 JS 跑 15ms，再加点东西就掉。
 *     所以同时记帧内 JS 耗时（预算 16.7ms）和长任务次数。
 *
 * 页面不可见时整体停机。尾栏的帧率显示可以关，关掉这条链路就完全静默。
 */

type Sub = (now: number) => void;

const hasDOM = typeof window !== 'undefined';

export const FRAME_BUDGET_MS = 16.7;

const subs = new Set<Sub>();
let running = false;
let paused = hasDOM ? document.hidden : false;

let frames = 0;
let jsTotal = 0;
let jsMax = 0;
let longTasks = 0;

export const perf = $state({
  fps: 0,
  /** 实际帧间隔，比 fps 直观 */
  frameMs: 0,
  /** 我们自己订阅者在一帧里的耗时。没订阅者时这个数没意义，显示成 — */
  jsAvg: 0,
  jsMax: 0,
  frames: 0,
  longTasks: 0,
  heapMB: 0,
  nodes: 0,
  subs: 0,
  live: true
});

function loop(now: number) {
  if (paused || subs.size === 0) {
    running = false;
    return;
  }
  frames++;
  const list = Array.from(subs);
  const t0 = performance.now();
  for (let i = 0; i < list.length; i++) {
    try {
      list[i](now);
    } catch (e) {
      console.warn('[raf]', e);
    }
  }
  const cost = performance.now() - t0;
  jsTotal += cost;
  if (cost > jsMax) jsMax = cost;
  requestAnimationFrame(loop);
}

function start() {
  if (running || paused || subs.size === 0) return;
  running = true;
  requestAnimationFrame(loop);
}

export function everyFrame(fn: Sub): () => void {
  subs.add(fn);
  perf.subs = subs.size;
  start();
  return () => {
    subs.delete(fn);
    perf.subs = subs.size;
  };
}

/** 进了视口才挂，离开就摘 */
export function whenVisible(node: Element, on: () => () => void, margin = '25% 0px') {
  let off: (() => void) | null = null;
  const io = new IntersectionObserver(
    (es) => {
      if (es[0].isIntersecting) {
        if (!off) off = on();
      } else if (off) {
        off();
        off = null;
      }
    },
    { rootMargin: margin }
  );
  io.observe(node);
  return () => {
    io.disconnect();
    if (off) off();
  };
}

/**
 * 30fps 时间门限。用门限不用隔帧丢弃 —— 120Hz 屏上隔帧会变成 60，
 * 门限才是稳定 30。提前 return 时不要更新 last，跳掉的时间要算进下一帧。
 */
export function gate30(now: number, last: number) {
  return now - last < 30;
}

/* 每秒采一次，读完清零 */
let meterRunning = false;
let sampleFrames = 0;
let sampleFirst = 0;
/**
 * 节点数是**全文档遍历** `getElementsByTagName('*')`，页面越大越贵。
 * 每秒来一遍等于给低配机器按了个看不见的税 —— 而这个数只在"页面越用越胖"
 * 的时候才有意义，5 秒一次足够看出趋势。
 */
let nodesEvery = 0;

function meter(now: number) {
  if (!perf.live || paused) {
    meterRunning = false;
    return;
  }
  if (!sampleFirst) sampleFirst = now;
  sampleFrames++;
  const span = now - sampleFirst;
  if (span >= 1000) {
    perf.fps = Math.round((sampleFrames * 1000) / span);
    perf.frameMs = +(span / sampleFrames).toFixed(2);
    sampleFrames = 0;
    sampleFirst = now;

    perf.jsAvg = frames ? +(jsTotal / frames).toFixed(2) : 0;
    perf.jsMax = +jsMax.toFixed(2);
    perf.frames = frames;
    perf.longTasks = longTasks;
    // @ts-expect-error 只有 Chromium 有
    const m = performance.memory?.usedJSHeapSize;
    perf.heapMB = m ? +(m / 1048576).toFixed(1) : 0;
    if (++nodesEvery % 5 === 0) perf.nodes = document.getElementsByTagName('*').length;

    frames = 0;
    jsTotal = 0;
    jsMax = 0;
  }
  requestAnimationFrame(meter);
}

export function startMeter() {
  if (!hasDOM || meterRunning) return;
  meterRunning = true;
  sampleFirst = 0;
  sampleFrames = 0;
  requestAnimationFrame(meter);
}

if (hasDOM) {
  document.addEventListener('visibilitychange', () => {
    paused = document.hidden;
    if (!paused) {
      start();
      if (perf.live && !meterRunning) startMeter();
    }
  });

  try {
    new PerformanceObserver((list) => {
      longTasks += list.getEntries().length;
    }).observe({ entryTypes: ['longtask'] });
  } catch {
    /* Safari 没有 longtask */
  }
}

export function resetPerf() {
  frames = 0;
  jsTotal = 0;
  jsMax = 0;
  longTasks = 0;
  sampleFrames = 0;
  sampleFirst = 0;
  perf.fps = 0;
  perf.frameMs = 0;
  perf.jsAvg = 0;
  perf.jsMax = 0;
  perf.frames = 0;
  perf.longTasks = 0;
}
