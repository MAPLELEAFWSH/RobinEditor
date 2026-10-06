<script lang="ts">
  import { onMount } from 'svelte';
  import { setChrome } from '$lib/ui.svelte';
  import Icon from '$lib/components/Icon.svelte';

  onMount(() => setChrome('设置', '路径 · 外观 · 备份'));

  /** 每个渲染包都靠一个特征文件辨认，指错目录会被拦住。
      **msToon 那一行已删**（2026-09-26：④ 整个模块删了，留个模板目录没人用）。 */
  const packs = [
    { k: 'Ray 渲染包', need: 'ray.conf', desc: 'ray-mmd 的根目录' },
    { k: '养乐多渲染包', need: 'mat_body.fx', desc: 'mat_body / face / hair 所在目录' },
    { k: 'ikClut', need: 'ikClut.fx', desc: 'ikClut 控制器与 LUT 目录' }
  ];

  const rows = [
    { k: '贴图导出目录', v: '跟源文件放一起', hint: '也可以固定输出到某个目录' },
    { k: '覆盖前备份', v: '开', hint: '备份放在工程目录下的 .robin\\backup' },
    { k: '跳过已有 lightmap', v: '开', hint: '避免把做好的图冲掉' },
    { k: '扫描最大深度', v: '6 层', hint: '再深的目录不看' }
  ];
</script>

<section class="card pad">
  <h2>渲染包路径</h2>
  <p class="mut">
    工具本身不带也不发这些渲染包。填上路径后，载入时只认下面那个特征文件，认不到就不让存。
  </p>
  <ul class="list">
    {#each packs as p (p.k)}
      <li>
        <div class="list__txt">
          <b>{p.k}</b>
          <span>{p.desc} · 认 <code>{p.need}</code></span>
        </div>
        <div class="list__act">
          <span class="mut">未载入</span>
          <button class="btn btn--ghost" type="button" disabled>
            <Icon name="ui.folder" size={15} />选择目录
          </button>
        </div>
      </li>
    {/each}
  </ul>
  <p class="mut">选择目录的功能等 Tauri 的 dialog 接进来才能用，现在先占位。</p>
</section>

<section class="card pad mt">
  <h2>运行设置</h2>
  <ul class="list">
    {#each rows as r (r.k)}
      <li>
        <div class="list__txt">
          <b>{r.k}</b>
          <span>{r.hint}</span>
        </div>
        <div class="list__act"><span class="val">{r.v}</span></div>
      </li>
    {/each}
  </ul>
</section>

<section class="card pad mt">
  <h2>外观</h2>
  <p class="mut">主题色相和深浅色都在顶栏改，存在本地。第一次打开跟随系统，之后按你选的来。</p>
  <div class="appearance">
    <span class="tag">色相滑杆</span>
    <span class="tag">深浅切换</span>
  </div>
</section>

<style>
  .pad { padding: 22px; }
  .mt { margin-top: 16px; }
  h2 { font-size: 16px; margin-bottom: 8px; }
  .mut { font-size: 12.5px; line-height: 1.75; color: var(--content-meta); margin: 0 0 14px; }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .list li {
    display: flex; align-items: center; gap: 14px;
    padding: 12px 14px;
    border: 1px solid var(--line-divider);
    border-radius: var(--r-lg);
  }
  .list__txt { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .list__txt b { font-size: 13.5px; color: var(--deep-text); }
  .list__txt span { font-size: 11.5px; color: var(--content-meta); }
  .list__txt code {
    background: var(--btn-regular-bg); padding: 1px 5px; border-radius: 4px;
    font-family: var(--font-mono); font-size: 11px;
  }
  .list__act { margin-left: auto; display: flex; align-items: center; gap: 10px; flex: none; }
  .val { font-size: 13px; font-weight: 600; color: var(--btn-content); }
  .appearance { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
