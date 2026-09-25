/**
 * 手敲一遍 vision MCP 的协议，确认能被 dsh-mcp-client 正常挂上。
 *
 * 跑法：node collection/mcp/test-vision-mcp.mjs [图片路径]
 * 不带参数就用一张真实 ramp——顺便看看它会不会编。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const SERVER = path.join(import.meta.dirname, 'vision-mcp.mjs');
const IMG =
  process.argv[2] ??
  String.raw`E:\deepseek-harness\mmd集成工具\实战测试用例\贴图\原神\Vodyanitsa_MMD_260813\MMDStarRail4Fun_v2.2.1\Avatar_Girl_Catalyst_Vodyanitsa_Tex_Body_Shadow_Ramp.png`;

const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'inherit'] });

let buf = '';
const pending = new Map();
child.stdout.setEncoding('utf8');
child.stdout.on('data', (c) => {
  buf += c;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.log('（非 JSON 输出）', line.slice(0, 200));
      continue;
    }
    const r = pending.get(msg.id);
    if (r) {
      pending.delete(msg.id);
      r(msg);
    }
  }
});

let seq = 1;
function req(method, params) {
  const id = seq++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`${method} 超时`));
      }
    }, 300000);
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

const init = await req('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'test', version: '0' }
});
console.log('initialize ->', JSON.stringify(init.result));
notify('notifications/initialized', {});

const list = await req('tools/list', {});
console.log('tools/list ->', list.result.tools.map((t) => t.name).join(', '));

const st = await req('tools/call', { name: 'vision_status', arguments: {} });
console.log('\n--- vision_status ---');
console.log(st.result.content[0].text);

console.log('\n--- describe_image ---');
console.log('图：', path.basename(IMG));
const d = await req('tools/call', {
  name: 'describe_image',
  arguments: {
    path: IMG,
    prompt:
      'This is a 256x20 texture. Answer concretely: (1) is the gradient along width or height? ' +
      '(2) how many of the 20 rows are identical to their neighbour? (3) what is the actual RGB value ' +
      'on the left edge? Do not guess; if unsure say so.'
  }
});
console.log(d.result.content[0].text);

child.kill();
process.exit(0);
