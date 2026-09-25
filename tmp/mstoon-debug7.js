(async () => {
  const fn = document.querySelector('.fn');
  const 子 = fn ? [...fn.children].map((c) => `${c.tagName.toLowerCase()}.${(c.className || '').toString().split(' ').join('.')}`) : [];
  const 末 = fn?.lastElementChild;
  return {
    地址: location.href,
    fn的子: 子,
    末个块的类: 末 ? `${末.tagName.toLowerCase()}.${(末.className || '').toString()}` : null,
    末个块前500字: (末?.innerHTML || '').replace(/\s+/g, ' ').slice(0, 500),
    末个块文字: (末?.innerText || '').replace(/\n+/g, ' | ').slice(0, 300)
  };
})()
