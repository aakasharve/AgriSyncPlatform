const pw=require('E:/APPS/Running App Versions/AgriSyncPlatform/.claude/worktrees/plr-d10-ui-9a-4636d5/src/clients/mobile-web/node_modules/playwright-core');
(async()=>{
  const b=await pw.chromium.launch(); const p=await (await b.newContext({viewport:{width:390,height:720}})).newPage();
  const list=[['invite',1],['invite',3],['plots',2],['water',9],['signin',10],['signin',14],['water',11],['plots',9]];
  let i=0; for(const [f,s] of list){ await p.goto(`http://127.0.0.1:3086/index.html#f=${f}&s=${s}&nofx=1&solo=1`); await p.reload(); await p.waitForSelector('#phone'); await p.locator('#phone').screenshot({path:`shots/h-${i++}.png`}); }
  await b.close();
})();
