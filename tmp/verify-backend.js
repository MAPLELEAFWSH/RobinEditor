(async () => {
  const out = { where: 'tauri-webview' };
  out.isTauri = '__TAURI_INTERNALS__' in window;
  out.location = location.href;

  if (!out.isTauri) return out;

  const { invoke } = window.__TAURI_INTERNALS__;

  const SAMPLE = 'E:\\deepseek-harness\\mmd集成工具\\贴图样本';

  // 1. 目录扫描
  try {
    const files = await invoke('scan_dir', {
      root: SAMPLE + '\\genshin',
      exts: ['png'],
      recursive: true
    });
    out.scanDir = { count: files.length, first: files[0] };
  } catch (e) {
    out.scanDir = 'ERR ' + e;
  }

  // 2. 读一张真 PNG
  try {
    const img = await invoke('read_image', {
      path: SAMPLE + '\\genshin\\Avatar_Girl_Marionette_Tex_Body_Diffuse.png'
    });
    out.readImage = {
      w: img.width,
      h: img.height,
      format: img.src_format,
      bytes: img.src_bytes,
      pngB64Head: img.png.slice(0, 12)
    };
  } catch (e) {
    out.readImage = 'ERR ' + e;
  }

  // 3. 乱码修复：直接拿目录里真实的乱码文件名试
  try {
    const r = await invoke('repair_text', { text: 'PAToon僐儞僩儘乕儔乕' });
    out.repair = { before: r.original, after: r.fixed, via: r.via, changed: r.changed };
  } catch (e) {
    out.repair = 'ERR ' + e;
  }

  // 4. PMX 解析（真模型）
  try {
    const info = await invoke('read_pmx', {
      path: 'E:\\deepseek-harness\\mmd集成工具\\贴图样本\\genshin\\木偶\\木偶.pmx',
      materialLimit: null
    });
    out.pmx = {
      name: info.name,
      version: info.version,
      encoding: info.encoding,
      vertex: info.vertex_count,
      faces: info.face_count,
      materials: info.material_count,
      textures: info.texture_count,
      bones: info.bone_count,
      kinds: [...new Set(info.materials.map((m) => m.kind))],
      firstMat: info.materials[0] && {
        name: info.materials[0].name,
        kind: info.materials[0].kind,
        texture: info.materials[0].texture
      }
    };
  } catch (e) {
    out.pmx = 'ERR ' + e;
  }

  // 5. 写盘 + 备份：写一张 4x4，再写一次看有没有 .bak
  try {
    const w = 4, h = 4;
    const raw = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      raw[i * 4] = i * 16;
      raw[i * 4 + 1] = 255 - i * 16;
      raw[i * 4 + 2] = 128;
      raw[i * 4 + 3] = 255;
    }
    let b64 = '';
    for (const byte of raw) b64 += String.fromCharCode(byte);
    b64 = btoa(b64);

    const target = 'E:\\deepseek-harness\\RobinEditor\\tmp\\cdp-write-test.png';
    const r1 = await invoke('write_rgba_image', {
      path: target, width: w, height: h, rgbaB64: b64, backup: true
    });
    const r2 = await invoke('write_rgba_image', {
      path: target, width: w, height: h, rgbaB64: b64, backup: true
    });
    const exists = await invoke('file_exists', { path: target });
    const bakExists = await invoke('file_exists', { path: target.replace('.png', '.png.bak') });
    out.write = {
      first: r1, secondBackup: r2.backup, exists, bakExists
    };
    // 读回来验像素
    const back = await invoke('read_image', { path: target });
    out.write.readBack = { w: back.width, h: back.height };
  } catch (e) {
    out.write = 'ERR ' + e;
  }

  // 6. Ray 包探测
  try {
    const root = 'E:\\deepseek-harness\\mmd集成工具\\参考工具样本\\Ray_by_克里斯提亚娜_8b2b28acd56116462655071ad3d071ec';
    const probe = await invoke('probe_dir', { path: root });
    const conf = await invoke('find_file', { root, target: 'ray.conf', depth: 4 });
    out.ray = { exists: probe.exists, entries: probe.entries, rayConf: conf };
  } catch (e) {
    out.ray = 'ERR ' + e;
  }

  return out;
})()
