const pw=require('E:/APPS/Running App Versions/AgriSyncPlatform/.claude/worktrees/plr-d10-ui-9a-4636d5/src/clients/mobile-web/node_modules/playwright-core');
(async()=>{
  const b=await pw.chromium.launch({headless:true});
  const p=await b.newPage({viewport:{width:1200,height:900}});
  const errs=[]; p.on('console',m=>{if(m.type()==='error')errs.push(m.text())}); p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
  await p.goto('http://127.0.0.1:3086/index.html#nofx=1');
  await p.waitForSelector('html[data-ready="1"]',{timeout:8000}).catch(()=>{});
  console.log('flows',JSON.stringify(await p.evaluate(()=>window.__flows)));
  console.log('errs',errs);
  await p.screenshot({path:'full.png',fullPage:true});
  const h=await p.evaluate(()=>document.documentElement.scrollHeight); console.log('height',h);
  await b.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
