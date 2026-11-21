const pw=require('E:/APPS/Running App Versions/AgriSyncPlatform/.claude/worktrees/plr-d10-ui-9a-4636d5/src/clients/mobile-web/node_modules/playwright-core');
(async()=>{
  const b=await pw.chromium.launch(); const p=await (await b.newContext({viewport:{width:390,height:900}})).newPage();
  await p.goto('http://127.0.0.1:3086/index.html#nofx=1'); await p.waitForSelector('html[data-ready="1"]');
  console.log(await p.evaluate(()=>{const r=[];document.querySelectorAll('img').forEach(e=>{const b=e.getBoundingClientRect(); if(b.width>0&&b.right>391) r.push(e.src.slice(-30)+' '+e.parentElement.className+' '+e.closest('.ph,.strip,.frames')?.className+' '+Math.round(b.left)+'-'+Math.round(b.right)+' w'+Math.round(b.width))});return r.join('\n')}));
  console.log('buzz:',await p.locator('#buzz-where').innerText(), '|', await p.evaluate(()=>navigator.maxTouchPoints+' '+typeof navigator.vibrate));
  await b.close();
})();
