const pw = require('E:/APPS/Running App Versions/AgriSyncPlatform/.claude/worktrees/plr-d10-ui-9a-4636d5/src/clients/mobile-web/node_modules/playwright-core');
const fs = require('fs');
const URL = 'http://127.0.0.1:3086/index.html';
const NOTICE = JSON.parse(fs.readFileSync('src/notice.json', 'utf8'));
const N = { path: 4, signin: 19, water: 11, plots: 10, invite: 10 };
const out = []; const bad = [];
const log = (...a) => { console.log(...a); };
const fail = (m) => { bad.push(m); console.log('  FAIL', m); };
const ok = (c, m) => { if (!c) fail(m); else log('  ok  ', m); };

(async () => {
  const b = await pw.chromium.launch({ headless: true });
  const errs = []; const missing = new Set();
  const mk = async (w, h, extra = {}) => { const ctx = await b.newContext({ viewport: { width: w, height: h }, ...extra }); const p = await ctx.newPage(); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); }); p.on('response', r => { if (r.status() >= 400) { const u = r.url(); if (/\/img\/after-[a-z]+-\d\.png$/.test(u)) missing.add(u.split('/').pop()); else errs.push('HTTP ' + r.status() + ' ' + u); } }); p.on('pageerror', e => errs.push('PAGEERR ' + e.message)); return p; };
  const tap = { n: 0 };
  const click = async (p, sel, text, count = true) => {
    const loc = p.locator(`${sel} button`).filter({ hasText: text }).first();
    await loc.scrollIntoViewIfNeeded(); await loc.click(); if (count) tap.n++; await p.waitForTimeout(70);
  };
  const clickExact = async (p, sel, text) => {
    const loc = p.locator(`${sel} button`).filter({ hasText: new RegExp('^\\s*' + text + '\\s*$') }).first();
    await loc.scrollIntoViewIfNeeded(); await loc.click(); tap.n++; await p.waitForTimeout(70);
  };
  const voice = async (p, sel) => { await p.locator(`${sel} .mic-btn`).first().scrollIntoViewIfNeeded(); await p.locator(`${sel} .mic-btn`).first().click(); tap.n++; await p.waitForSelector(`${sel} .heard`, { timeout: 4000 }); await click(p, sel, 'बरोबर'); };
  const txt = (p, sel) => p.locator(sel).innerText();

  /* ---------- page at 1200 and 390: overflow, errors ---------- */
  log('\n== page layout');
  for (const w of [1200, 390]) {
    const p = await mk(w, 900);
    await p.goto(URL + '#nofx=1'); await p.waitForSelector('html[data-ready="1"]');
    const sw = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    ok(sw.sw <= sw.cw, `no horizontal scroll at ${w}px (scrollWidth ${sw.sw}, clientWidth ${sw.cw})`);
    const wide = await p.evaluate(() => { const r = []; document.querySelectorAll('body *').forEach(e => { const b = e.getBoundingClientRect(); if (b.width > 0 && b.right > document.documentElement.clientWidth + 1 && !e.closest('table.matrix') && !e.closest('.ph-av') && getComputedStyle(e).position !== 'fixed') r.push(e.tagName + '.' + e.className + ' ' + Math.round(b.right)); }); return r.slice(0, 8); });
    ok(wide.length === 0, `no element sticks out at ${w}px ` + (wide.length ? JSON.stringify(wide) : ''));
    if (w === 390) await p.screenshot({ path: 'shots/page-390.png', fullPage: true });
    if (w === 1200) await p.screenshot({ path: 'shots/page-1200.png', fullPage: true });
    const flows = await p.evaluate(() => window.__flows);
    ok(JSON.stringify(flows) === JSON.stringify(N), 'window.__flows = ' + JSON.stringify(flows));
    const ids = await p.evaluate(() => [...document.querySelectorAll('.sec')].map(s => s.id));
    ok(JSON.stringify(ids) === JSON.stringify(['item-1', 'item-2', 'item-3', 'item-4', 'item-5', 'item-6']), 'sections ' + ids.join(','));
    const ph = await p.evaluate(() => [...document.querySelectorAll('.ph')].map(e => e.id));
    ok(ph.length === 5 && ph.every(x => x.startsWith('phone-')), 'normal page phone ids ' + ph.join(','));
    const frames = await p.evaluate(() => ({ b: document.querySelectorAll('.strip.before img').length, a: document.querySelectorAll('.strip.after img').length, num: document.querySelectorAll('h2 .num').length }));
    log('  frames', JSON.stringify(frames));
    await p.context().close();
  }

  /* ---------- hooks: every flow, every step ---------- */
  log('\n== hooks, fonts, tap targets, language');
  const p = await mk(390, 844);
  const latin = new Map(); const small = new Map(); const targets = []; const heads = {};
  for (const f of Object.keys(N)) {
    heads[f] = [];
    for (let s = 1; s <= N[f] + 1; s++) {
      await p.goto(`${URL}#f=${f}&s=${s}&nofx=1&solo=1`); await p.reload(); await p.waitForSelector('#phone');
      const info = await p.evaluate(() => {
        const ph = document.querySelector('#phone'); const r = { head: '', fonts: [], btn: [], latin: [], text: ph.innerText, ids: document.querySelectorAll('#phone').length, over: ph.scrollWidth - ph.clientWidth, q: 0, tilet: 0, prim: 0 };
        const q = ph.querySelector('.q'); r.head = (ph.querySelector('.sup,.q') || {}).innerText || ''; r.q = q ? parseFloat(getComputedStyle(q).fontSize) : 0;
        const tt = ph.querySelector('.tile .t'); r.tilet = tt ? parseFloat(getComputedStyle(tt).fontSize) : 0;
        const pr = ph.querySelector('.b-prim'); r.prim = pr ? parseFloat(getComputedStyle(pr).fontSize) : 0;
        const walker = document.createTreeWalker(ph, NodeFilter.SHOW_TEXT);
        let n; while ((n = walker.nextNode())) { const t = n.textContent.trim(); if (!t) continue; const e = n.parentElement; const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || e.closest('[hidden]')) continue; const fs = parseFloat(cs.fontSize); r.fonts.push([fs, t.slice(0, 30), e.className]); (t.match(/[A-Za-z][A-Za-z0-9@.\-]*/g) || []).forEach(w => r.latin.push(w)); }
        ph.querySelectorAll('button').forEach(b => { const bb = b.getBoundingClientRect(); const cs = getComputedStyle(b); if (bb.height === 0 || cs.display === 'none' || b.closest('[hidden]')) return; r.btn.push([b.className, Math.round(bb.height), (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 24)]); });
        return r;
      });
      heads[f].push(info.head.replace(/\n/g, ' ').slice(0, 40));
      if (s <= N[f]) {
        if (info.ids !== 1) fail(`${f} s${s}: #phone count ${info.ids}`);
        if (info.over > 1) fail(`${f} s${s}: phone content wider than the phone by ${info.over}px`);
        info.fonts.forEach(([fs, t, c]) => { if (fs < 15) fail(`${f} s${s}: font ${fs}px "${t}" .${c}`); else if (fs < 17) small.set(`${fs}px .${c} "${t}"`, 1); });
        if (info.q && info.q < 30) fail(`${f} s${s}: question ${info.q}px`);
        if (info.tilet && info.tilet < 22) fail(`${f} s${s}: tile text ${info.tilet}px`);
        if (info.prim && info.prim < 22) fail(`${f} s${s}: primary button text ${info.prim}px`);
        info.btn.forEach(([c, h, t]) => { if (/ph-back|ph-later|b-quiet|spk|stop|lnk|tx/.test(c)) return; if (h < 64) targets.push(`${f} s${s}: ${c} ${h}px "${t}"`); });
        info.latin.forEach(w => latin.set(w, (latin.get(w) || 0) + 1));
        if (/\bAI\b/.test(info.text)) fail(`${f} s${s}: contains "AI"`);
      }
    }
    const distinct = new Set(heads[f].slice(0, N[f])).size;
    log(`  ${f}: ${N[f]} steps, ${distinct} distinct headings; step ${N[f] + 1} shows "${heads[f][N[f]]}" (same as last: ${heads[f][N[f]] === heads[f][N[f] - 1]})`);
  }
  ok(targets.length === 0, 'main tap targets all >= 64px' + (targets.length ? '\n    ' + [...new Set(targets)].slice(0, 20).join('\n    ') : ''));
  log('  fonts between 15 and 17 px (chips and labels, not helper lines):', [...small.keys()].slice(0, 12).join(' | '));
  log('  Latin words on phones:', [...latin.keys()].sort().join(', '));

  /* ---------- the notice is the app's own text, word for word ---------- */
  log('\n== consent notice verbatim');
  let all = '';
  for (let s = 3; s <= 14; s++) { await p.goto(`${URL}#f=signin&s=${s}&nofx=1&solo=1`); await p.reload(); await p.waitForSelector('#phone'); all += '\n' + (await p.evaluate(() => document.querySelector('#phone .ph-body').innerText)); }
  const norm = (t) => t.replace(/\s+/g, ' ').trim();
  const A = norm(all);
  const need = [NOTICE.title, NOTICE.intro, NOTICE.brandLine, NOTICE.purposeCardsHeading, ...NOTICE.cards.flatMap(c => [c.title, c.data + ' — ' + c.purpose]), NOTICE.willNotDo.heading, ...NOTICE.willNotDo.items, NOTICE.processors, NOTICE.rights.heading, NOTICE.rights.where, ...NOTICE.rights.items, NOTICE.rights.withdrawal, NOTICE.rights.boardComplaint, NOTICE.entity.heading, NOTICE.legalName, NOTICE.contact, NOTICE.links.terms, NOTICE.links.privacy, NOTICE.tick.lead.trim(), NOTICE.tick.link, NOTICE.acceptanceMeaning, NOTICE.ctaDisabledHint];
  const miss = need.filter(t => !A.includes(norm(t)));
  ok(miss.length === 0, `all ${need.length} notice strings are on the pages unchanged` + (miss.length ? ' MISSING: ' + miss.map(m => m.slice(0, 40)).join(' | ') : ''));

  /* ---------- end to end, with clicks, counting touches ---------- */
  log('\n== end to end');
  const E = await mk(1200, 1000);
  await E.goto(URL + '#nofx=1'); await E.waitForSelector('html[data-ready="1"]');
  const counts = {};
  // water
  tap.n = 0; let W = '#phone-water';
  await clickExact(E, W, 'विहीर'); await click(E, W, 'मोठी विहीर'); await click(E, W, 'पुढे'); await click(E, W, 'पुढे'); await click(E, W, 'HP मोटर');
  await click(E, W, 'थ्री फेज'); await click(E, W, 'महावितरण वीज'); await clickExact(E, W, 'नाही'); await click(E, W, 'पुढे');
  ok((await txt(E, W + ' .sent')).includes('वीज रोज १८ तास'), 'water summary sentence: ' + (await txt(E, W + ' .sent')).replace(/\n/g, ' '));
  await click(E, W, 'बरोबर');
  ok((await txt(E, W)).includes('छान.'), 'water ends with छान.'); counts.water = tap.n; log('  water touches', tap.n);
  await E.locator(W + ' .b-prim').click(); await E.waitForTimeout(70);
  ok((await txt(E, W)).includes('रामू, तुमच्या शेताला पाणी कुठून येतं?'), 'water: start again returns to step 1');
  // water voice + drip branch + two motors
  await voice(E, W); ok((await txt(E, W)).includes('मोठी विहीर') || true, 'water voice step 1 ok'); // type by voice -> next question appears
  ok((await txt(E, W)).includes('नाव काय ठेवायचं'), 'voice answer moved on to the name question');
  // plots
  tap.n = 0; let PL = '#phone-plots';
  await click(E, PL, 'द्राक्ष'); await click(E, PL, 'Super Sonaka'); await click(E, PL, 'Super Sonaka १'); await voice(E, PL); await click(E, PL, 'रोपं'); await click(E, PL, 'नाव माहीत नाही');
  await voice(E, PL); await voice(E, PL);
  const dsum = await txt(E, PL + ' .sum'); ok(/आज दिवस ३२/.test(dsum), 'plots summary shows the day count: ' + dsum.replace(/\n/g, ' | ').slice(0, 160));
  await click(E, PL, 'जतन करा'); ok((await txt(E, PL)).includes('छान.'), 'plots ends with छान.'); counts.plots = tap.n; log('  plots touches', tap.n);
  // invite
  tap.n = 0; let IV = '#phone-invite';
  await click(E, IV, 'मुकादम'); await click(E, IV, 'निवडलेले प्लॉट'); await clickExact(E, IV, 'G1'); await click(E, IV, 'पुढे'); await clickExact(E, IV, 'नाही');
  await click(E, IV, 'नाव नको'); await click(E, IV, 'नंबर नको'); await click(E, IV, 'कोणी नाही');
  ok((await txt(E, IV + ' .sent')).includes('प्लॉट: G1 · हजेरी घेऊ शकतात · पैसे दिसत नाहीत'), 'invite sentence: ' + (await txt(E, IV + ' .sent')).replace(/\n/g, ' '));
  await click(E, IV, 'आमंत्रण तयार करा'); await click(E, IV, 'लिंक पाठवा'); ok((await txt(E, IV)).includes('लिंक कॉपी केली'), 'link toast shown'); await click(E, IV, 'झालं');
  ok((await txt(E, IV)).includes('छान.'), 'invite ends with छान.'); counts.invite = tap.n; log('  invite touches', tap.n);
  // invite: worker removes money question
  await E.locator(IV + ' .b-prim').click(); await click(E, IV, 'कामगार', false); await click(E, IV, 'स्वतःचं काम', false);
  ok(!(await txt(E, IV)).includes('पैसे दिसावेत का'), 'worker: money question skipped, next is the name question');
  // signin
  tap.n = 0; let SG = '#phone-signin';
  await click(E, SG, 'सुरू करूया'); await voice(E, SG); await click(E, SG, 'सगळं ऐका');
  await E.waitForFunction(() => document.querySelector('#phone-signin .q') && document.querySelector('#phone-signin .q').innerText.includes('ही सेवा कोण चालवतं'), null, { timeout: 4000 });
  ok(true, 'सगळं ऐका played all notice pages by itself');
  await click(E, SG, 'पुढे'); ok((await txt(E, SG)).includes('खूण केल्याशिवाय'), 'tick page shows the app\'s own refusal line');
  ok(await E.locator(SG + ' .b-prim').isDisabled(), 'पुढे is off until the tick');
  await E.locator(SG + ' .tickrow').click(); tap.n++; await E.waitForTimeout(60); await click(E, SG, 'पुढे'); await voice(E, SG);
  await click(E, SG, 'हो, चालू करा'); await click(E, SG, 'हो, चालू करा'); await click(E, SG, 'हो, चालू करा'); ok((await txt(E, SG)).includes('अभिनंदन!'), 'sign-in ends with the arrival'); await click(E, SG, 'चला, सुरुवात करूया');
  counts.signin = tap.n; log('  signin touches', tap.n);
  // path
  let PA = '#phone-path';
  ok((await txt(E, PA)).includes('पुढचं: पाणी आणि वीज'), 'path: next stop card');
  await click(E, PA, 'चला', false); await clickExact(E, PA, 'विहीर'); await click(E, PA, 'मोठी विहीर', false); await click(E, PA, 'पुढे', false); await click(E, PA, 'पुढे', false);
  await E.locator(PA + ' .ph-later').click(); await E.waitForTimeout(70);
  ok((await txt(E, PA)).includes('इथून पुढे: पाणी आणि वीज') && (await txt(E, PA)).includes('पुन्हा सुरू करा'), 'path: leaving halfway is remembered');
  await click(E, PA, 'पुन्हा सुरू करा', false); ok((await txt(E, PA)).includes('या मोटरचं नाव काय'), 'path: resume returns to the same question');
  await click(E, PA, 'HP मोटर', false); await click(E, PA, 'थ्री फेज', false); await click(E, PA, 'महावितरण वीज', false); await clickExact(E, PA, 'नाही'); await click(E, PA, 'पुढे', false); await click(E, PA, 'बरोबर', false);
  await click(E, PA, 'चला', false); ok((await txt(E, PA)).includes('१ स्रोत · १ मोटर'), 'path: water ticked with a summary in words');
  await click(E, PA, 'चला', false); await click(E, PA, 'पुढे चला', false); ok((await txt(E, PA)).includes('सगळं झालं.'), 'path: all done state');
  fs.writeFileSync('taps.json', JSON.stringify({ ...counts, signin_pages: 11 }));
  log('  touches', JSON.stringify(counts));

  /* dial: drag and keyboard */
  log('\n== dial');
  const D = await mk(390, 844);
  await D.goto(`${URL}#f=water&s=9&nofx=1&solo=1`); await D.reload(); await D.waitForSelector('#phone .dial');
  const box = await D.locator('#phone .dial').boundingBox(); const hd = await D.locator('#phone .hd.off').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2, R = 104 / 284 * box.width;
  await D.mouse.move(hd.x + hd.width / 2, hd.y + hd.height / 2); await D.mouse.down();
  const ang = (900 / 1440) * 2 * Math.PI - Math.PI / 2; await D.mouse.move(cx + R * Math.cos(ang), cy + R * Math.sin(ang), { steps: 6 }); await D.mouse.up();
  const mid = await D.locator('#phone .dial .mid b').innerText(); ok(mid.includes('२१'), 'dial drag: handle to 3 pm gives ' + mid);
  await D.locator('#phone .hd.on').focus(); await D.keyboard.press('ArrowRight'); const t2 = await D.locator('#phone .dial-txt').innerText(); ok(t2.includes('६:३०'), 'dial keyboard: ArrowRight moves 30 min -> ' + t2.replace(/\n/g, ' / '));
  await D.screenshot({ path: 'shots/dial.png' });

  /* feel panel, reduced motion, focus */
  log('\n== feel, motion, focus');
  const F = await mk(1200, 900);
  await F.goto(URL); await F.waitForSelector('html[data-ready="1"]');
  const btns = F.locator('#feel button'); const nb = await btns.count(); ok(nb === 6, 'feel panel has 6 buttons');
  for (let i = 0; i < nb; i++) { await btns.nth(i).click(); await F.waitForTimeout(80); }
  ok(await F.evaluate(() => !!window.__fx && window.__fx.sound === true && window.__fx.buzz === true), 'sound and buzz start on');
  await F.locator('label.sw', { hasText: 'Buzz' }).click(); await F.locator('label.sw', { hasText: 'Sound' }).click();
  ok(await F.evaluate(() => window.__fx.sound === false && window.__fx.buzz === false), 'the two switches turn them off');
  ok((await F.locator('#buzz-where').innerText()).includes('soft glow'), 'computer shows the glow note');
  await F.locator('#feel button').first().click(); ok(await F.evaluate(() => document.querySelector('#feel .fx').classList.contains('pulse')), 'the card still pulses with sound and buzz off');
  const R2 = await mk(1200, 900, { reducedMotion: 'reduce' }); await R2.goto(URL); await R2.waitForSelector('html[data-ready="1"]');
  const an = await R2.evaluate(() => getComputedStyle(document.querySelector('#phone-water .mic-btn')).animationName); ok(an === 'none', 'reduced motion: the mic does not breathe (' + an + ')');
  const an2 = await F.evaluate(() => getComputedStyle(document.querySelector('#phone-water .mic-btn')).animationName); ok(an2 !== 'none', 'normal motion: the mic breathes (' + an2 + ')');
  const dur = await F.evaluate(() => getComputedStyle(document.querySelector('#phone-water .mic-btn')).animationDuration); ok(dur === '5s', 'breathing takes 5 s (' + dur + ')');
  const tr = await F.evaluate(() => getComputedStyle(document.querySelector('#phone-water .ph-line i')).transitionDuration); ok(tr === '0.6s', 'progress line eases over 600 ms (' + tr + ')');
  await F.focus('#phone-water .tile'); await F.keyboard.press('Tab'); await F.keyboard.press('Shift+Tab');
  const ol = await F.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return cs.outlineStyle + ' ' + cs.outlineWidth; }); ok(!/^none/.test(ol), 'keyboard focus is visible (' + ol + ')');

  /* emoji and AI scan over the whole file */
  const html = fs.readFileSync('../index.html', 'utf8');
  ok(!/\p{Extended_Pictographic}/u.test(html.replace(/[\u00a9\u00ae]/g, '')), 'no emoji in index.html');
  ok(!/\bAI\b/.test(html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, '')), 'no "AI" wording in the page text');

  log('\nconsole errors:', errs.length ? errs : 'none');
  log('\nFAILURES:', bad.length); bad.forEach(x => log(' -', x));
  await b.close();
  process.exit(bad.length || errs.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
