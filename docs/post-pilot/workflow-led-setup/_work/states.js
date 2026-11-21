const pw=require('E:/APPS/Running App Versions/AgriSyncPlatform/.claude/worktrees/plr-d10-ui-9a-4636d5/src/clients/mobile-web/node_modules/playwright-core');
(async()=>{
  const b=await pw.chromium.launch(); const p=await (await b.newContext({viewport:{width:390,height:844}})).newPage();
  const go=async(h)=>{await p.goto('http://127.0.0.1:3086/index.html#'+h+'&nofx=1&solo=1'); await p.reload(); await p.waitForSelector('#phone');};
  const shot=async(n)=>{await p.waitForTimeout(150); await p.locator('#phone').screenshot({path:`shots/st-${n}.png`});};
  await go('f=water&s=4'); await p.locator('#phone button',{hasText:'लिहा'}).click(); await shot('1keypad');
  await go('f=water&s=1'); await p.locator('#phone .mic-btn').click(); await p.waitForSelector('#phone .heard'); await shot('2heard');
  await go('f=plots&s=8'); await p.locator('#phone button',{hasText:'आधी केली'}).click(); await shot('3date');
  await go('f=invite&s=9'); await p.locator('#phone button',{hasText:'QR दाखवा'}).click(); await shot('4qr');
  await go('f=signin&s=14'); await p.locator('#phone .tickrow').click(); await shot('5tick');
  await go('f=water&s=9'); await shot('6dial');
  await go('f=invite&s=3'); await p.locator('#phone button',{hasText:'सगळे निवडा'}).first().click(); await shot('7pick');
  await go('f=water&s=3'); await shot('8count');
  await b.close();
})();
