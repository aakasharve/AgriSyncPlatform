const pw=require('E:/APPS/Running App Versions/AgriSyncPlatform/.claude/worktrees/plr-d10-ui-9a-4636d5/src/clients/mobile-web/node_modules/playwright-core');
const N={path:4,signin:19,water:11,plots:10,invite:10};
const only=process.argv[2];
(async()=>{
  const b=await pw.chromium.launch({headless:true});
  const p=await b.newPage({viewport:{width:390,height:844}});
  const errs=[]; p.on('console',m=>{if(m.type()==='error')errs.push(m.text())}); p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
  for(const f of Object.keys(N)){
    if(only&&only!==f)continue;
    for(let s=1;s<=N[f];s++){
      await p.goto(`http://127.0.0.1:3086/index.html#f=${f}&s=${s}&nofx=1&solo=1`);
      await p.reload();
      await p.waitForSelector('#phone',{timeout:5000});
      await p.locator('#phone').screenshot({path:`shots/${f}-${String(s).padStart(2,'0')}.png`});
    }
  }
  console.log('errs',errs); await b.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
