(async () => {
  const 主 = document.querySelector('main') ?? document.body;
  const 头 = [...document.querySelectorAll('h1, h2, .wb, .card')].slice(0, 6);
  return {
    地址: location.href,
    主容器标签: 主.tagName + '.' + (主.className || ''),
    主容器前700字: (主.innerHTML || '').replace(/\s+/g, ' ').slice(0, 700),
    头几个块: 头.map((e) => `${e.tagName.toLowerCase()}.${(e.className || '').toString().split(' ').join('.')}`)
  };
})()
