(async () => {
  return {
    地址: location.href,
    正文: document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, 900)
  };
})()
