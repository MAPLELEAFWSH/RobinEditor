(async () => {
  const 主 = document.querySelector('.wb__main');
  const 片 = document.querySelector('.wb__side');
  return {
    地址: location.href,
    有主列: !!主,
    主列子元素: 主 ? [...主.children].map((c) => `${c.tagName.toLowerCase()}.${(c.className || '').toString().split(' ').join('.')}`).slice(0, 8) : [],
    主列文字: (主?.innerText || '').trim().slice(0, 300).replace(/\n/g, ' | '),
    侧栏文字: (片?.innerText || '').trim().slice(0, 200).replace(/\n/g, ' | '),
    正文里有没有游戏两个字: /游戏/.test(document.body.innerText)
  };
})()
