/* ===== hooks: #f=<flow>&s=<step>&nofx=1&solo=1  (+ alt=1 picks the other branch of a flow) ===== */
const HASH = (() => { const o = {}; (location.hash || '').replace(/^#/, '').split('&').forEach(p => { if (!p) return; const i = p.indexOf('='); const k = i < 0 ? p : p.slice(0, i); try { o[decodeURIComponent(k)] = i < 0 ? '' : decodeURIComponent(p.slice(i + 1)); } catch (e) { /* ignore a broken hash */ } }); return o; })();
const NOFX = HASH.nofx === '1';
let ALT = HASH.alt === '1';
if (NOFX) document.documentElement.classList.add('nofx');

/* ===== the feel: soft sine tones (gain 0.05 to 0.08, 300 to 700 ms decay) and short buzz patterns ===== */
const FX = { sound: true, buzz: true, ctx: null };
const CAN_BUZZ = typeof navigator.vibrate === 'function' && /Android/i.test(navigator.userAgent || '');
const EFFECTS = {
  arrive:  { tones: [[293.66, 0, .65, .05], [392, .2, .6, .04]], vib: null },
  choose:  { tones: [[392, 0, .32, .06]], vib: [6] },
  mic:     { tones: [[329.63, 0, .4, .06], [440, .17, .45, .05]], vib: [10] },
  heard:   { tones: [[440, 0, .4, .05], [554.37, .13, .5, .05]], vib: null },
  confirm: { tones: [[392, 0, .32, .07], [523.25, .15, .55, .07]], vib: [8, 70, 12] },
  done:    { tones: [[329.63, 0, .5, .06], [392, .2, .55, .07], [493.88, .4, .7, .08]], vib: [10, 90, 12, 90, 16] }
};
function audioCtx() {
  if (FX.ctx) return FX.ctx;
  try { FX.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { FX.ctx = null; }
  return FX.ctx;
}
function tone(freq, start, dur, gain) {
  const c = audioCtx(); if (!c) return;
  try {
    if (c.state === 'suspended') c.resume();
    const t = c.currentTime + start, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.045);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.05);
  } catch (e) { /* no audio here: nothing to do */ }
}
function glowOn(node) {
  if (!node) return;
  node.classList.remove('glow'); void node.offsetWidth; node.classList.add('glow');
  setTimeout(() => node.classList.remove('glow'), 1200);
}
function fx(name, node) {
  if (NOFX) return;
  const e = EFFECTS[name]; if (!e) return;
  if (FX.sound) e.tones.forEach(t => tone(t[0], t[1], t[2], t[3]));
  if (FX.buzz && e.vib) {
    if (CAN_BUZZ) { try { navigator.vibrate(e.vib); } catch (x) { /* ignore */ } } else glowOn(node);
  }
}

/* ===== the shell of every phone ===== */
const SHELL = () => `<div class="ph-glow"></div>
<div class="ph-top"><button type="button" class="ph-back" aria-label="मागे">${ic('back', 24, 2.6)}</button><div class="ph-line" role="progressbar" aria-label="प्रगती" aria-valuemin="0" aria-valuemax="100"><i></i></div><button type="button" class="ph-later" aria-label="नंतर करू" hidden>${ic('pause', 22, 2.6)}</button><div class="ph-av"><img alt="" src="${ART('sathi-point')}"></div></div>
<div class="ph-body"></div><div class="ph-foot"></div>`;

const clockText = (m) => {
  const h = Math.floor(m / 60), mm = m % 60;
  const p = (h >= 4 && h < 6) ? 'पहाटे' : (h >= 6 && h < 12) ? 'सकाळी' : (h >= 12 && h < 16) ? 'दुपारी' : (h >= 16 && h < 20) ? 'संध्याकाळी' : 'रात्री';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${p} ${dv(h12)}:${dv(String(mm).padStart(2, '0'))}`;
};
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const hoursText = (min) => { const h = min / 60; return dv(Number.isInteger(h) ? h : h.toFixed(1)) + ' तास'; };
const todayParts = () => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }; };
const dayDiff = (p, q) => Math.round((Date.UTC(q.y, q.m - 1, q.d) - Date.UTC(p.y, p.m - 1, p.d)) / 86400000);
const dim = (y, m) => new Date(y, m, 0).getDate();
const isoOf = (p) => `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
const shiftDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }; };
const dateWords = (p) => `${dv(p.d)} ${MONTHS[p.m - 1]} ${dv(p.y)}`;

class Phone {
  constructor(root, def) {
    this.root = root; root.classList.add('ph'); root.innerHTML = SHELL();
    this.body = $('.ph-body', root); this.foot = $('.ph-foot', root);
    this.back = $('.ph-back', root); this.laterBtn = $('.ph-later', root);
    this.line = $('.ph-line', root); this.bar = $('i', this.line);
    this.stack = []; this.listeners = []; this.timers = []; this.reading = false; this.autoRead = false;
    this.back.onclick = () => this.goBack();
    this.laterBtn.onclick = () => this.leave('later');
    this.enter(def, {});
  }
  on(fn) { this.listeners.push(fn); }
  emit() { this.listeners.forEach(f => f(this)); }
  get f() { return this.stack[this.stack.length - 1]; }
  get steps() { return this.f.def.steps(this.f.ans, this); }
  after(fn, ms) { const id = setTimeout(fn, ms); this.timers.push(id); return id; }
  clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; }
  enter(def, o) { this.stack.push({ def, ans: o.ans || {}, i: o.i || 0, embedded: !!o.embedded, onExit: o.onExit }); this.render(); }
  render() {
    this.clearTimers();
    const f = this.f, steps = f.def.steps(f.ans, this);
    f.i = Math.max(0, Math.min(f.i, steps.length - 1));
    const st = steps[f.i]; this.st = st; this.locked = false;
    this.body.innerHTML = ''; this.foot.innerHTML = '';
    const em = f.embedded;
    this.laterBtn.hidden = !(em && st.kind !== 'road');
    this.back.setAttribute('aria-disabled', (f.i === 0 && !em) ? 'true' : 'false');
    const prog = f.def.progress ? f.def.progress(this) : f.i / Math.max(1, steps.length - 1);
    this.bar.style.width = Math.max(3, Math.round(prog * 100)) + '%';
    this.line.setAttribute('aria-valuenow', String(Math.round(prog * 100)));
    if (st.kind !== 'read') this.autoRead = false;
    KINDS[st.kind].call(this, st);
    if (!NOFX) { this.body.classList.remove('enter'); void this.body.offsetWidth; this.body.classList.add('enter'); }
    this.body.scrollTop = 0;
    this.emit();
  }
  next() { const n = this.steps.length; if (this.f.i < n - 1) { this.f.i++; this.render(); } else this.complete(); }
  goBack() { const f = this.f; if (f.i > 0) { f.i--; this.render(); } else if (f.embedded) this.leave('back'); }
  complete() { if (this.f.embedded) this.leave('done'); else this.restart(); }
  leave(reason) { const fr = this.stack.pop(); if (fr && fr.onExit) fr.onExit(reason, fr); this.render(); }
  restart() { this.stack.length = 1; const b = this.stack[0]; b.ans = {}; b.i = 0; if (b.def.reset) b.def.reset(this); this.render(); }
  toast(msg) { const t = el('div', 'toast', msg); t.setAttribute('role', 'status'); this.root.append(t); setTimeout(() => t.remove(), 2600); }

  /* ---- pieces used by several blocks ---- */
  ask(st) {
    const w = document.createDocumentFragment();
    if (st.sup) w.append(el('p', 'sup', st.sup));
    if (st.q) w.append(el('h2', 'q', st.q));
    if (st.helper) w.append(el('p', 'helper' + (st.hk ? ' k' : ''), st.helper));
    return w;
  }
  mic(st, o = {}) {
    const w = el('div', 'mic' + (o.compact ? ' compact' : ''));
    const b = el('button', 'mic-btn', ic('mic', 46, 2.4)); b.type = 'button'; b.setAttribute('aria-label', 'बोला');
    const cap = el('p', 'mic-cap', 'बोला'); cap.setAttribute('aria-live', 'polite');
    b.onclick = () => {
      if (this.locked || w.classList.contains('on')) return;
      w.classList.add('on'); cap.innerHTML = '<span class="bars"><i></i><i></i><i></i><i></i></span>ऐकत आहे';
      fx('mic', this.root);
      this.after(() => this.heard(st, w), NOFX ? 0 : 1900);
    };
    w.append(b, cap); return w;
  }
  heard(st, w) {
    const v = typeof st.voice === 'function' ? st.voice(this.f.ans) : st.voice;
    const card = el('div', 'heard');
    card.innerHTML = `<div class="lab"><span>मला असं ऐकू आलं:</span><span class="chip">नमुना आवाज</span></div><div class="say">${v.say}</div>`;
    const ok = el('button', 'b-prim', 'बरोबर'); ok.type = 'button';
    const again = el('button', 'b-quiet', 'पुन्हा बोला'); again.type = 'button';
    ok.onclick = () => { if (this.locked) return; this.locked = true; Object.assign(this.f.ans, v.set); fx('confirm', this.root); this.after(() => this.next(), NOFX ? 0 : 300); };
    again.onclick = () => card.replaceWith(this.mic(st, { compact: w.classList.contains('compact') }));
    card.append(ok, again); w.replaceWith(card); fx('heard', this.root);
  }
  primary(label, onclick, disabled) {
    const b = el('button', 'b-prim', label); b.type = 'button'; b.disabled = !!disabled; b.onclick = () => { if (!b.disabled) onclick(); };
    this.foot.append(b); return b;
  }
  quiet(label, onclick, where) {
    const b = el('button', 'b-quiet', label); b.type = 'button'; b.onclick = onclick; (where || this.foot).append(b); return b;
  }
  keypad(onKey, dec) {
    const pad = el('div', 'keypad'); pad.hidden = true;
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', dec ? '.' : '', '0', 'bk'].forEach(k => {
      const b = el('button', k === '' ? 'ghost' : '', k === 'bk' ? ic('bksp', 28, 2.2) : (k === '.' ? '.' : (k === '' ? '' : dv(k)))); b.type = 'button';
      if (k === 'bk') b.setAttribute('aria-label', 'पुसा'); else if (k === '') b.tabIndex = -1;
      b.onclick = () => { onKey(k); fx('choose', this.root); }; pad.append(b);
    });
    return pad;
  }
}

/* ===== the blocks: every flow is a list of these ===== */
const KINDS = {
  /* choose one: big tiles, a mic above them */
  tiles(st) {
    const a = this.f.ans, b = this.body;
    b.append(this.ask(st));
    if (!st.nomic) b.append(this.mic(st, { compact: !!st.micCompact }));
    const cur = a[st.key];
    const list = typeof st.tiles === 'function' ? st.tiles(a) : st.tiles;
    const g = el('div', 'tiles c' + (st.cols || 2));
    list.forEach(t => {
      const x = el('button', 'tile' + (st.row ? ' row' : '') + (cur === t.k ? ' on' : '')); x.type = 'button'; x.setAttribute('aria-pressed', String(cur === t.k));
      const pic = (t.art || '') + (t.img ? `<img class="crop" alt="" src="${t.img}">` : '');
      const txt = `<span class="t">${t.t}</span>${t.s ? `<span class="s">${t.s}</span>` : ''}`;
      x.innerHTML = pic + (st.row ? `<span class="tx">${txt}</span>` : txt) + `<span class="tick">${ic('check', 16, 3.2)}</span>`;
      x.onclick = () => {
        if (this.locked) return; this.locked = true;
        $$('.tile', g).forEach(y => { y.classList.remove('on'); y.setAttribute('aria-pressed', 'false'); });
        x.classList.add('on'); x.setAttribute('aria-pressed', 'true');
        a[st.key] = t.k; if (st.onPick) st.onPick(t, a);
        fx('choose', this.root); this.after(() => this.next(), NOFX ? 0 : 420);
      };
      g.append(x);
    });
    b.append(g);
    if (st.note) b.append(el('p', 'helper', st.note));
    if (cur !== undefined) this.primary('पुढे', () => this.next());
  },

  /* a number: big steppers, a keypad for the typed way */
  number(st) {
    const a = this.f.ans, b = this.body;
    b.append(this.ask(st));
    const micw = this.mic(st); b.append(micw);
    let v = a[st.key] !== undefined ? a[st.key] : (st.def !== undefined ? st.def : null);
    if (st.units && a[st.unitKey] === undefined) a[st.unitKey] = st.units[0].k;
    let buf = v == null ? '' : String(v);
    const out = el('div', 'val'), minus = el('button', 'pm', ic('minus', 30, 2.8)), plus = el('button', 'pm', ic('plus', 30, 2.8));
    minus.type = plus.type = 'button'; minus.setAttribute('aria-label', 'कमी करा'); plus.setAttribute('aria-label', 'वाढवा');
    const nb = el('div', 'numbox'); nb.append(minus, out, plus); b.append(nb);
    let utiles = null;
    if (st.units) {
      utiles = el('div', 'tiles c' + st.units.length);
      st.units.forEach(u => {
        const x = el('button', 'tile'); x.type = 'button'; x.innerHTML = `<span class="t">${u.t}</span><span class="tick">${ic('check', 16, 3.2)}</span>`;
        x.onclick = () => { a[st.unitKey] = u.k; fx('choose', this.root); paint(); };
        x.dataset.k = u.k; utiles.append(x);
      });
      b.append(utiles);
    }
    const pad = this.keypad(k => {
      if (k === 'bk') buf = buf.slice(0, -1);
      else if (k === '.') { if (st.dec && !buf.includes('.') && buf !== '') buf += '.'; }
      else if (buf.length < 6) buf = (buf === '0' ? '' : buf) + k;
      v = buf === '' || buf === '.' ? null : parseFloat(buf); paint();
    }, st.dec);
    b.append(pad);
    const ok = this.primary('पुढे', () => { a[st.key] = v; fx('confirm', this.root); this.next(); }, true);
    const paint = () => {
      const u = st.units ? st.units.find(x => x.k === a[st.unitKey]) : null;
      const unitTxt = u ? u.t : (st.unit || '');
      out.className = 'val' + (v == null ? ' empty' : '');
      out.innerHTML = (v == null ? '—' : dv(v)) + (unitTxt ? `<small>${unitTxt}</small>` : '');
      if (utiles) $$('.tile', utiles).forEach(x => { const on = x.dataset.k === a[st.unitKey]; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
      const mx = typeof st.max === 'function' ? st.max(a) : st.max;
      ok.disabled = !(v != null && v >= (st.min != null ? st.min : 0) && (mx == null || v <= mx));
    };
    const step = (dir) => {
      const base = v == null ? 0 : v; let n = Math.round((base + dir * (st.step || 1)) * 100) / 100;
      n = Math.max(st.min != null ? st.min : 0, Math.min(typeof st.max === 'function' ? st.max(a) : (st.max != null ? st.max : 999999), n));
      v = n; buf = String(n); paint(); fx('choose', this.root);
    };
    minus.onclick = () => step(-1); plus.onclick = () => step(1);
    const tg = this.quiet('लिहा', () => { pad.hidden = !pad.hidden; tg.textContent = pad.hidden ? 'लिहा' : 'लपवा'; micw.classList.toggle('compact', !pad.hidden); }, b);
    if (st.skip) this.quiet(st.skip, () => { a[st.key] = null; this.next(); }, this.foot);
    paint();
  },

  /* a short name: suggestion first, mic, typed way */
  text(st) {
    const a = this.f.ans, b = this.body;
    b.append(this.ask(st));
    const micw = this.mic(st); b.append(micw);
    const sug = st.suggest ? st.suggest(a) : null;
    if (sug) {
      const x = el('button', 'tile row' + (a[st.key] === sug ? ' on' : '')); x.type = 'button';
      x.innerHTML = `<span class="tx"><span class="s">सुचवलेलं — फक्त सुचवलेलं, नाव तुमचंच</span><span class="t">${sug}</span></span><span class="tick">${ic('check', 16, 3.2)}</span>`;
      x.onclick = () => { if (this.locked) return; this.locked = true; a[st.key] = sug; x.classList.add('on'); fx('choose', this.root); this.after(() => this.next(), NOFX ? 0 : 420); };
      b.append(x);
    }
    if (st.note) b.append(el('p', 'helper', st.note));
    const wrap = el('div'); b.append(wrap);
    const showField = () => {
      wrap.innerHTML = '';
      const inp = el('input', 'fld'); inp.type = 'text'; inp.lang = 'mr'; inp.value = a[st.key] || ''; inp.placeholder = st.ph || ''; inp.setAttribute('aria-label', st.q);
      wrap.append(inp);
      this.foot.innerHTML = '';
      const ok = this.primary('पुढे', () => { a[st.key] = inp.value.trim(); fx('confirm', this.root); this.next(); }, !inp.value.trim());
      inp.oninput = () => { ok.disabled = !inp.value.trim(); };
      inp.onkeydown = (e) => { if (e.key === 'Enter' && !ok.disabled) ok.click(); };
      if (st.skip) this.quiet(st.skip, () => { a[st.key] = ''; this.next(); });
      if (!NOFX) setTimeout(() => inp.focus(), 50);
    };
    if (a[st.key]) showField(); else {
      this.quiet('लिहा', showField, b);
      if (st.skip) this.quiet(st.skip, () => { a[st.key] = ''; this.next(); });
    }
  },

  /* digits: a phone number or a code */
  digits(st) {
    const a = this.f.ans, b = this.body;
    b.append(this.ask(st));
    const micw = this.mic(st); b.append(micw);
    let buf = a[st.key] || '';
    const disp = el('div'); b.append(disp);
    const warn = el('p', 'warn', 'दहा अंकी मोबाईल नंबर टाका.'); warn.hidden = true; b.append(warn);
    const pad = this.keypad(k => { if (k === 'bk') buf = buf.slice(0, -1); else if (buf.length < st.len) buf += k; paint(); });
    b.append(pad);
    const ok = this.primary('पुढे', () => { a[st.key] = buf; fx('confirm', this.root); this.next(); }, true);
    const paint = () => {
      if (st.boxes) {
        disp.className = 'digits'; disp.innerHTML = '';
        for (let i = 0; i < st.len; i++) disp.append(el('span', 'd' + (i === buf.length ? ' on' : ''), buf[i] ? dv(buf[i]) : ''));
      } else {
        disp.className = 'digits phone'; disp.innerHTML = `<span class="pre">+९१</span><span>${dv(buf)}</span><span class="ph-empty">${'•'.repeat(st.len - buf.length)}</span>`;
      }
      ok.disabled = buf.length !== st.len;
      warn.hidden = !(st.warnShort && buf.length > 0 && buf.length < st.len);
    };
    const tg = this.quiet('लिहा', () => { pad.hidden = !pad.hidden; tg.textContent = pad.hidden ? 'लिहा' : 'लपवा'; micw.classList.toggle('compact', !pad.hidden); }, b);
    if (st.skip) this.quiet(st.skip, () => { a[st.key] = ''; this.next(); });
    paint();
  },

  /* the 24-hour ring */
  dial(st) {
    const a = this.f.ans, b = this.body;
    b.append(this.ask(st));
    b.append(this.mic(st, { compact: true }));
    const cur = a[st.key] && !a[st.key].none ? a[st.key] : { off: 720, on: 1080 };
    let off = cur.off, on = cur.on;
    const C = 142, R = 104, SW = 30;
    const pt = (m) => { const g = (m / 1440) * 2 * Math.PI - Math.PI / 2; return [C + R * Math.cos(g), C + R * Math.sin(g)]; };
    const arc = () => { let d = (on - off + 1440) % 1440; if (d === 0) return ''; const [x1, y1] = pt(off), [x2, y2] = pt(off + d); return `M${x1.toFixed(1)} ${y1.toFixed(1)} A${R} ${R} 0 ${d > 720 ? 1 : 0} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`; };
    const box = el('div', 'dial'); b.append(box);
    box.innerHTML = `<svg viewBox="0 0 284 284" aria-hidden="true"><circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="#6EE7B7" stroke-width="${SW}"/><path class="off" d="" fill="none" stroke="#D6D3D1" stroke-width="${SW}"/></svg>
<div class="mid"><b></b><span>वीज असते</span></div>`;
    [['रात्री १२', 0], ['सकाळी ६', 360], ['दुपारी १२', 720], ['संध्या ६', 1080]].forEach(([t, m]) => {
      const [x, y] = pt(m); const l = el('span', 'lbl', t);
      l.style.left = (x / 284 * 100) + '%'; l.style.top = (y / 284 * 100) + '%'; l.style.transform = 'translate(-50%,-50%)'; l.style.background = 'rgba(255,255,255,.85)'; l.style.borderRadius = '9px'; l.style.padding = '1px 6px';
      box.append(l);
    });
    const mk = (cls, label) => { const h = el('button', 'hd ' + cls, ic(cls === 'off' ? 'cut' : 'bolt', 22, 2.6)); h.type = 'button'; h.setAttribute('role', 'slider'); h.setAttribute('aria-label', label); h.setAttribute('aria-valuemin', '0'); h.setAttribute('aria-valuemax', '1410'); box.append(h); return h; };
    const hOff = mk('off', 'वीज जाण्याची वेळ'), hOn = mk('on', 'वीज येण्याची वेळ');
    const txt = el('p', 'dial-txt'); b.append(txt);
    const warn = el('p', 'warn', 'वीज जाण्याची आणि येण्याची वेळ एकच असू शकत नाही'); warn.hidden = true; b.append(warn);
    const ok = this.primary('पुढे', () => { a[st.key] = { off, on }; fx('confirm', this.root); this.next(); });
    const paint = () => {
      const offMin = (on - off + 1440) % 1440;
      $('.off', box).setAttribute('d', arc());
      $('.mid b', box).textContent = offMin === 0 ? '—' : hoursText(1440 - offMin);
      [[hOff, off], [hOn, on]].forEach(([h, m]) => { const [x, y] = pt(m); h.style.left = (x / 284 * 100) + '%'; h.style.top = (y / 284 * 100) + '%'; h.setAttribute('aria-valuenow', String(m)); h.setAttribute('aria-valuetext', clockText(m)); });
      txt.innerHTML = `वीज जाते: <b>${clockText(off)}</b><br>वीज येते: <b>${clockText(on)}</b>`;
      warn.hidden = offMin !== 0; ok.disabled = offMin === 0;
    };
    const fromEvent = (e) => { const r = box.getBoundingClientRect(); const g = Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) + Math.PI / 2; let m = Math.round(((g / (2 * Math.PI) * 1440) + 1440) % 1440 / 30) * 30; return m % 1440; };
    let drag = null;
    [[hOff, 'off'], [hOn, 'on']].forEach(([h, which]) => {
      h.addEventListener('pointerdown', e => { drag = which; try { h.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } e.preventDefault(); });
      h.addEventListener('pointermove', e => { if (drag !== which) return; const m = fromEvent(e); if (which === 'off') off = m; else on = m; paint(); });
      h.addEventListener('pointerup', () => { if (drag === which) { drag = null; fx('choose', this.root); } });
      h.addEventListener('keydown', e => { const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 30 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -30 : 0; if (!d) return; e.preventDefault(); if (which === 'off') off = (off + d + 1440) % 1440; else on = (on + d + 1440) % 1440; paint(); });
    });
    box.addEventListener('pointerdown', e => { if (e.target.closest('.hd')) return; const m = fromEvent(e); const dOff = Math.min(Math.abs(m - off), 1440 - Math.abs(m - off)), dOn = Math.min(Math.abs(m - on), 1440 - Math.abs(m - on)); if (dOff <= dOn) off = m; else on = m; paint(); fx('choose', this.root); });
    this.quiet('रोज वीज जात नाही (२४ तास)', () => { a[st.key] = { none: true }; fx('confirm', this.root); this.next(); }, this.foot);
    paint();
  },

  /* a date: the app's own two choices, then a big day-month-year picker */
  date(st) {
    const a = this.f.ans, b = this.body, today = todayParts();
    b.append(this.ask(st));
    let cur = a[st.key] || {}; let mode = cur.mode || null; let p = cur.date ? { ...cur.date } : { ...today };
    const micHost = el('div'); b.append(micHost);
    const g = el('div', 'tiles c2'); b.append(g);
    const steps = el('div', 'dstep'); b.append(steps);
    const info = el('p', 'helper k'); b.append(info);
    const warn = el('p', 'warn'); warn.hidden = true; b.append(warn);
    const ok = this.primary('पुढे', () => { a[st.key] = { mode, date: mode === 'today' ? today : { ...p } }; fx('confirm', this.root); this.next(); }, true);
    const tiles = [['today', 'आज'], ['earlier', 'आधी केली']].map(([k, t]) => {
      const x = el('button', 'tile'); x.type = 'button'; x.innerHTML = `<span class="t">${t}</span><span class="tick">${ic('check', 16, 3.2)}</span>`;
      x.onclick = () => { const was = mode; mode = k; fx('choose', this.root); if (was !== k) micMount(); paint(); }; g.append(x); return [k, x];
    });
    const col = (label, key) => {
      const c = el('div', 'c'), up = el('button', '', ic('plus', 26, 2.8)), out = el('output'), dn = el('button', '', ic('minus', 26, 2.8));
      up.type = dn.type = 'button'; up.setAttribute('aria-label', label + ' वाढवा'); dn.setAttribute('aria-label', label + ' कमी करा');
      c.append(el('span', '', label), up, out, dn); steps.append(c);
      const bump = (d) => {
        if (key === 'd') p.d = ((p.d - 1 + d + dim(p.y, p.m)) % dim(p.y, p.m)) + 1;
        else if (key === 'm') { p.m = ((p.m - 1 + d + 12) % 12) + 1; p.d = Math.min(p.d, dim(p.y, p.m)); }
        else { p.y += d; p.d = Math.min(p.d, dim(p.y, p.m)); }
        fx('choose', this.root); paint();
      };
      up.onclick = () => bump(1); dn.onclick = () => bump(-1);
      return out;
    };
    const oD = col('दिवस', 'd'), oM = col('महिना', 'm'), oY = col('वर्ष', 'y');
    const micMount = () => { micHost.innerHTML = ''; micHost.append(this.mic(st, { compact: mode === 'earlier' })); };
    const paint = () => {
      tiles.forEach(([k, x]) => { x.classList.toggle('on', mode === k); x.setAttribute('aria-pressed', String(mode === k)); });
      steps.hidden = mode !== 'earlier';
      oD.textContent = dv(p.d); oM.textContent = MONTHS[p.m - 1]; oY.textContent = dv(p.y);
      const chosen = mode === 'today' ? today : (mode === 'earlier' ? p : null);
      let problem = null;
      if (mode === 'earlier') { const n = dayDiff(p, today); if (n < 0) problem = 'आजपर्यंतची तारीख निवडा'; else if (n > 365 * 3) problem = '३ वर्षांपेक्षा जुनी तारीख चालत नाही'; }
      warn.hidden = !problem; warn.textContent = problem || '';
      info.textContent = chosen && !problem ? `आज दिवस ${dv(dayDiff(chosen, today))}` : '';
      info.hidden = !info.textContent;
      ok.disabled = !(mode && !problem);
    };
    micMount(); paint();
  },

  /* pick several (the plots) */
  pick(st) {
    const a = this.f.ans, b = this.body;
    b.append(this.ask(st));
    b.append(this.mic(st, { compact: true }));
    let chosen = new Set(a[st.key] || []);
    const groups = st.groups(a);
    const total = groups.reduce((n, g) => n + g.plots.length, 0);
    const cnt = el('p', 'cnt'); this.foot.append(cnt);
    const ok = this.primary('पुढे', () => { a[st.key] = [...chosen]; fx('confirm', this.root); this.next(); }, true);
    const paint = () => {
      $$('.chips5 button', b).forEach(x => { const on = chosen.has(x.dataset.id); x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
      cnt.textContent = `${dv(total)} पैकी ${dv(chosen.size)} निवडले`; ok.disabled = chosen.size === 0;
    };
    groups.forEach(gr => {
      const s = el('section', 'grp');
      s.innerHTML = `<div class="gh"><img alt="" src="${gr.img}"><div><b>${gr.name}</b><br><span>${dv(gr.plots.length)} प्लॉट</span></div></div>`;
      const grid = el('div', 'chips5');
      gr.plots.forEach(p => { const x = el('button', '', `<span>${p.name}</span><span class="k">${ic('check', 14, 3.4)}</span>`); x.type = 'button'; x.dataset.id = p.id; x.onclick = () => { if (chosen.has(p.id)) chosen.delete(p.id); else chosen.add(p.id); fx('choose', this.root); paint(); }; grid.append(x); });
      s.append(grid);
      if (gr.plots.length >= 7) { const all = el('button', 'allbtn', `सगळे निवडा ${dv(gr.plots.length)}`); all.type = 'button'; all.onclick = () => { gr.plots.forEach(p => chosen.add(p.id)); fx('choose', this.root); paint(); }; s.append(all); }
      b.append(s);
    });
    paint();
  },

  /* a page that is read aloud */
  read(st) {
    const b = this.body;
    if (st.sup) b.append(el('p', 'sup', st.sup));
    if (st.head) b.append(el('h2', 'q', st.head));
    const hear = el('button', 'hear'); hear.type = 'button';
    const label = () => this.reading ? 'थांबवा' : (st.first ? 'सगळं ऐका' : 'ऐका');
    hear.innerHTML = `<span class="ic">${ic('spk', 26, 2.4)}</span><span class="eq"><span class="bars"><i></i><i></i><i></i><i></i></span></span><span class="lb">${label()}</span>`;
    const sweep = el('div', 'sweep', '<i></i>');
    const card = el('div', 'rcard'); card.tabIndex = 0; card.setAttribute('role', 'region'); card.setAttribute('aria-label', st.head || 'सूचना'); st.body(card, this);
    b.append(hear, sweep, card);
    const len = (card.textContent || '').length;
    const dur = Math.max(2000, Math.min(6500, len * 18));
    const stop = () => { this.reading = false; this.autoRead = false; this.clearTimers(); hear.classList.remove('on'); card.classList.remove('playing'); sweep.classList.remove('on'); $('.lb', hear).textContent = label(); };
    const go = () => {
      this.reading = true; hear.classList.add('on'); card.classList.add('playing'); sweep.classList.add('on'); $('.lb', hear).textContent = 'थांबवा';
      const bar = $('i', sweep); bar.style.transition = 'none'; bar.style.width = '0'; void bar.offsetWidth;
      if (!NOFX) { bar.style.transition = `width ${dur}ms linear`; bar.style.width = '100%'; }
      this.after(() => { const more = this.autoRead && this.f.i < this.steps.length - 1 && this.steps[this.f.i + 1].kind === 'read'; this.reading = false; if (more) this.next(); else { stop(); } }, NOFX ? 40 : dur + 200);
    };
    hear.onclick = () => { if (this.reading) { stop(); return; } this.autoRead = !!st.first; fx('arrive', this.root); go(); };
    if (this.autoRead) { this.reading = false; go(); }
    this.primary('पुढे', () => { this.autoRead = false; this.next(); });
    this.quiet('थेट खुणेकडे', () => { const idx = this.steps.findIndex(s => s.kind === 'tick'); this.autoRead = false; if (idx > 0) { this.f.i = idx; this.render(); } });
  },

  /* the one big tick */
  tick(st) {
    const a = this.f.ans, b = this.body;
    b.append(this.ask(st));
    const hear = el('button', 'hear'); hear.type = 'button';
    hear.innerHTML = `<span class="ic">${ic('spk', 26, 2.4)}</span><span class="eq"><span class="bars"><i></i><i></i><i></i><i></i></span></span><span class="lb">ऐका</span>`;
    hear.onclick = () => { hear.classList.add('on'); fx('arrive', this.root); this.after(() => hear.classList.remove('on'), NOFX ? 40 : 3200); };
    b.append(hear);
    const row = el('button', 'tickrow' + (a.ticked ? ' on' : '')); row.type = 'button'; row.setAttribute('role', 'checkbox'); row.setAttribute('aria-checked', String(!!a.ticked));
    row.innerHTML = `<span class="box">${ic('check', 38, 3.4)}</span><span class="tx">${st.sentence}</span>`;
    const hint = el('p', 'helper', st.hint); hint.hidden = !!a.ticked;
    b.append(row, hint, el('p', 'helper', st.meaning));
    const ok = this.primary('पुढे', () => { fx('confirm', this.root); this.next(); }, !a.ticked);
    row.onclick = () => { a.ticked = !a.ticked; row.classList.toggle('on', a.ticked); row.setAttribute('aria-checked', String(!!a.ticked)); hint.hidden = !!a.ticked; ok.disabled = !a.ticked; fx('choose', this.root); };
  },

  /* a phone permission: one per screen */
  perm(st) {
    const a = this.f.ans, b = this.body;
    b.append(this.ask(st));
    b.append(el('div', 'pic-big', `<div class="disc">${ic(st.icon, 64, 1.9)}</div>`));
    b.append(el('p', 'lead', st.line));
    if (st.extra) b.append(el('p', 'helper k', st.extra));
    this.primary(st.yes, () => { a[st.key] = true; fx('confirm', this.root); this.next(); });
    this.quiet(st.no, () => { a[st.key] = false; this.next(); });
  },

  /* "this is what I understood": one sentence and one big yes */
  summary(st) {
    const a = this.f.ans, b = this.body;
    b.append(this.ask(st));
    const s = el('div', 'sum'); s.append(el('p', 'sent', st.sent(a)));
    const ul = el('ul'); st.lines(a).forEach(l => ul.append(el('li', '', l))); s.append(ul); b.append(s);
    this.primary(st.ok, () => { fx('confirm', this.root); this.next(); });
    this.quiet('बदला', () => this.goBack());
  },

  /* the invitation is made: code, QR, link */
  delivery(st) {
    const b = this.body;
    b.append(this.ask(st));
    const box = el('div', 'codebox', `<p class="code">${st.code}</p><p class="once">${st.once}</p>`); b.append(box);
    let qrOn = false;
    const bq = el('button', 'b-prim', ic('qr', 26, 2.2) + 'समोर आहेत — QR दाखवा'); bq.type = 'button';
    const bl = el('button', 'b-sec', ic('link', 26, 2.2) + 'दूर आहेत — लिंक पाठवा'); bl.type = 'button';
    bq.onclick = () => { qrOn = !qrOn; fx('confirm', this.root); let q = $('.qr', box); if (qrOn && !q) { box.insertAdjacentHTML('beforeend', QRART); box.insertAdjacentHTML('beforeend', '<p class="once">नमुना चित्र — खरा QR नाही</p>'); } else if (!qrOn) { $$('.qr, .qr~p', box).forEach(n => n.remove()); } };
    bl.onclick = () => { fx('confirm', this.root); this.toast('लिंक कॉपी केली'); };
    b.append(el('div', 'pair')); $('.pair', b).append(bq, bl);
    this.primary('झालं', () => this.next());
  },

  /* the end of a flow */
  done(st) {
    const b = this.body, a = this.f.ans;
    const d = el('div', 'donebox', `<div class="ring"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div><h2 class="q">${st.head}</h2>`);
    st.lines(a).forEach(l => d.append(el('p', 'lines', l)));
    b.append(d);
    if (st.next) b.append(el('div', 'nextcard', `<b>${st.next.t}</b><span>${st.next.s}</span>`));
    if (this.f.embedded) this.primary('चला', () => this.complete()); else this.primary('पुन्हा करून बघा', () => this.restart());
    fx('done', this.root);
  },

  /* first screen of the sign-in */
  welcome(st) {
    const a = this.f.ans, b = this.body;
    b.append(el('img', 'sathi-big')); $('.sathi-big', b).src = ART('sathi-welcome'); $('.sathi-big', b).alt = '';
    b.append(el('h2', 'q', 'नमस्कार!'));
    b.append(el('p', 'lead k', 'तुमचं शेत, तुमच्या आवाजात'));
    b.append(el('p', 'helper mid', 'मी श्रम साथी. रोज शेतात काय झालं ते मला बोलून सांगा — बाकी हिशोब मी ठेवतो.'));
    const g = el('div', 'tiles c2');
    ['मराठी', 'English'].forEach(t => {
      const x = el('button', 'tile' + ((a.lang || 'मराठी') === t ? ' on' : '')); x.type = 'button'; x.setAttribute('aria-pressed', String((a.lang || 'मराठी') === t));
      x.innerHTML = `<span class="t">${t}</span><span class="tick">${ic('check', 16, 3.2)}</span>`;
      x.onclick = () => { a.lang = t; $$('.tile', g).forEach(y => { const on = y === x; y.classList.toggle('on', on); y.setAttribute('aria-pressed', String(on)); }); note.hidden = t === 'मराठी'; fx('choose', this.root); };
      g.append(x);
    });
    b.append(g);
    const note = el('p', 'helper', 'या नमुन्यात पुढची पानं मराठीतच दिसतील.'); note.hidden = (a.lang || 'मराठी') === 'मराठी'; b.append(note);
    this.primary('सुरू करूया', () => { a.lang = a.lang || 'मराठी'; fx('confirm', this.root); this.next(); });
  },

  /* last screen of the sign-in */
  arrive(st) {
    const b = this.body;
    b.append(el('h2', 'q', 'अभिनंदन!'));
    b.append(el('img', 'arrive-img')); $('.arrive-img', b).src = ART('sathi-welcome'); $('.arrive-img', b).alt = '';
    b.append(el('p', 'lead', 'तुमचं खातं तयार आहे. आता रोज बोलून सांगा — बाकी हिशोब मी ठेवतो.'));
    this.primary('चला, सुरुवात करूया', () => { this.complete(); });
    fx('done', this.root);
  },

  /* stand-in for a screen this page does not draw */
  stub(st) {
    const b = this.body;
    b.append(el('h2', 'q', st.q));
    b.append(el('p', 'helper', st.line));
    this.primary('पुढे चला', () => this.complete());
  },

  /* the road of the setup path */
  road() {
    const R = this.road || (this.road = ROAD.fresh()), b = this.body;
    const stops = ROAD.stops, counted = stops.filter(s => s.counted);
    const nextStop = counted.find(s => !R.done[s.id]);
    const left = counted.filter(s => !R.done[s.id]).length;
    b.append(el('h2', 'q', 'शेत तयार करणं'));
    b.append(el('p', 'left-words', left === 0 ? 'सगळं झालं.' : `आणखी ${NUMW[left]} ${left === 1 ? 'टप्पा' : 'टप्पे'} राहिले.`));
    const wrap = el('div', 'road-wrap'); b.append(wrap);
    let allDone = left === 0;
    stops.forEach(s => {
      const done = !!R.done[s.id], isNext = nextStop && nextStop.id === s.id;
      const row = el('div', 'stop ' + (done ? 'done' : isNext ? 'next' : 'wait'));
      row.append(el('span', 'nd', done ? ic('check', 18, 3.4) : ''));
      if (isNext) {
        const paused = R.paused[s.id];
        const card = el('div', 'bigcard');
        card.append(el('p', 'h', paused ? `इथून पुढे: ${s.title}` : `पुढचं: ${s.title}`));
        card.append(el('p', 'u', paused ? s.resume : s.ask));
        const acts = el('div', 'acts');
        const go = el('button', 'b-prim', paused ? 'पुन्हा सुरू करा' : 'चला'); go.type = 'button'; go.onclick = () => { fx('confirm', this.root); ROAD.open(this, s.id); };
        const spk = el('button', 'spk', ic('spk', 28, 2.2)); spk.type = 'button'; spk.setAttribute('aria-label', 'ऐका');
        spk.onclick = () => { spk.classList.add('on'); fx('arrive', this.root); this.after(() => spk.classList.remove('on'), NOFX ? 40 : 2600); };
        acts.append(go, spk); card.append(acts); row.append(card);
      } else {
        const st = el('div', 'st');
        const tx = el(done ? 'button' : 'div', 'tx'); if (done) { tx.type = 'button'; tx.setAttribute('aria-label', s.title + ' पुन्हा उघडा'); tx.style.cssText = 'text-align:left;background:none;border:0;padding:0;font-family:inherit;cursor:pointer;color:inherit'; tx.onclick = () => ROAD.open(this, s.id, true); }
        tx.innerHTML = `<b>${s.title}${s.soon ? '<span class="chipx">लवकरच</span>' : ''}</b><span>${done ? ROAD.summary(R, s) : (s.soon ? s.line : '')}</span>`;
        st.append(tx);
        if (done) { const spk = el('button', 'spk', ic('spk', 24, 2.2)); spk.type = 'button'; spk.setAttribute('aria-label', 'ऐका'); spk.onclick = () => { spk.classList.add('on'); fx('arrive', this.root); this.after(() => spk.classList.remove('on'), NOFX ? 40 : 2200); }; st.append(spk); }
        row.append(st);
      }
      wrap.append(row);
    });
    if (allDone) { b.append(el('p', 'helper k', 'छान. शेत तयार आहे. आता रोज बोलून सांगा — बाकी हिशोब मी ठेवतो.')); if (!R.fxDone) { R.fxDone = true; fx('done', this.root); } }
  }
};
