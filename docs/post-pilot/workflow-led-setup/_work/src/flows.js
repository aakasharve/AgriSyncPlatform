/* ===== the five flows. R('...') marks a string that is copied word for word from the app's own source
   (the file _work/check-real.js proves each one exists in the repo). Everything else is new draft Marathi. ===== */
const R = (s) => s;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FARMER = 'रामू';                      /* sample name */

/* ---------- 3. sign-in, consent, permissions ---------- */
const readPage = (o) => ({ kind: 'read', en: o.en, sup: o.sup, head: o.head, first: o.first, body(card, P) {
  (o.paras || []).forEach(t => { const p = document.createElement('p'); p.textContent = t; card.append(p); });
  if (o.items) { const ul = document.createElement('ul'); o.items.forEach(t => { const li = document.createElement('li'); li.textContent = t; ul.append(li); }); card.append(ul); }
  (o.links || []).forEach(t => { const b = el('button', 'lnk'); b.type = 'button'; b.textContent = t; b.onclick = () => P.toast('हे कागद इथे उघडतात — या नमुन्यात उघडत नाहीत.'); card.append(b); });
} });
const NOTICE_PAGES = () => {
  const N = NOTICE;
  return [
    readPage({ en: 'Notice: before you begin', head: N.title, paras: [N.intro, N.brandLine], first: true }),
    ...N.cards.map(c => readPage({ en: 'Notice: ' + c.id, sup: N.purposeCardsHeading, head: c.title, paras: [c.data + ' — ' + c.purpose] })),
    readPage({ en: 'Notice: what we will not do', head: N.willNotDo.heading, items: N.willNotDo.items }),
    readPage({ en: 'Notice: service providers', paras: [N.processors] }),
    readPage({ en: 'Notice: your rights (1)', head: N.rights.heading, paras: [N.rights.where], items: N.rights.items }),
    readPage({ en: 'Notice: your rights (2)', head: N.rights.heading, paras: [N.rights.withdrawal, N.rights.boardComplaint] }),
    readPage({ en: 'Notice: who runs this service', head: N.entity.heading, paras: [N.legalName, N.entity.contactLabel + ': ' + N.contact], links: [N.links.terms, N.links.privacy] })
  ];
};
const SIGNIN = {
  id: 'signin',
  steps: () => [
    { kind: 'welcome', en: 'Language and welcome', sample: { lang: 'मराठी' } },
    { kind: 'digits', key: 'phone', len: 10, en: 'Mobile number (voice, or keypad)', q: 'तुमचा मोबाईल नंबर सांगा', helper: R('दहा अंकी मोबाईल नंबर'),
      voice: { say: '९८७६५४३२१०', set: { phone: '9876543210' } }, sample: { phone: '9876543210' } },
    ...NOTICE_PAGES(),
    { kind: 'tick', en: 'The one big tick', q: NOTICE.tick.link, sentence: NOTICE.tick.lead.trim(), hint: NOTICE.ctaDisabledHint, meaning: NOTICE.acceptanceMeaning, sample: { ticked: true } },
    { kind: 'digits', key: 'otp', len: 6, boxes: true, en: 'Code sent to the phone', q: 'तुमच्या नंबरवर आलेला कोड सांगा', helper: 'सहा अंकी कोड.',
      voice: { say: '४ ५ ६ ७ ८ ९', set: { otp: '456789' } }, sample: { otp: '456789' } },
    { kind: 'perm', key: 'pm', icon: 'mic', en: 'Permission: microphone', q: 'मायक्रोफोन चालू करू का?', line: R('बोलून काम सांगण्यासाठी — सगळ्यात महत्त्वाचं'), extra: R('मायक्रोफोन नको असेल तरी हाताने लिहून सगळं करता येतं'), yes: 'हो, चालू करा', no: 'आत्ता नको', sample: { pm: true } },
    { kind: 'perm', key: 'pl', icon: 'pin', en: 'Permission: location', q: 'स्थान चालू करू का?', line: R('तुमच्या गावाचं हवामान दाखवण्यासाठी'), yes: 'हो, चालू करा', no: 'आत्ता नको', sample: { pl: true } },
    { kind: 'perm', key: 'pc', icon: 'cam', en: 'Permission: camera', q: 'कॅमेरा चालू करू का?', line: R('बिल, पिकाचे फोटो आणि QR साठी'), extra: R('तुमची माहिती सुरक्षित आहे — फक्त गरजेपुरतीच वापरतो.'), yes: 'हो, चालू करा', no: 'आत्ता नको', sample: { pc: true } },
    { kind: 'arrive', en: 'Welcome in (the arrival)' }
  ]
};

/* ---------- 4. water and power ---------- */
const W_TYPES = [['Well', R('विहीर')], ['Borewell', R('बोअरवेल')], ['Canal', R('कालवा')], ['Farm Pond', R('शेततळं')], ['Tanker', R('टँकर')]];
const W_NAME = Object.fromEntries(W_TYPES);
const W_OF = { Well: 'विहिरीचं', Borewell: 'बोअरवेलचं', Canal: 'कालव्याचं', 'Farm Pond': 'शेततळ्याचं', Tanker: 'टँकरचं' };
const W_ON = { Well: 'विहिरीवर', Borewell: 'बोअरवेलवर', Canal: 'कालव्यावर', 'Farm Pond': 'शेततळ्यावर', Tanker: 'टँकरवर' };
const PHASE_T = { 1: R('सिंगल फेज'), 3: R('थ्री फेज') };
const POWER_T = { MSEB: R('महावितरण वीज'), Solar: R('सोलर'), Generator: R('डिझेल') };
const hoursOn = (t) => (!t || t.none) ? 24 : (24 - ((t.on - t.off + 1440) % 1440) / 60);
const WATER = {
  id: 'water',
  steps(a) {
    const n = a.motors || 1, S = [];
    S.push({ kind: 'tiles', key: 'type', cols: 3, en: 'Where the water comes from', q: `${FARMER}, तुमच्या शेताला पाणी कुठून येतं?`,
      tiles: W_TYPES.map(([k, t]) => ({ k, t, art: WATERART[k] })), voice: { say: 'विहीर', set: { type: 'Well' } }, sample: { type: 'Well' } });
    const ty = a.type || 'Well';
    S.push({ kind: 'text', key: 'sname', en: 'Name of the source', q: `या ${W_OF[ty]} नाव काय ठेवायचं?`,
      suggest: () => ty === 'Well' ? R('मोठी विहीर') : `${W_NAME[ty]} १`, ph: R('उदा. मोठी विहीर'),
      voice: { say: ty === 'Well' ? 'मोठी विहीर' : `${W_NAME[ty]} १`, set: { sname: ty === 'Well' ? 'मोठी विहीर' : `${W_NAME[ty]} १` } }, sample: { sname: 'मोठी विहीर' } });
    S.push({ kind: 'number', key: 'motors', en: 'How many motors', q: `‘${a.sname || 'मोठी विहीर'}’वर किती मोटर आहेत?`,
      helper: ty === 'Farm Pond' ? R('शेततळ्यावर कितीही मोटर जोडता येतात.') : undefined, def: 1, min: 1, max: (x) => (x.type === 'Farm Pond' ? 12 : 4), step: 1, unit: 'मोटर',
      voice: { say: 'एक मोटर', set: { motors: 1 } }, sample: { motors: 1 } });
    for (let i = 1; i <= n; i++) {
      const lead = n > 1 ? `मोटर ${dv(i)}: ` : '';
      S.push({ kind: 'number', key: 'hp' + i, en: `Motor ${i}: HP`, q: n > 1 ? `मोटर ${dv(i)} किती HP ची आहे?` : 'ही मोटर किती HP ची आहे?', def: 5, min: 0.5, max: 200, step: 0.5, dec: true, unit: 'HP',
        voice: { say: 'पाच HP', set: { ['hp' + i]: 5 } }, sample: { ['hp' + i]: 5 } });
      S.push({ kind: 'text', key: 'mname' + i, en: `Motor ${i}: name`, q: `${lead}या मोटरचं नाव काय ठेवायचं?`, suggest: (x) => `${dv(x['hp' + i] || 5)} HP मोटर`, ph: R('मोटरचं नाव'),
        voice: { say: `${dv(a['hp' + i] || 5)} HP मोटर`, set: { ['mname' + i]: `${dv(a['hp' + i] || 5)} HP मोटर` } }, sample: { ['mname' + i]: `${dv(a['hp' + i] || 5)} HP मोटर` } });
      S.push({ kind: 'tiles', key: 'phase' + i, cols: 2, en: `Motor ${i}: single or three phase`, q: `${lead}ही मोटर सिंगल फेज आहे की थ्री फेज?`,
        tiles: [{ k: 1, t: PHASE_T[1], s: R('घर आणि लहान पंपासाठी'), art: PHASEART[1] }, { k: 3, t: PHASE_T[3], s: R('मोठ्या मोटरसाठी'), art: PHASEART[3] }],
        voice: { say: 'थ्री फेज', set: { ['phase' + i]: 3 } }, sample: { ['phase' + i]: 3 } });
      S.push({ kind: 'tiles', key: 'power' + i, cols: 3, en: `Motor ${i}: where the power comes from`, q: `${lead}ही मोटर कुठल्या विजेवर चालते?`,
        tiles: ['MSEB', 'Solar', 'Generator'].map(k => ({ k, t: POWER_T[k], art: POWERART[k] })),
        voice: { say: 'महावितरण वीज', set: { ['power' + i]: 'MSEB' } }, sample: { ['power' + i]: 'MSEB' } });
      S.push({ kind: 'tiles', key: 'drip' + i, cols: 2, en: `Motor ${i}: drip attached?`, q: `${lead}या मोटरला ठिबक जोडलं आहे का?`,
        tiles: [{ k: 'yes', t: R('हो') }, { k: 'no', t: R('नाही') }], voice: { say: 'नाही', set: { ['drip' + i]: 'no' } }, sample: { ['drip' + i]: 'no' }, sampleAlt: { ['drip' + i]: 'yes' } });
      if (a['drip' + i] === 'yes') {
        S.push({ kind: 'tiles', key: 'pipe' + i, cols: 3, en: `Motor ${i}: pipe size`, q: 'ठिबकच्या नळीचा आकार किती?', helper: R('नळीचा आकार'),
          tiles: ['12mm', '16mm', '20mm'].map(k => ({ k, t: `${dv(k.replace('mm', ''))} मिमी` })), voice: { say: '१६ मिमी', set: { ['pipe' + i]: '16mm' } }, sample: { ['pipe' + i]: '16mm' } });
        S.push({ kind: 'tiles', key: 'filt' + i, cols: 2, en: `Motor ${i}: filter`, q: 'फिल्टर आहे का?', tiles: [{ k: 'yes', t: R('फिल्टर आहे') }, { k: 'no', t: R('फिल्टर नाही') }],
          voice: { say: 'फिल्टर आहे', set: { ['filt' + i]: 'yes' } }, sample: { ['filt' + i]: 'yes' } });
        S.push({ kind: 'number', key: 'flow' + i, en: `Motor ${i}: water per hour`, q: 'ठिबकमधून तासाला किती लिटर पाणी जातं?', helper: R('पाणी (लिटर / तास)'), def: null, min: 1, max: 999999, step: 500, unit: 'लिटर / तास', skip: 'माहीत नाही — पुढे',
          voice: { say: 'आठ हजार लिटर', set: { ['flow' + i]: 8000 } }, sample: { ['flow' + i]: 8000 } });
      }
    }
    const phases = [];
    for (let i = 1; i <= n; i++) { const p = a['phase' + i]; if (p && !phases.includes(p)) phases.push(p); }
    (phases.length ? phases : [3]).forEach(p => S.push({ kind: 'dial', key: 't_' + p, en: `Power timetable: ${PHASE_T[p]}`, q: `${PHASE_T[p]} ${R('वीज रोज कधी जाते?')}`,
      voice: { say: 'दुपारी बारा ते तीन वीज जाते', set: { ['t_' + p]: { off: 720, on: 900 } } }, sample: { ['t_' + p]: { off: 720, on: 900 } } }));
    const when = (x) => { const ps = []; for (let i = 1; i <= (x.motors || 1); i++) { const p = x['phase' + i]; if (p && !ps.includes(p)) ps.push(p); } return (ps.length ? ps : [3]).map(p => ({ p, h: hoursOn(x['t_' + p]) })); };
    S.push({ kind: 'summary', en: 'What I understood', q: 'हे बरोबर आहे का?', ok: 'बरोबर',
      sent: (x) => { const w = when(x); return `${x.sname}, ${W_NAME[x.type || 'Well']}, ${dv(x.motors || 1)} मोटर, ` + (w.length === 1 ? `वीज रोज ${dv(w[0].h)} तास` : w.map(y => `${PHASE_T[y.p]} वीज रोज ${dv(y.h)} तास`).join(', ')); },
      lines: (x) => { const L = []; for (let i = 1; i <= (x.motors || 1); i++) L.push(`${x['mname' + i]} — ${dv(x['hp' + i])} HP · ${PHASE_T[x['phase' + i]]} · ${POWER_T[x['power' + i]]}${x['drip' + i] === 'yes' ? ' · ठिबक' : ''}`); return L; } });
    S.push({ kind: 'done', en: 'Done', head: 'छान.', lines: (x) => [`पाण्याचा स्रोत तयार आहे: ${x.sname}.`, `${dv(x.motors || 1)} मोटर, वीज रोज ${dv(when(x)[0].h)} तास.`], next: { t: 'पुढचं: यंत्रं', s: 'तुमची यंत्रं — एक एक करून विचारतो.' } });
    return S;
  }
};

/* ---------- 5. crops and plots ---------- */
const CROPS = [['Grapes', R('द्राक्ष'), 'grapes', 'द्राक्षाचं', 'छाटणी'], ['Sugarcane', R('ऊस'), 'sugarcane', 'उसाचं', 'लागवड'], ['Onion', R('कांदा'), 'onion', 'कांद्याचं', 'लागवड'],
  ['Pomegranate', R('डाळिंब'), 'pomegranate', 'डाळिंबाचं', 'लागवड'], ['Tomato', R('टोमॅटो'), 'tomato', 'टोमॅटोचं', 'लागवड'], ['Wheat', R('गहू'), 'wheat', 'गव्हाचं', 'पेरणी']];
const VARIETIES = { Grapes: ['Super Sonaka', 'Sharad Seedless', 'Thompson Seedless', 'Crimson Seedless', 'Flame Seedless', 'Manik Chaman', 'Other'], Pomegranate: ['Bhagwa', 'Ganesh', 'Mridula', 'Arakta', 'Other'], Tomato: ['Abhinav', 'Shivam', 'Arka Rakshak', 'Other'], Onion: ['Nashik Red', 'Puna Fursungi', 'N-53', 'Other'] };
const varietiesOf = (crop) => VARIETIES[crop] || ['Local', 'Hybrid', 'Other'];
const SAMPLE_START = shiftDays(-32);
const PLOTS = {
  id: 'plots',
  steps(a) {
    const S = [], cr = CROPS.find(c => c[0] === (a.crop || 'Grapes')), vs = varietiesOf(cr[0]);
    S.push({ kind: 'tiles', key: 'crop', cols: 3, en: 'Which crop', q: `${FARMER}, कोणतं पीक लावलं?`, tiles: CROPS.map(c => ({ k: c[0], t: c[1], img: ART(c[2]) })), voice: { say: 'द्राक्ष', set: { crop: 'Grapes' } }, sample: { crop: 'Grapes' } });
    S.push({ kind: 'tiles', key: 'variety', cols: 2, en: 'Variety', q: `${cr[3]} वाण कोणतं?`, tiles: vs.map(v => ({ k: v, t: v === 'Other' ? R('अन्य') : v })),
      voice: { say: vs[0], set: { variety: vs[0] } }, sample: { variety: vs[0] } });
    if (a.variety === 'Other') S.push({ kind: 'text', key: 'ownvar', en: 'Variety, in his own words', q: R('वाणाचं नाव लिहा'), ph: R('वाणाचं नाव लिहा'), voice: { say: 'सोनाका', set: { ownvar: 'सोनाका' } }, sample: { ownvar: 'सोनाका' } });
    const vname = a.variety === 'Other' ? (a.ownvar || '') : (a.variety || vs[0]);
    const sug = `${vname} ${dv(1)}`.trim();
    S.push({ kind: 'text', key: 'pname', en: 'Name of the plot (his own)', q: 'या प्लॉटचं नाव काय ठेवायचं?', suggest: () => sug, note: 'प्लॉटचं नाव तुमचंच असतं. हवं ते ठेवा.', ph: R('प्लॉटचं नाव लिहा'),
      voice: { say: sug, set: { pname: sug } }, sample: { pname: sug } });
    const pn = a.pname || sug;
    S.push({ kind: 'number', key: 'area', en: 'Area', q: `${pn} चं क्षेत्र किती?`, def: null, min: 0.01, max: 9999, step: 0.25, dec: true,
      units: [{ k: 'Acre', t: R('एकर') }, { k: 'Guntha', t: R('गुंठा') }], unitKey: 'unit', voice: { say: 'दीड एकर', set: { area: 1.5, unit: 'Acre' } }, sample: { area: 1.5, unit: 'Acre' } });
    S.push({ kind: 'tiles', key: 'material', cols: 2, en: 'Seed or saplings', q: R('तुम्ही काय लावलं?'), tiles: [{ k: 'Seed', t: R('बियाणं') }, { k: 'Nursery', t: R('रोपं') }],
      voice: { say: 'रोपं', set: { material: 'Nursery' } }, sample: { material: 'Nursery' }, sampleAlt: { material: 'Seed' } });
    const seed = a.material === 'Seed' || (ALT && !a.material);
    const canSkip = vname.trim().length > 0;
    if (seed) {
      S.push({ kind: 'text', key: 'company', en: 'Seed company', q: 'बियाणं कोणत्या कंपनीचं?', ph: R('उदा. महाबीज'), skip: canSkip ? 'नाव माहीत नाही — पुढे' : undefined, voice: { say: 'महाबीज', set: { company: 'महाबीज' } }, sample: { company: 'महाबीज' } });
      S.push({ kind: 'number', key: 'qty', en: 'Seed per acre', q: 'एकरी किती बियाणं लावलं?', def: null, min: 0.01, max: 99999, step: 0.5, dec: true,
        units: [{ k: 'kg', t: R('किलो') }, { k: 'gm', t: R('ग्रॅम') }, { k: 'Packets', t: R('पाकीट') }], unitKey: 'qunit', voice: { say: 'दोन किलो', set: { qty: 2, qunit: 'kg' } }, sample: { qty: 2, qunit: 'kg' } });
    } else {
      S.push({ kind: 'text', key: 'nursery', en: 'Nursery name', q: 'रोपं कोणत्या रोपवाटिकेतून आणली?', ph: R('उदा. नाशिक रोपवाटिका'), skip: canSkip ? 'नाव माहीत नाही — पुढे' : undefined, voice: { say: 'नाशिक रोपवाटिका', set: { nursery: 'नाशिक रोपवाटिका' } }, sample: { nursery: 'नाशिक रोपवाटिका' } });
      S.push({ kind: 'number', key: 'age', en: 'Age of the plants', q: R('रोप किती दिवसांचं होतं'), helper: undefined, def: null, min: 1, max: 9999, step: 1, unit: 'दिवस', voice: { say: 'पंचेचाळीस दिवस', set: { age: 45 } }, sample: { age: 45 } });
    }
    S.push({ kind: 'date', key: 'start', en: 'The date it was done', q: `${pn} ची ${cr[4]} केव्हा केली?`, voice: { say: dateWords(SAMPLE_START), set: { start: { mode: 'earlier', date: SAMPLE_START } } }, sample: { start: { mode: 'earlier', date: SAMPLE_START } } });
    const mat = (x) => (x.material === 'Seed' || (ALT && !x.material)) ? `बियाणं${x.company ? ' · ' + x.company : ''} · एकरी ${dv(x.qty)} ${x.qunit === 'gm' ? 'ग्रॅम' : x.qunit === 'Packets' ? 'पाकीट' : 'किलो'}` : `रोपं${x.nursery ? ' · ' + x.nursery : ''} · ${dv(x.age)} दिवसांचं`;
    S.push({ kind: 'summary', en: 'What I understood', q: 'हे बरोबर आहे का?', ok: 'जतन करा',
      sent: (x) => `${x.pname || pn}, ${cr[1]}, ${dv(x.area)} ${x.unit === 'Guntha' ? 'गुंठा' : 'एकर'}`,
      lines: (x) => { const d = x.start && x.start.date; return [`पीक: ${cr[1]} · ${x.variety === 'Other' ? x.ownvar : x.variety}`, `लावलं: ${mat(x)}`, `${cr[4]}: ${dateWords(d)} (आज दिवस ${dv(dayDiff(d, todayParts()))})`]; } });
    S.push({ kind: 'done', en: 'Done', head: 'छान.', lines: (x) => [`${x.pname || pn} तयार आहे.`, `${cr[1]} · ${dv(x.area)} ${x.unit === 'Guntha' ? 'गुंठा' : 'एकर'}`], next: { t: 'पुढचं: पाणी आणि वीज', s: 'तुमच्या पाण्याचे स्रोत आणि मोटर — एक एक करून विचारतो.' } });
    return S;
  }
};

/* ---------- 6. inviting someone ---------- */
const ROLES = [
  ['CoOwner', R('सहमालक'), ['शेताची रचना बदलू शकतात', 'हजेरी घेऊ शकतात', 'नोंदी पक्क्या करू शकतात', 'पैसे दिसतात'], 'AllPlots'],
  ['Family', R('कुटुंब'), ['हजेरी घेऊ शकतात', 'नोंदी पक्क्या करू शकतात'], 'AllPlots'],
  ['Mukadam', R('मुकादम'), ['हजेरी घेऊ शकतात'], 'AllPlots'],
  ['Worker', R('कामगार'), [], 'OwnWork']
];
const SCOPE_T = { AllPlots: [R('सर्व प्लॉट'), R('शेतातल्या सगळ्या प्लॉटचं काम दिसेल.')], ChosenPlots: [R('निवडलेले प्लॉट'), R('फक्त निवडलेल्या प्लॉटचं काम दिसेल व नोंदवता येईल.')], OwnWork: [R('स्वतःचं काम'), R('कोणत्याही प्लॉटवर स्वतःचं काम नोंदवतील; इतरांचं काम दिसणार नाही.')] };
const GROUPS = () => [
  { name: R('द्राक्ष'), img: ART('grapes'), plots: Array.from({ length: 15 }, (_, i) => ({ id: 'g' + (i + 1), name: 'G' + (i + 1) })) },
  { name: R('ऊस'), img: ART('sugarcane'), plots: Array.from({ length: 3 }, (_, i) => ({ id: 's' + (i + 1), name: 'S' + (i + 1) })) }
];
const inviteLines = (a) => {
  const role = ROLES.find(r => r[0] === (a.who || 'Mukadam')), scope = a.scope || role[3], own = role[0] === 'Worker' || scope === 'OwnWork';
  const names = (a.plots || []).map(id => { const p = GROUPS().flatMap(g => g.plots).find(x => x.id === id); return p ? p.name : id; });
  const plots = scope === 'AllPlots' ? R('सर्व प्लॉट') : scope === 'OwnWork' ? R('स्वतःचं काम') : (names.length >= 4 ? `${dv(names.length)} प्लॉट` : names.join(', '));
  const can = role[2].filter(c => !(scope !== 'AllPlots' && c === 'शेताची रचना बदलू शकतात') && !(own && c === 'पैसे दिसतात'));
  const sees = !own && (a.money ? a.money === 'yes' : role[0] === 'CoOwner');
  if (sees && !can.includes('पैसे दिसतात')) can.push('पैसे दिसतात');
  const parts = [`जबाबदारी: ${role[1]}`, scope === 'OwnWork' ? plots : `प्लॉट: ${plots}`, ...can];
  if (!sees) parts.push(R('पैसे दिसत नाहीत'));
  return { parts, can, sees };
};
const INVITE = {
  id: 'invite',
  steps(a) {
    const S = [], role = ROLES.find(r => r[0] === (a.who || 'Mukadam')), worker = a.who === 'Worker';
    S.push({ kind: 'tiles', key: 'who', cols: 1, row: true, micCompact: true, en: 'Who is being invited', q: `${FARMER}, कोणाला बोलवायचं?`,
      tiles: ROLES.map(r => ({ k: r[0], t: r[1], s: r[2].concat(r[0] === 'Worker' ? [R('स्वतःचं काम')] : []).concat(r[2].includes('पैसे दिसतात') ? [] : [R('पैसे दिसत नाहीत')]).join(' · ') })),
      onPick: (t, x) => { const r = ROLES.find(y => y[0] === t.k); x.scope = r[3]; x.money = t.k === 'CoOwner' ? 'yes' : 'no'; x.plots = []; },
      voice: { say: 'मुकादम', set: { who: 'Mukadam', scope: 'AllPlots', money: 'no', plots: [] } }, sample: { who: 'Mukadam', scope: 'AllPlots', money: 'no', plots: [] } });
    S.push({ kind: 'tiles', key: 'scope', cols: 1, row: true, en: 'Which plots they see', q: 'कोणते प्लॉट दिसावेत?', note: worker ? R('कामगार म्हणून फक्त स्वतःचं काम दिसतं. प्लॉट निवडले तर फक्त त्या प्लॉटवर नोंद करता येईल.') : undefined,
      tiles: (worker ? ['ChosenPlots', 'OwnWork'] : ['AllPlots', 'ChosenPlots', 'OwnWork']).map(k => ({ k, t: SCOPE_T[k][0], s: SCOPE_T[k][1] })),
      voice: { say: 'निवडलेले प्लॉट', set: { scope: 'ChosenPlots' } }, sample: { scope: 'ChosenPlots' } });
    if (a.scope === 'ChosenPlots') S.push({ kind: 'pick', key: 'plots', en: 'Pick the plots', q: R('कोणते प्लॉट?'), groups: GROUPS, voice: { say: 'द्राक्ष: G1, G2, G3', set: { plots: ['g1', 'g2', 'g3'] } }, sample: { plots: ['g1', 'g2', 'g3'] } });
    if (!(worker || a.scope === 'OwnWork')) S.push({ kind: 'tiles', key: 'money', cols: 2, en: 'Can they see money (a permission)', q: 'त्यांना पैसे दिसावेत का?', tiles: [{ k: 'yes', t: R('हो') }, { k: 'no', t: R('नाही') }], voice: { say: 'नाही', set: { money: 'no' } }, sample: { money: 'no' } });
    S.push({ kind: 'text', key: 'iname', en: 'Name (optional)', q: 'त्यांचं नाव काय?', helper: R('नाव (हवं तर)'), ph: R('नाव (हवं तर)'), skip: 'नाव नको — पुढे', voice: { say: 'सुरेश', set: { iname: 'सुरेश' } }, sample: { iname: 'सुरेश' } });
    S.push({ kind: 'digits', key: 'imobile', len: 10, warnShort: true, en: 'Mobile number (optional)', q: 'त्यांचा मोबाईल नंबर?', helper: R('नंबर दिला तर तोच माणूस स्वीकारताच आत येईल. नंबर नसेल तर तो स्वीकारल्यावर तुम्ही मंजूर करा.'), skip: 'नंबर नको — पुढे',
      voice: { say: '९८७६५४३२१०', set: { imobile: '9876543210' } }, sample: { imobile: '9876543210' } });
    S.push({ kind: 'tiles', key: 'worker', cols: 1, row: true, micCompact: true, en: 'Worker from the attendance list (optional)', q: 'हे हजेरी यादीतले कोण आहेत का?', helper: R('हजेरी यादीतले कामगार (हवं तर)'),
      tiles: [{ k: 'ramesh', t: 'रमेश' }, { k: 'ganesh', t: 'गणेश' }, { k: 'datta', t: 'दत्ता' }, { k: 'none', t: R('कोणी नाही') }],
      voice: { say: 'कोणी नाही', set: { worker: 'none' } }, sample: { worker: 'none' } });
    S.push({ kind: 'summary', en: 'What I understood', q: 'हे बरोबर आहे का?', ok: R('आमंत्रण तयार करा'),
      sent: (x) => inviteLines(x).parts.join(' · '),
      lines: (x) => { const L = []; if (x.iname) L.push(`नाव: ${x.iname}`); if (x.imobile) L.push(`मोबाईल नंबर: ${dv(x.imobile)}`); const w = { ramesh: 'रमेश', ganesh: 'गणेश', datta: 'दत्ता' }[x.worker]; if (w) L.push(`हजेरी यादीतले कामगार: ${w}`); return L.length ? L : ['नाव आणि नंबर दिलेला नाही']; } });
    const exp = shiftDays(7);
    S.push({ kind: 'delivery', en: 'The invitation: QR or link', q: 'आमंत्रण तयार आहे', code: '१२३४-५६७८', once: `एकदाच वापरता येईल · ${dv(exp.d)} ${MONTHS[exp.m - 1]}पर्यंत` });
    S.push({ kind: 'done', en: 'Done', head: 'छान.', lines: (x) => [`${x.iname || 'ही व्यक्ती'}: ${R('वाट पाहत आहे')}.`],
      next: { t: 'पुढचं: ते स्वीकारण्याची वाट', s: (a.imobile ? R('नंबर दिला तर तोच माणूस स्वीकारताच आत येईल.') : R('नंबर नसेल तर तो स्वीकारल्यावर तुम्ही मंजूर करा.')) } });
    return S;
  }
};

/* ---------- 2. the setup path (the hub as a road) ---------- */
const STUB = (id) => ({ id: 'stub-' + id, steps: () => [{ kind: 'stub', q: 'यंत्रं', line: 'हे पान या नमुन्यात दाखवलेलं नाही. इथेही असेच प्रश्न एक एक करून येतील.' }] });
const ROAD = {
  stops: [
    { id: 'id', title: R('माझी ओळख'), sum: R('नाव आणि गाव भरलं'), counted: true },
    { id: 'plots', title: R('पिकं आणि प्लॉट'), sum: '२ पिकं · १८ प्लॉट', ask: 'तुमचं पीक आणि प्लॉट — एक एक करून विचारतो.', resume: 'तुम्ही मध्येच थांबला होतात. तिथूनच पुढे सुरू करूया.', counted: true },
    { id: 'water', title: R('पाणी आणि वीज'), sum: '४ स्रोत · ४ मोटर · विजेच्या वेळा', ask: 'तुमच्या पाण्याचे स्रोत आणि मोटर — एक एक करून विचारतो.', resume: 'तुम्ही मोटरपर्यंत आला होतात. तिथूनच पुढे सुरू करूया.', counted: true },
    { id: 'machines', title: R('यंत्रं'), sum: '४ यंत्रं', ask: 'तुमची यंत्रं — एक एक करून विचारतो.', resume: 'तुम्ही मध्येच थांबला होतात. तिथूनच पुढे सुरू करूया.', counted: true },
    { id: 'soil', title: R('माती व पाणी अहवाल'), soon: true, line: R('अहवाल जोडण्याची सोय अजून नाही') }
  ],
  fresh() { return { done: { id: 1, plots: 1 }, paused: {} }; },
  sample(s) {
    const r = ROAD.fresh();
    if (s >= 2 && s < 3) { const f = sampleTo(WATER, 5); r.paused.water = { def: WATER, ans: f.ans, i: f.i, embedded: true }; }
    if (s >= 3) r.done.water = 1, r.waterN = 1;
    if (s >= 4) r.done.machines = 1, r.fxDone = true;
    return r;
  },
  summary(r, s) { return s.id === 'water' && r.waterN ? `${dv(1)} स्रोत · ${dv(r.waterN)} मोटर · विजेच्या वेळा` : s.sum; },
  open(P, id, again) {
    const r = P.road;
    const onExit = (reason, fr) => {
      if (reason === 'done') { r.done[id] = 1; delete r.paused[id]; if (id === 'water') r.waterN = fr.ans.motors || 1; }
      else if (!r.done[id] && fr.i > 0) r.paused[id] = fr;
    };
    if (r.paused[id] && !again) { const fr = r.paused[id]; delete r.paused[id]; fr.onExit = onExit; P.stack.push(fr); P.render(); return; }
    const def = id === 'water' ? WATER : id === 'plots' ? PLOTS : STUB(id);
    P.enter(def, { embedded: true, onExit });
  }
};
const PATH = {
  id: 'path', N: 4,
  steps: () => [{ kind: 'road', en: 'The road' }],
  reset(P) { P.road = ROAD.fresh(); },
  progress(P) { const r = P.road || ROAD.fresh(); return ROAD.stops.filter(s => s.counted && r.done[s.id]).length / 4; },
  listing(P) {
    const r = P.road || ROAD.fresh(); const idx = (r.done.machines) ? 3 : (r.done.water ? 2 : (r.paused.water ? 1 : 0));
    return { names: ['The road, two stops done', 'Left halfway, ready to resume', 'Three stops done', 'All done'], idx, mode: 'state' };
  }
};

const FLOWS = { path: PATH, signin: SIGNIN, water: WATER, plots: PLOTS, invite: INVITE };

/* the same sample answers every hook uses */
function sampleTo(def, s) {
  const ans = {}; let i = 0;
  while (i < s - 1) { const st = def.steps(ans)[i]; if (!st) break; Object.assign(ans, (ALT && st.sampleAlt) ? st.sampleAlt : (st.sample || {})); i++; }
  return { ans, i: Math.min(i, def.steps(ans).length - 1) };
}
function countSteps(def) {
  if (def.N) return def.N;
  const ans = {}; let i = 0;
  for (;;) { const st = def.steps(ans)[i]; if (!st) break; Object.assign(ans, (ALT && st.sampleAlt) ? st.sampleAlt : (st.sample || {})); i++; }
  return i;
}
