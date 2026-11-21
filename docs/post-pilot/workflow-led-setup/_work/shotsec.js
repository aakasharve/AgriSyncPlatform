const pw=require('E:/APPS/Running App Versions/AgriSyncPlatform/.claude/worktrees/plr-d10-ui-9a-4636d5/src/clients/mobile-web/node_modules/playwright-core');
const w=parseInt(process.argv[2]||'1200'); const ids=process.argv.slice(3);
(async()=>{
  const b=await pw.chromium.launch(); const p=await (await b.newContext({viewport:{width:w,height:900}})).newPage();
  await p.goto('http://127.0.0.1:3086/index.html#nofx=1'); await p.waitForSelector('html[data-ready="1"]'); await p.waitForTimeout(400);
  for(const id of ids){ const loc=p.locator(id.startsWith('.')?id:'#'+id).first(); await loc.screenshot({path:`shots/sec-${w}-${id.replace(/[^a-z0-9]/gi,'')}.png`}); }
  await b.close();
})();
