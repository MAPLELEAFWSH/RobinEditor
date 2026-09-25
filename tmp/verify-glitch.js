(async () => {
  const { invoke } = window.__TAURI_INTERNALS__;
  const DIR = String.raw`E:\deepseek-harness\RobinEditor\tmp\glitch-test`;
  const join = (n) => DIR + '\\' + n;
  const out = {};

  // ---- 1. 只改注释模式：dry run 先看会改成什么
  for (const name of ['broken.fx', 'clean.fx', 'japanese.fx', 'all-broken.fx']) {
    try {
      const r = await invoke('fix_text_file', {
        path: join(name), write: false, mode: 'fx-comments', encoding: null
      });
      out[name] = {
        encoding: r.encoding,
        changed: r.changed,
        via: r.via,
        lines: r.lines,
        before: r.before_sample,
        after: r.after_sample
      };
    } catch (e) {
      out[name] = 'ERR ' + e;
    }
  }

  // ---- 2. 真写一次，验备份 + 代码段没被动 + CRLF 保留
  try {
    const r = await invoke('fix_text_file', {
      path: join('broken.fx'), write: true, mode: 'fx-comments', encoding: null
    });
    out.writeBroken = { written: r.written, backup: r.backup, changed: r.changed };

    const after = await invoke('read_text_file', { path: join('broken.fx') });
    const text = after.text;
    out.afterText = text;
    out.checks = {
      // 代码行必须一字不差
      keepsDefine: text.includes('#define TEXTURE_SWIZZLE 3'),
      keepsMain: text.includes('float4 main(float2 uv : TEXCOORD0) : COLOR0 {'),
      keepsSampler: text.includes('float4 c = tex2D(TextureSampler, uv);'),
      keepsReturn: text.includes('return c;'),
      keepsBrace: text.trim().endsWith('}'),
      // 注释应该是日文了
      jaComment1: text.includes('テクスチャの設定'),
      jaComment2: text.includes('コントローラーから受け取る'),
      jaComment3: text.includes('シェーダーの本体'),
      blockComment: text.includes('メタリック成分を足す'),
      trailing: text.includes('ここで返す'),
      // 不该再有乱码
      noMojibake: !/僥|僐|僔|儊|偙|偺|偐|庴|掕|懱|惉|暘|曉/.test(text)
    };
  } catch (e) {
    out.writeBroken = 'ERR ' + e;
  }

  // ---- 3. clean.fx 写一遍必须 0 变化
  try {
    const r = await invoke('fix_text_file', {
      path: join('clean.fx'), write: true, mode: 'fx-comments', encoding: null
    });
    out.cleanUntouched = { changed: r.changed, written: r.written, backup: r.backup };
  } catch (e) {
    out.cleanUntouched = 'ERR ' + e;
  }

  // ---- 4. CRLF 保留
  try {
    const before = await invoke('read_text_file', { path: join('crlf.fx') });
    const r = await invoke('fix_text_file', {
      path: join('crlf.fx'), write: true, mode: 'fx-comments', encoding: null
    });
    const after = await invoke('read_text_file', { path: join('crlf.fx') });
    out.crlf = {
      changed: r.changed,
      beforeHasCRLF: before.text.includes('\r\n'),
      afterHasCRLF: after.text.includes('\r\n'),
      crlfCount: (after.text.match(/\r\n/g) || []).length,
      loneLF: (after.text.match(/(?<!\r)\n/g) || []).length
    };
  } catch (e) {
    out.crlf = 'ERR ' + e;
  }

  // ---- 5. 整文件模式：all-broken.fx 应该整段修好
  try {
    const r = await invoke('fix_text_file', {
      path: join('all-broken.fx'), write: true, mode: 'whole', encoding: null
    });
    const after = await invoke('read_text_file', { path: join('all-broken.fx') });
    out.whole = {
      changed: r.changed,
      via: r.via,
      text: after.text,
      hasJapanese: after.text.includes('テクスチャの設定') && after.text.includes('コントローラー')
    };
  } catch (e) {
    out.whole = 'ERR ' + e;
  }

  // ---- 6. 目录扫描：应该把 broken/all-broken/crlf 挑出来，clean/japanese 不挑
  try {
    const hits = await invoke('scan_text_files', { root: DIR, exts: ['fx'], limit: 50 });
    out.scan = hits.map((h) => ({ rel: h.rel, likely: h.likely, via: h.via }));
  } catch (e) {
    out.scan = 'ERR ' + e;
  }

  return out;
})()
