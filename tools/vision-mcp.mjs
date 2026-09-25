#!/usr/bin/env node
/**
 * 视觉 MCP server。
 *
 * 为什么自己写：DSH 的插件清单里没有任何视觉插件（全是 dsh-* 核心插件），
 * 而 skills.sh 上找得到的几个 vision skill 装量都很低、也不解决「我这里能看图」这件事。
 * 这台机器上已经有 ollama + qwen3-vl:4b，缺的只是一个让 agent 调得到的口子。
 *
 * 三条后端都支持，用名字对上你要的那三个：
 *
 *   ollama + qwen3-vl     本地，默认。文字和中文识别都不错，但**细节会编** ——
 *                         实测让它描述一张 256×20 的 ramp，它说「20 行完全相同、
 *                         颜色是浅蓝到淡紫」，而实际是 10 对不同的行、值 (209,215,215) 近灰。
 *                         定性看可以用，拿它当事实不行。
 *   ollama + minicpm-v    本地，拉一下就有：ollama pull minicpm-v
 *   openai（gpt-4o 一类） 走 API，要 OPENAI_API_KEY。比 4B 的小模型准，尤其是尺寸和计数。
 *
 * 环境变量：
 *   VISION_BACKEND   ollama | openai      默认 ollama
 *   VISION_MODEL     模型名               默认 qwen3-vl:4b / gpt-4o-mini
 *   OLLAMA_HOST                           默认 http://127.0.0.1:11434
 *   OPENAI_API_KEY / OPENAI_BASE_URL      openai 后端用
 *
 * 传输是 stdio，按行分隔的 JSON-RPC 2.0。
 */
import fs from 'node:fs';
import path from 'node:path';

const BACKEND = process.env.VISION_BACKEND ?? 'ollama';
const OLLAMA = (process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
const OPENAI_BASE = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
const MODEL =
  process.env.VISION_MODEL ?? (BACKEND === 'openai' ? 'gpt-4o-mini' : 'qwen3-vl:4b');

const PROTOCOL = '2024-11-05';

/* ------------------------------------------------------------------ 图像 */

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
};

function readImage(p) {
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) throw new Error(`文件不存在：${abs}`);
  const st = fs.statSync(abs);
  // 多数视觉 API 的上限在 20MB 左右，这里先卡住，免得白传一趟
  if (st.size > 20 * 1024 * 1024) {
    throw new Error(`文件 ${(st.size / 1048576).toFixed(1)}MB，超过 20MB 上限`);
  }
  const ext = path.extname(abs).toLowerCase();
  const mime = MIME[ext];
  if (!mime) {
    throw new Error(
      `${ext || '(无扩展名)'} 不在支持范围（${Object.keys(MIME).join(' ')}）。` +
        'TGA/DDS 这类先转成 PNG 再进来。'
    );
  }
  return { abs, mime, b64: fs.readFileSync(abs).toString('base64'), size: st.size };
}

/* ------------------------------------------------------------------ 后端 */

async function askOllama(img, prompt) {
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      images: [img.b64],
      stream: false,
      // qwen3 系列默认带思考，会把正文挤到 thinking 字段里，这里关掉
      think: false
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ollama 返回 ${res.status}：${body.slice(0, 300)}`);
  }
  const j = await res.json();
  const text = (j.response ?? '').trim();
  if (text) return { text, note: '' };
  // 正文空、思考有：说明它把预算全花在思考上了（问得越细越容易这样）。
  // 这种思考过程经常是在绕圈子，所以截断，免得把上下文刷满。
  const th = (j.thinking ?? '').trim();
  const stripped = th.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const body = stripped || th;
  if (!body) return { text: '', note: '（模型完全没返回内容）' };
  const cap = 1200;
  return {
    text: body.length > cap ? body.slice(0, cap) + `\n……（截断，原文 ${body.length} 字）` : body,
    note: '（正文为空，这是思考字段的内容，多半在绕圈子 —— 别当答案用）'
  };
}

async function askOpenai(img, prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('openai 后端需要 OPENAI_API_KEY');
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.b64}` } }
          ]
        }
      ]
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`openai 返回 ${res.status}：${body.slice(0, 300)}`);
  }
  const j = await res.json();
  return { text: j.choices?.[0]?.message?.content ?? '' };
}

async function ask(img, prompt) {
  if (BACKEND === 'openai') return askOpenai(img, prompt);
  return askOllama(img, prompt);
}

async function listModels() {
  const res = await fetch(`${OLLAMA}/api/tags`);
  if (!res.ok) throw new Error(`ollama 返回 ${res.status}`);
  const j = await res.json();
  const names = (j.models ?? []).map((m) => m.name);
  const visionish = names.filter((n) => /vl|vision|llava|minicpm|gemma3|moondream|bakllava/i.test(n));
  return { names, visionish };
}

/* ------------------------------------------------------------------ 工具定义 */

const TOOLS = [
  {
    name: 'describe_image',
    description:
      '看一张图并回答关于它的问题。用于读参考图、看渲染结果、快速确认一张贴图大概长什么样。\n' +
      '可靠性的实话：本机默认后端是 ollama 的 qwen3-vl:4b，这个尺寸的模型对**精确尺寸、行数、像素值**' +
      '经常是照着文件名和尺寸在推、不是真在看，而且会自信地给错答案。' +
      '凡是要拿来当事实的结论（尺寸、计数、逐行结构、具体 RGB）必须再用像素测量复核。' +
      '问得越短越具体它答得越好；一次问三个以上细节容易只剩思考过程、没有正文。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '图片的绝对路径（png/jpg/webp/gif/bmp）' },
        prompt: {
          type: 'string',
          description: '想问什么。越具体越好，例如「这个 256x20 的渐变是横向还是纵向的」'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'compare_images',
    description: '把两张图一起给模型看，让它们对比。适合「生成结果跟参考图差在哪」这类问题。',
    inputSchema: {
      type: 'object',
      properties: {
        path_a: { type: 'string', description: '第一张图（一般是参考 / 期望）' },
        path_b: { type: 'string', description: '第二张图（一般是生成结果）' },
        prompt: { type: 'string', description: '想对比什么' }
      },
      required: ['path_a', 'path_b']
    }
  },
  {
    name: 'vision_status',
    description: '报告当前用的是哪个后端和模型，以及本机有哪些视觉模型可用。',
    inputSchema: { type: 'object', properties: {} }
  }
];

/* ------------------------------------------------------------------ 调用 */

async function call(name, args) {
  if (name === 'vision_status') {
    const out = [`后端 ${BACKEND}，模型 ${MODEL}`];
    if (BACKEND === 'ollama') {
      out.push(`端点 ${OLLAMA}`);
      try {
        const { names, visionish } = await listModels();
        out.push(`本机模型 ${names.length} 个：${names.join(', ') || '（无）'}`);
        out.push(
          visionish.length
            ? `能看图的：${visionish.join(', ')}`
            : '没找到能看图的模型，先 ollama pull qwen3-vl:4b'
        );
      } catch (e) {
        out.push(`列模型失败：${e.message}（ollama 起了吗）`);
      }
    } else {
      out.push(`端点 ${OPENAI_BASE}`);
      out.push(process.env.OPENAI_API_KEY ? 'OPENAI_API_KEY 已设置' : '缺 OPENAI_API_KEY');
    }
    return out.join('\n');
  }

  const prompt =
    args?.prompt ??
    '详细描述这张图：尺寸观感、形状、颜色、有没有明显的结构规律。';

  if (name === 'describe_image') {
    const img = readImage(args.path);
    const r = await ask(img, prompt);
    return (
      `【${path.basename(img.abs)}  ${(img.size / 1024).toFixed(0)}KB  后端 ${BACKEND}/${MODEL}】\n` +
      (r.text || '（模型没有返回内容）') +
      (r.note ? `\n${r.note}` : '')
    );
  }

  if (name === 'compare_images') {
    const a = readImage(args.path_a);
    const b = readImage(args.path_b);
    // 两张图按顺序放进同一次请求：ollama 的 images 数组、openai 的多段 image_url 都是这个顺序
    const wrapped =
      `下面给你两张图。第一张是 A（${path.basename(a.abs)}），第二张是 B（${path.basename(b.abs)}）。\n${prompt}`;
    const res = await rawAskTwo(a, b, wrapped);
    return (
      `【A ${path.basename(a.abs)}  vs  B ${path.basename(b.abs)}  后端 ${BACKEND}/${MODEL}】\n` +
      (res || '（模型没有返回内容）')
    );
  }

  throw new Error(`没有这个工具：${name}`);
}

async function rawAskTwo(a, b, prompt) {
  if (BACKEND === 'openai') {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('openai 后端需要 OPENAI_API_KEY');
    const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${a.mime};base64,${a.b64}` } },
              { type: 'image_url', image_url: { url: `data:${b.mime};base64,${b.b64}` } }
            ]
          }
        ]
      })
    });
    if (!res.ok) throw new Error(`openai 返回 ${res.status}`);
    const j = await res.json();
    return j.choices?.[0]?.message?.content ?? '';
  }
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      images: [a.b64, b.b64],
      stream: false,
      think: false
    })
  });
  if (!res.ok) throw new Error(`ollama 返回 ${res.status}`);
  const j = await res.json();
  return j.response ?? '';
}

/* ------------------------------------------------------------------ stdio JSON-RPC */

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;
  // 通知没有 id，不回
  if (id === undefined || id === null) return;

  try {
    if (method === 'initialize') {
      reply(id, {
        // 回显客户端要的版本。写死自己的版本在有版本协商的客户端上可能直接被拒。
        protocolVersion: params?.protocolVersion ?? PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: 'vision', version: '1.0.0' }
      });
      return;
    }
    if (method === 'tools/list') {
      reply(id, { tools: TOOLS });
      return;
    }
    if (method === 'tools/call') {
      const name = params?.name;
      const args = params?.arguments ?? {};
      try {
        const text = await call(name, args);
        reply(id, { content: [{ type: 'text', text }] });
      } catch (e) {
        // 工具本身的失败走 isError，别当成协议错误 —— 这样模型能读到原因并改
        reply(id, { content: [{ type: 'text', text: `失败：${e.message}` }], isError: true });
      }
      return;
    }
    if (method === 'ping') {
      reply(id, {});
      return;
    }
    fail(id, -32601, `不支持的方法：${method}`);
  } catch (e) {
    fail(id, -32603, e.message);
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    void handle(msg);
  }
});
process.stdin.on('end', () => process.exit(0));
