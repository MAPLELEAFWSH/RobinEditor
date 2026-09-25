/**
 * ① 翻译这一半的前端契约。
 *
 * 管五件事，每件都配一条能红的断言：
 *   ① **离线（`kind: 'off'`）时一次请求都不发** —— 用可注入的调用器数次数；
 *   ② **默认引擎是 MyMemory**：不用填任何东西就算配好（开箱即用）；
 *   ③ 段落数与回复数对不上时**整批不算**，不许错位；
 *   ④ 译文尾部的换行沿用原文（块注释的结束标记别被顶到上一行去）；
 *   ⑤ 界面不许绕过守卫直接发请求（Glitch.svelte 里只能出现 `翻段落`，不能直接调 `translateText`）。
 *
 * 注意 ① 的口径变过：以前默认是"没配引擎 = 不发"，现在默认是免费的 MyMemory，
 * 所以"零请求"这条改用**离线**来钉 —— 别让它变成一条永远为真的空断言。
 */
import { readFileSync } from 'node:fs';
import {
  翻段落,
  引擎填了,
  引擎标签,
  取引擎,
  补尾部换行,
  并回译文,
  都译了吗,
  默认引擎,
  试句
} from '../src/lib/translate.ts';

let n = 0;
let bad = 0;
const ok = (c, m) => {
  n++;
  if (!c) {
    bad++;
    console.log(`  FAIL ${m}`);
  }
};
const eq = (a, b, m) => ok(a === b, `${m}（期望 ${b}，实得 ${a}）`);

/** 离线引擎：一次请求都不该发 */
const 离线 = { kind: 'off', baseUrl: '', model: '', apiKey: '', timeoutMs: 5000 };

/* ---------- ① 离线：一次请求都不发 ---------- */
{
  let 次数 = 0;
  const 假调用 = async () => {
    次数++;
    return { ok: true, translations: ['x'], error: null };
  };

  const r1 = await 翻段落(离线, ['テクスチャ'], 假调用);
  eq(次数, 0, '离线：调用器一次都没被调');
  eq(r1.sent, false, '离线：sent = false');
  ok(!r1.ok, '离线：结果不是 ok');

  // 旧数据没有 kind → 一律当离线（升级后不许偷偷联网）
  const 旧 = await 翻段落({ baseUrl: '', model: '', apiKey: '', timeoutMs: 5000 }, ['あ'], 假调用);
  eq(次数, 0, '没有 kind 的旧记录：当离线，不发');
  eq(旧.sent, false, '没有 kind：sent = false');

  // 自定义：地址或模型名缺一条就不发（缺了必被服务端拒，不如别发）
  const 只填地址 = await 翻段落({ ...离线, kind: 'custom', baseUrl: 'http://127.0.0.1:11434/v1' }, ['あ'], 假调用);
  eq(次数, 0, '自定义只填了地址：不发');
  eq(只填地址.sent, false, '自定义只填地址：sent = false');

  const 只填模型 = await 翻段落({ ...离线, kind: 'custom', model: 'qwen2.5:7b' }, ['あ'], 假调用);
  eq(次数, 0, '自定义只填了模型名：不发');

  const 空段落 = await 翻段落({ ...离线, kind: 'custom', baseUrl: 'http://x/v1', model: 'm' }, [], 假调用);
  eq(次数, 0, '没有段落：不发');
  eq(空段落.sent, false, '没有段落：sent = false');

  const 空段落离线 = await 翻段落(默认引擎, [], 假调用);
  eq(次数, 0, '默认引擎 + 没有段落：也不发');

  /* 自定义填齐了才发，而且只发一次（多段拼一块，不是一段一次） */
  const 齐 = await 翻段落(
    { kind: 'custom', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b', apiKey: '', timeoutMs: 5000 },
    ['テクスチャ', 'シェーダー'],
    假调用
  );
  eq(次数, 1, '自定义填齐了：发一次');
  eq(齐.sent, true, '自定义填齐了：sent = true');
  ok(齐.ok, '自定义填齐了：ok');
}

/* ---------- ② 默认引擎 = MyMemory（开箱即用） ---------- */
{
  let 次数 = 0;
  const 假调用 = async () => {
    次数++;
    return { ok: true, translations: ['纹理设置'], error: null };
  };

  eq(默认引擎.kind, 'mymemory', '默认引擎就是 MyMemory');
  ok(引擎填了(默认引擎), '默认引擎不用填任何东西就算配好');
  ok(引擎标签(默认引擎).includes('MyMemory'), `默认引擎的标签要说清是哪个（实得 ${引擎标签(默认引擎)}）`);
  ok(引擎标签(默认引擎).includes('额度'), '默认引擎的标签要提一句每日额度');

  const r = await 翻段落(默认引擎, ['テクスチャの設定'], 假调用);
  eq(次数, 1, '默认引擎：会发一次请求（这才是"开箱即用"）');
  eq(r.sent, true, '默认引擎：sent = true');
  eq(r.translations[0], '纹理设置', '默认引擎：译文原样带回来');
}

/* ---------- 引擎判定的边界 ---------- */
{
  ok(!引擎填了(null), 'null 算没填（当离线）');
  ok(!引擎填了(undefined), 'undefined 算没填（当离线）');
  ok(!引擎填了(离线), '离线：没填');
  ok(引擎填了({ kind: 'mymemory', baseUrl: '', model: '', apiKey: '', timeoutMs: 1 }), 'MyMemory 不用填也算填了');
  ok(!引擎填了({ kind: 'custom', baseUrl: '   ', model: 'm' }), '自定义只有空格的地址算没填');
  ok(
    引擎填了({ kind: 'custom', baseUrl: 'http://x', model: 'm' }),
    '自定义有地址有模型就算填了（Key 可以空 —— 本机服务不要 Key）'
  );
  eq(引擎标签(离线), '离线：只做术语替换', '离线的标签要直说是术语替换');
  ok(引擎标签({ kind: 'custom', baseUrl: 'http://x/v1', model: 'm' }).includes('m'), '自定义要显示模型名');
  ok(
    引擎标签({ kind: 'custom', baseUrl: 'http://x/v1', model: 'm' }).includes('http://x/v1'),
    '自定义要显示地址'
  );
  eq(取引擎({ baseUrl: 'http://x', model: 'm' }).kind, 'off', '旧记录（没 kind）当离线，不偷偷联网');
  eq(试句, 'これはテストです。', '「试一下」用的固定短句');
}

/* ---------- 调用器抛异常：错误要透出来，不能吞 ---------- */
{
  const 抛 = async () => {
    throw new Error('连不上 http://127.0.0.1:11434/v1：Connection refused');
  };
  const r = await 翻段落(
    { kind: 'custom', baseUrl: 'http://x/v1', model: 'm', apiKey: '', timeoutMs: 1000 },
    ['あ'],
    抛
  );
  ok(!r.ok, '调用器抛了：结果不是 ok');
  eq(r.sent, true, '调用器抛了：确实发过（sent = true）');
  ok((r.error ?? '').includes('Connection refused'), `原始错误要透出来，实得 ${r.error}`);
}

/* ---------- ② 段数对不上：整批不算 ---------- */
{
  const 原 = [
    { 原: 'a', 日: ' テクスチャ', 译: '' },
    { 原: 'b', 日: ' シェーダー', 译: '' }
  ];
  const 少 = 并回译文(原, [' 贴图']);
  eq(少[0].译, '', '回复少一段：原样返回，一个都不写');
  eq(少[1].译, '', '回复少一段：第二段也没被塞上东西');

  const 对 = 并回译文(原, [' 贴图', ' 着色器']);
  eq(对[0].译, ' 贴图', '数量对上：照序号并回去');
  eq(对[1].译, ' 着色器', '数量对上：第二段也在');

  ok(!都译了吗(原), '都没译：不算齐');
  ok(!都译了吗(对.slice(0, 1).concat([{ 原: 'c', 日: 'x', 译: '' }])), '有一段空着就不算齐');
  ok(都译了吗(对), '两段都译了：算齐');
  ok(!都译了吗([]), '没有段落不算齐（别让"写回"在空文件上亮）');
}

/* ---------- ③ 尾部换行沿用原文 ---------- */
{
  eq(补尾部换行(' ブロック\n', ' 块注释'), ' 块注释\n', '原文带一个换行：译文的补上');
  eq(补尾部换行(' a\n\n', ' 甲'), ' 甲\n\n', '原文带两个换行：补两个');
  eq(补尾部换行(' a', ' 甲'), ' 甲', '原文没有换行：不加');
  eq(补尾部换行(' a\n', ' 甲\n'), ' 甲\n', '译文自己带了：不动（不重复补）');
  eq(补尾部换行(' a\n\n\n', ' 甲\n'), ' 甲\n\n\n', '原文三个、译文一个：补到三个');

  /* 整条链路：并回译文时用的是**日文段**的尾部换行 */
  const 一段 = [{ 原: 'x', 日: ' 複数行\n', 译: '' }];
  eq(并回译文(一段, [' 多行'])[0].译, ' 多行\n', '并回时按日文段补尾部换行');
}

/* ---------- ④ 界面不许绕过守卫 ---------- */
{
  const src = readFileSync('src/lib/modules/glitch/Glitch.svelte', 'utf8');
  ok(src.includes('翻段落'), 'Glitch.svelte 要走 翻段落 这条守卫');
  ok(
    !/await\s+translateText\(/.test(src),
    'Glitch.svelte 不许直接 await translateText —— 那样就绕过了"引擎空着不发请求"'
  );
  ok(
    /if\s*\(!引擎填了\(prefs\.engine\)\)/.test(src),
    '界面在没配引擎时要自己先拦住并说清楚'
  );
  const 设置 = readFileSync('src/lib/components/SettingsPanel.svelte', 'utf8');
  ok(
    设置.includes('请求只在你在 ① 那页打开'),
    '设置面板要写清"请求只在打开那个开关时才发"（默认引擎现在是免费的 MyMemory，措辞得跟着改）'
  );
  ok(设置.includes('每日额度'), '设置面板要如实写清免费公开服务有每日额度');
  ok(设置.includes('不是翻译'), '离线那条路要明写"术语替换不是翻译"');
  ok(设置.includes('translateText'), '设置面板的「试一下」走真请求');
  ok(设置.includes('试一下'), '设置面板要有「试一下」按钮');
}

console.log(`\n通过 ${n} 条，失败 ${bad} 条`);
process.exit(bad ? 1 : 0);
