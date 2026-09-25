(async () => {
  const { invoke } = window.__TAURI_INTERNALS__;
  const DIR = String.raw`E:\deepseek-harness\RobinEditor\tmp\glitch-test`;
  const hits = await invoke('scan_text_files', { root: DIR, exts: ['fx'], limit: 50 });
  return {
    count: hits.length,
    rows: hits.map((h) => ({
      rel: h.rel,
      likely: h.likely,
      via: h.via,
      before: h.sample_before,
      after: h.sample_after
    }))
  };
})()
