/**
 * 实战测试用的小静态服务器。
 *
 * 为什么需要它：要在**真浏览器里跑真的 `src/lib/pipeline.ts`**（不是我在别处
 * 抄一份逻辑），同时喂给它的又必须是**真实文件**的像素。浏览器读不了本地路径，
 * 那就把那个目录挂到 HTTP 上，前端 fetch 回来解成 ImageData。
 *
 * 只读、只挂一个目录、只跑在 127.0.0.1，测完就关。
 *
 * 跑：node tmp/serve-cases.mjs [根目录] [端口]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] ?? 'E:\\deepseek-harness\\mmd集成工具\\实战测试用例';
const PORT = Number(process.argv[3] ?? 1433);

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.bmp': 'image/bmp',
  '.tga': 'application/octet-stream',
  '.dds': 'application/octet-stream',
  '.webp': 'image/webp'
};

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://x');

    // 让浏览器把算好的结果交回来存盘 —— 浏览器写不了本地文件，
    // 而"判断哪一行该提"这件事只有浏览器里那份真的 pipeline.ts 办得到
    if (req.method === 'POST' && url.pathname === '/save') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const { dir, name, b64 } = JSON.parse(body);
          const target = path.join(process.env.SAVE_ROOT || ROOT, dir, name);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, Buffer.from(b64, 'base64'));
          res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
          res.end(JSON.stringify({ ok: true, path: target }));
        } catch (e) {
          res.writeHead(500, { 'access-control-allow-origin': '*' }).end(String(e.message));
        }
      });
      return;
    }

    // 目录清单：?list=1 时递归列一遍图片
    if (url.searchParams.get('list') === '1') {
      const out = [];
      const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (MIME[path.extname(e.name).toLowerCase()]) {
            out.push(path.relative(ROOT, p).replace(/\\/g, '/'));
          }
        }
      };
      walk(ROOT);
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*'
      });
      res.end(JSON.stringify(out));
      return;
    }

    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const full = path.join(ROOT, rel);
    // 别让人拿 ../ 跑出去
    if (!path.resolve(full).startsWith(path.resolve(ROOT))) {
      res.writeHead(403).end('no');
      return;
    }
    const buf = fs.readFileSync(full);
    res.writeHead(200, {
      'content-type': MIME[path.extname(full).toLowerCase()] ?? 'application/octet-stream',
      'content-length': buf.length,
      'access-control-allow-origin': '*',
      'cache-control': 'no-store'
    });
    res.end(buf);
  } catch (e) {
    res.writeHead(404, { 'access-control-allow-origin': '*' }).end(String(e.message));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`实战用例挂到 http://127.0.0.1:${PORT}/`);
  console.log(`根目录 ${ROOT}`);
});
