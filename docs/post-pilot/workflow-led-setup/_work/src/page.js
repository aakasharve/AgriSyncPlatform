/* ===== the page around the phones ===== */
(function () {
  const AFTER = { path: [1, 2, 3, 4], signin: [1, 2, 3, 14, 16, 19], water: [1, 2, 4, 6, 9, 10], plots: [1, 2, 3, 4, 8, 9], invite: [1, 2, 3, 4, 8, 9] };
  const phones = {};

  /* --- pictures that are not there yet show a calm placeholder --- */
  const markMissing = (img) => { const f = img.closest('.fr'); if (f) f.classList.add('missing'); };
  $$('.fr img').forEach(img => { if (img.complete && img.naturalWidth === 0) markMissing(img); img.addEventListener('error', () => markMissing(img)); });

  /* --- zoom a picture --- */
  const dlg = $('#zoom');
  if (dlg && dlg.showModal) {
    $$('.fr .pic').forEach(b => b.addEventListener('click', () => {
      const f = b.closest('.fr'); if (f.classList.contains('missing')) return;
      $('img', dlg).src = $('img', b).src; $('p', dlg).textContent = $('figcaption', f).textContent; dlg.showModal();
    }));
    $('button', dlg).addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  }

  /* --- the hero moment --- */
  (function () {
    const m = $('#moment'); if (!m) return;
    const btn = $('.mic-btn', m), cap = $('.mic-cap', m), out = $('.heard-line', m);
    btn.addEventListener('click', () => {
      if (m.classList.contains('on')) return;
      m.classList.add('on'); cap.innerHTML = '<span class="bars"><i></i><i></i><i></i><i></i></span>ऐकत आहे'; fx('mic', m);
      setTimeout(() => { out.textContent = 'मला असं ऐकू आलं: विहीर'; cap.textContent = 'बोला'; m.classList.remove('on'); fx('heard', m); }, NOFX ? 0 : 1800);
    });
  })();

  /* --- how it should feel --- */
  const FEEL = [
    ['arrive', 'Arrive', 'A question appears, or a flow is entered. Only a low tone.'],
    ['choose', 'Choose', 'A tile or a plot is tapped. One soft tone and a tiny tick.'],
    ['mic', 'Mic on', 'The farmer taps the breathing mic. Two soft rising tones.'],
    ['heard', 'Heard', 'The card "मला असं ऐकू आलं" appears. A quiet two-note chord, no buzz.'],
    ['confirm', 'Confirm', 'He taps बरोबर. A short rising pair and a small double pulse.'],
    ['done', 'Done', 'A flow ends with "छान". Three slow rising notes and the longest pulse.']
  ];
  const feel = $('#feel');
  if (feel) {
    FEEL.forEach(([k, t, d]) => {
      const e = EFFECTS[k], c = el('div', 'fx');
      const tones = e.tones.map(x => `${Math.round(x[0])} Hz`).join(', ');
      const buzz = e.vib ? `buzz ${e.vib.join(', ')} ms` : 'no buzz';
      c.innerHTML = `<span class="dot"></span><h3>${t}</h3><p>${d}<br><span style="color:var(--ink3);font-size:14.5px">${tones} · ${buzz}</span></p>`;
      const b = el('button', '', ic('spk', 20, 2.4) + 'Feel it'); b.type = 'button';
      b.addEventListener('click', () => { c.classList.remove('pulse'); void c.offsetWidth; c.classList.add('pulse'); if (!FX.sound && !FX.buzz) return; const n = NOFX; fx(k, c); });
      c.append(b); feel.append(c);
    });
    $('#sw-sound').addEventListener('change', e => { FX.sound = e.target.checked; });
    $('#sw-buzz').addEventListener('change', e => { FX.buzz = e.target.checked; });
    const bz = $('#buzz-where');
    if (bz) bz.textContent = CAN_BUZZ ? 'This device can buzz: you will feel the patterns.' : 'This computer cannot buzz, so you see a soft glow instead. On an Android phone the same buttons buzz.';
  }

  /* --- the phones --- */
  const itemName = { path: 'item-2', signin: 'item-3', water: 'item-4', plots: 'item-5', invite: 'item-6' };
  Object.keys(FLOWS).forEach(id => {
    const stage = $(`.stage[data-flow="${id}"]`); if (!stage) return;
    const root = $('.ph', stage); root.id = 'phone-' + id;
    const P = new Phone(root, FLOWS[id]); phones[id] = P;
    const s = HASH.f === id && HASH.s ? parseInt(HASH.s, 10) : 1;
    if (id === 'path') { P.road = ROAD.sample(s); P.stack[0].i = 0; P.render(); }
    else if (s > 1) { const f = sampleTo(FLOWS[id], s); P.stack[0].ans = f.ans; P.stack[0].i = f.i; P.render(); }
    const list = $('ol.road', stage), note = $('.road-note', stage);
    const paintList = () => {
      const root0 = P.stack[0], def = root0.def;
      let names, idx;
      if (def.listing) { const L = def.listing(P); names = L.names; idx = L.idx; list.innerHTML = names.map((n, i) => `<li class="${i < idx ? 'past' : i === idx ? 'here' : ''}">${n}</li>`).join(''); note.textContent = 'This road shows the state of the phone. Tap चला to open a stop, tap the pause button inside it to leave, then come back.'; return; }
      const steps = def.steps(root0.ans, P); const cur = root0.i;
      const items = []; steps.forEach((st, i) => { const lab = st.en || st.kind; if (lab.startsWith('Notice:')) { const last = items[items.length - 1]; if (last && last.group) { last.to = i; return; } items.push({ group: true, from: i, to: i, label: 'The notice, read page by page (' + steps.filter(x => (x.en || '').startsWith('Notice:')).length + ' pages)' }); return; } items.push({ from: i, to: i, label: lab }); });
      list.innerHTML = items.map(it => `<li class="${cur > it.to ? 'past' : (cur >= it.from && cur <= it.to) ? 'here' : ''}">${it.label}</li>`).join('');
      note.textContent = '';
    };
    P.on(paintList); paintList();
    $('.again', stage).addEventListener('click', () => { P.restart(); });
  });
  window.__phones = phones; window.__fx = FX;

  /* --- the block matrix, computed from the real flow definitions --- */
  (function () {
    const tbl = $('#matrix'); if (!tbl) return;
    const BL = [['tiles', 'Choose one (tiles)'], ['number', 'A number'], ['text', 'A short name'], ['digits', 'Digits (phone, code)'], ['dial', 'The 24-hour ring'], ['date', 'A date'], ['pick', 'Pick several'], ['read', 'A page read aloud'], ['tick', 'The one tick'], ['perm', 'A permission'], ['summary', 'What I understood'], ['done', 'The ending']];
    const flows = ['signin', 'water', 'plots', 'invite'];
    const used = {}; const saved = ALT;
    flows.forEach(f => { used[f] = new Set(); [false, true].forEach(alt => { ALT = alt; const def = FLOWS[f]; const ans = {}; for (let i = 0; ; i++) { const st = def.steps(ans)[i]; if (!st) break; used[f].add(st.kind); Object.assign(ans, (alt && st.sampleAlt) ? st.sampleAlt : (st.sample || {})); } }); });
    ALT = saved;
    const tick = ic('check', 18, 3);
    tbl.innerHTML = `<thead><tr><th>Block</th>${flows.map(f => `<th>${{ signin: 'Sign-in', water: 'Water', plots: 'Plots', invite: 'Invite' }[f]}</th>`).join('')}</tr></thead><tbody>` +
      BL.map(([k, t]) => `<tr><td>${t}</td>${flows.map(f => `<td>${used[f].has(k) ? tick : ''}</td>`).join('')}</tr>`).join('') + '</tbody>';
    const kinds = new Set(); flows.forEach(f => used[f].forEach(k => kinds.add(k)));
    const n = $('#block-count'); if (n) n.textContent = String(BL.filter(([k]) => kinds.has(k)).length);
    const sh = $('#shared-count'); if (sh) sh.textContent = String(BL.filter(([k]) => flows.filter(f => used[f].has(k)).length > 1).length);
  })();

  /* --- hooks: window.__flows, window.__after, solo mode --- */
  window.__flows = {}; Object.keys(FLOWS).forEach(id => { window.__flows[id] = countSteps(FLOWS[id]); });
  window.__after = AFTER;
  if (HASH.solo === '1') {
    const id = FLOWS[HASH.f] ? HASH.f : 'path';
    document.documentElement.classList.add('solo');
    const host = el('div'); host.id = 'solo-host'; document.body.append(host);
    const root = phones[id].root; host.append(root); root.id = 'phone';
  }
  document.documentElement.setAttribute('data-ready', '1');
})();
