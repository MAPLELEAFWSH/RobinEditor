/**
 * ① 的翻译这一半：外接引擎的**纯逻辑**，不碰 DOM，跑得了 Node 单测。
 *
 * 三个引擎（界面上一栏选）：
 *   · `mymemory`（**默认**）—— 免费公开接口，**开箱即用、不用填任何东西**（有每日额度）；
 *   · `custom` —— OpenAI 兼容接口（一个 base URL + 模型名 + Key 盖住本机 Ollama / 云端各家）；
 *   · `off` —— 离线，只做术语替换，**一条请求都不发**。
 *
 * 真正发请求的是 Rust 那条 `translate_text` 命令（`src-tauri/src/translate.rs`）。
 * 这里管三件前端才有的事：
 *   · **发不发**：`off` 就一次请求都不发（连"试试看"都不发）；
 *   · **发什么**：只发注释正文那几段（段落由 Rust 用同一份注释扫描切出来）；
 *   · **怎么落**：翻完按段落写回，尾部换行沿用原文的 —— 注释里的排版别被翻译改掉。
 */

/** 用哪个引擎 */
export type 引擎种类 = 'off' | 'mymemory' | 'custom';

export type Engine = {
  kind: 引擎种类;
  /** `custom` 才用得上，例如 http://127.0.0.1:11434/v1 */
  baseUrl: string;
  model: string;
  apiKey: string;
  /** 毫秒 */
  timeoutMs: number;
};

/**
 * 默认引擎：MyMemory。
 *
 * 实测可用、免费、无需 Key（`テクスチャの設定を変更する` → `更改纹理设置`）。
 * 匿名有每日额度，用满了要等或者换引擎 —— 界面上如实写着。
 * 注意：**默认会发请求**这件事只在用户在 ① 页打开"再翻成中文"之后才发生，
 * 那个开关默认是关的。
 */
export const 默认引擎: Engine = { kind: 'mymemory', baseUrl: '', model: '', apiKey: '', timeoutMs: 30000 };

/** 旧数据没有 kind 字段，一律当"离线"看 —— 免得升级之后偷偷替用户联网 */
export function 取引擎(e: Partial<Engine> | null | undefined): Engine {
  const kind: 引擎种类 = e?.kind === 'mymemory' || e?.kind === 'custom' ? e.kind : 'off';
  return {
    kind,
    baseUrl: (e?.baseUrl ?? '').trim(),
    model: (e?.model ?? '').trim(),
    apiKey: (e?.apiKey ?? '').trim(),
    timeoutMs: e?.timeoutMs ?? 30000
  };
}

/**
 * 这个引擎能不能发请求。
 *
 * `mymemory` 不用填任何东西就算配好；`custom` 要地址和模型名两条都填
 * （只有地址没模型名的话请求必被服务端拒，不如在界面上就别让它发）；
 * `off` 永远返回 false。
 */
export function 引擎填了(e: Partial<Engine> | null | undefined): boolean {
  const k = 取引擎(e);
  if (k.kind === 'off') return false;
  if (k.kind === 'mymemory') return true;
  return k.baseUrl.length > 0 && k.model.length > 0;
}

/** 界面上"用的是哪个引擎"那一行要显示的东西 */
export function 引擎标签(e: Partial<Engine> | null | undefined): string {
  const k = 取引擎(e);
  if (k.kind === 'off') return '离线：只做术语替换';
  if (k.kind === 'mymemory') return 'MyMemory（免费公开，有每日额度）';
  if (!引擎填了(e)) return '自定义引擎还没填全';
  return `${k.model} @ ${k.baseUrl}`;
}

/** 一次翻译的调用结果。`sent` 是给测试和界面看的：这一次到底发没发请求 */
export type 翻译结果 = {
  ok: boolean;
  translations: string[];
  error: string | null;
  /** 真发出去了没有。引擎空着时恒为 false */
  sent: boolean;
};

/** 真正发请求的那个实现。抽成参数是为了能注入假的进来测"发没发" */
export type 调用器 = (e: Engine, texts: string[]) => Promise<{ ok: boolean; translations: string[]; error: string | null }>;

/**
 * 翻几段。
 *
 * `off`（离线）**直接返回，不调用** `调用` —— 这条是硬规矩，
 * 用可注入的调用器把它钉在测试里。
 */
export async function 翻段落(
  e: Partial<Engine> | null | undefined,
  段落: string[],
  调用: 调用器
): Promise<翻译结果> {
  if (!引擎填了(e)) {
    return { ok: false, translations: [], error: null, sent: false };
  }
  if (!段落.length) {
    return { ok: false, translations: [], error: null, sent: false };
  }
  const 齐 = 取引擎(e);
  try {
    const r = await 调用(齐, 段落);
    return { ok: r.ok, translations: r.translations, error: r.error, sent: true };
  } catch (err) {
    return { ok: false, translations: [], error: (err as Error).message, sent: true };
  }
}

/**
 * 尾部换行沿用原文。
 *
 * 模型回复里那一段的末尾换行经常被吃掉，而块注释的正文往往就是"…\n"结尾 ——
 * 直接替换会把注释的结束标记顶到上一行去，排版就变了。
 * 只补不删：原文末尾有几个换行、译文末尾没有，就补几个；译文自己带了就不管。
 */
export function 补尾部换行(原: string, 译: string): string {
  const 数 = (s: string) => s.length - s.replace(/\n+$/, '').length;
  const 要 = 数(原);
  if (要 === 0) return 译;
  const 有 = 数(译);
  return 有 >= 要 ? 译 : 译 + '\n'.repeat(要 - 有);
}

/**
 * 段落列表：乱码原文 / 还原后的日文 / 中文译文。
 *
 * 三栏都要，是因为用户拿它对照着改 —— 光看中文看不出模型把哪一段翻歪了。
 * `译` 空着 = 还没翻。
 */
export type 段 = { 原: string; 日: string; 译: string };

/** 把模型的回复并回段落列表：数量对不上就整批不算（不许错位） */
export function 并回译文(段s: 段[], translations: string[]): 段[] {
  if (translations.length !== 段s.length) return 段s;
  return 段s.map((d, i) => ({ ...d, 译: 补尾部换行(d.日, translations[i]) }));
}

/** 有没有哪一段还没译（决定"写回"能不能点） */
export function 都译了吗(段s: 段[]): boolean {
  return 段s.length > 0 && 段s.every((d) => d.译.length > 0);
}

/** 试一下用的固定短句 */
export const 试句 = 'これはテストです。';
