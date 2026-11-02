/* Shram Safal website preview: language, menu, and the interactive explanations.
   Every text is authored in both languages; L() renders both, CSS shows one. */
(function () {
  "use strict";
  var doc = document.documentElement;
  // The script loads after the first paint (defer). What is already on screen stays visible, so nothing flashes.
  Array.prototype.forEach.call(document.querySelectorAll(".rv"), function (el) { if (el.getBoundingClientRect().top < innerHeight) el.classList.add("in"); });
  doc.classList.add("js");
  // Where assets live, worked out from this script's own address (pages sit at different depths).
  var ASSET = (function () { var c = document.currentScript; return c && c.src ? c.src.replace(/js\/site\.js(\?.*)?$/, "") : "assets/"; })();

  // Each page is in one language (Marathi at /, English at /en/), so script-drawn text is written in that language only:
  // search engines then never see hidden text in the other language.
  var PL = document.documentElement.classList.contains("lang-en") ? "en" : "mr";
  function L(mr, en) { return '<span class="' + PL + '">' + (PL === "en" ? en : mr) + "</span>"; }
  function T(o) { return L(o.mr, o.en); }
  function I(name, cls) { return '<svg class="ic ' + (cls || "") + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  // Motion: on the live site the phone's "reduce motion" setting decides. In the preview it is on
  // by default (so the cinematic layer can be judged on any PC); a visitor can switch it either way.
  var osReduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var motionPref = null;
  try { motionPref = localStorage.getItem("ss-motion"); } catch (e) { motionPref = null; }
  var isPreview = !!document.querySelector(".preview-bar");
  var reduce = motionPref === "on" ? false : motionPref === "off" ? true : (isPreview ? false : osReduce);
  doc.classList.add(reduce ? "still" : "motion");

  /* ---------- Icon sprite (decorative; content never depends on it) ---------- */
  var P = {
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/>',
    drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2c2.8.2 5 2.6 5 5.8"/>',
    spray: '<path d="M8 9h6v12H8zM10 9V6h2v3M15 12h2M18 10l2.5-1.5M18 12h3M18 14l2.5 1.5"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    rupee: '<path d="M7 5h10M7 9h10M7 5c5 0 7 1.5 7 4s-2 4-7 4l7 7"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    checkc: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16.5 9.5"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    cloud: '<path d="M7 18h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 18z"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/>',
    book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z"/><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6"/>',
    missed: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/><path d="M15 3l5 5M20 3l-5 5"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"/><path d="M9 8h6M9 12h6"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    network: '<circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M6.5 6.5l3.2 3.2M17.5 6.5l-3.2 3.2M6.5 17.5l3.2-3.2M17.5 17.5l-3.2-3.2"/>',
    leaf: '<path d="M5 19C5 10 11 5 20 4c0 9-5 15-14 15z"/><path d="M5 19l8-8"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9z"/>',
    scale: '<path d="M12 4v16M7 20h10M5 8h14M5 8l-3 6a3 3 0 0 0 6 0L5 8zM19 8l-3 6a3 3 0 0 0 6 0l-3-6z"/>',
    clip: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9zM9 12.5l2 2 4-4"/>',
    qr: '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/>',
    play: '<path d="M8 5l11 7-11 7V5z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    replay: '<path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6"/><path d="M4 4v4.6h4.6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    gplay: '<path d="M5 3.5v17l9.5-8.5L5 3.5z"/><path d="M5 3.5l12.5 7a1.7 1.7 0 0 1 0 3L5 20.5"/>',
    chat: '<path d="M4 5h16v11H9l-5 4V5z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    plot: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6z"/><path d="M9 4v14M15 6v14"/>',
    box: '<path d="M3 8l9-5 9 5v8l-9 5-9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    alert: '<path d="M12 3l9.5 17h-19L12 3z"/><path d="M12 10v4M12 17h.01"/>',
    sprout: '<path d="M12 21v-9M12 12c0-4-3-6-7-6 0 4 3 6 7 6zM12 14c0-3.5 2.5-6 7-6 0 3.5-2.5 6-7 6z"/>',
    building: '<path d="M4 21V5l8-2v18M12 7l8 2v12M8 8h.01M8 12h.01M8 16h.01M16 12h.01M16 16h.01M2 21h20"/>',
    hand: '<path d="M7 11V6a1.5 1.5 0 0 1 3 0v4M10 10V4.5a1.5 1.5 0 0 1 3 0V10M13 10V5.5a1.5 1.5 0 0 1 3 0V12M16 9.5a1.5 1.5 0 0 1 3 0V14c0 4-3 7-7 7-3 0-4.5-1.5-6-4l-2.3-3.7a1.5 1.5 0 0 1 2.6-1.5L7 13"/>',
    satellite: '<path d="M8.5 8.5l7 7M6 11l5-5 3 3-5 5zM13 17l4-4 3 3-4 4zM4 13l3 3M13 4l3 3"/><path d="M15 9l2-2"/>',
    umbrella: '<path d="M3 12a9 9 0 0 1 18 0H3z"/><path d="M12 12v6.5a2 2 0 0 1-4 0"/>',
    truck: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
    bug: '<path d="M8 9a4 4 0 0 1 8 0v5a4 4 0 0 1-8 0V9zM4 11h4M16 11h4M4 16h4M16 16h4M9.5 4.5L11 6M14.5 4.5L13 6"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>'
  };
  (function sprite() {
    var s = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">';
    Object.keys(P).forEach(function (k) { s += '<symbol id="i-' + k + '" viewBox="0 0 24 24">' + P[k] + "</symbol>"; });
    s += "</svg>";
    var d = document.createElement("div");
    d.innerHTML = s;
    document.body.insertBefore(d.firstChild, document.body.firstChild);
  })();

  /* ---------- Language ---------- */
  function setLang(lang, save) {
    doc.classList.remove("lang-mr", "lang-en");
    doc.classList.add("lang-" + lang);
    doc.setAttribute("lang", lang);
    var t = doc.getAttribute("data-title-" + lang);
    if (t) document.title = t;
    $$("[data-lang]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-lang") === lang)); });
    if (save) { try { localStorage.setItem("ss-lang", lang); } catch (e) { /* storage blocked: fine */ } }
  }
  // Each built page has a real Marathi address and a real English twin (data-alt-mr / data-alt-en):
  // switching language goes to the twin page, so search engines see one clean language per address.
  var pageLang = doc.classList.contains("lang-en") ? "en" : "mr";
  function altUrl(lang) { return doc.getAttribute("data-alt-" + lang); }
  var saved = null;
  try { saved = localStorage.getItem("ss-lang"); } catch (e) { saved = null; }
  if (saved === "en" && pageLang === "mr" && altUrl("en")) location.replace(altUrl("en") + location.search + location.hash);
  setLang(pageLang, false);
  $$("[data-lang]").forEach(function (b) {
    b.addEventListener("click", function () {
      var to = b.getAttribute("data-lang");
      try { localStorage.setItem("ss-lang", to); } catch (e) { /* storage blocked */ }
      if (to !== pageLang && altUrl(to)) { location.href = altUrl(to) + location.search + location.hash; return; }
      setLang(to, true);
    });
  });
  $$("[data-en-value]").forEach(function (el) { if (pageLang === "en") el.value = el.getAttribute("data-en-value"); });

  /* ---------- Preview notes toggle ---------- */
  $$("[data-toggle-notes]").forEach(function (b) {
    b.addEventListener("click", function () {
      var hidden = doc.classList.toggle("hide-notes");
      b.innerHTML = hidden ? L("टीपा दाखवा", "Show notes") : L("टीपा लपवा", "Hide notes");
    });
  });

  /* ---------- Header: current page + mobile menu ---------- */
  var page = (location.pathname.split("/").pop() || "index.html").replace(".html", "") || "index";
  $$(".nav a, .mobile-nav a").forEach(function (a) {
    var href = (a.getAttribute("href") || "").split("#")[0].replace(".html", "");
    if (href && href === page && page !== "index") a.setAttribute("aria-current", "page");
  });
  var menuBtn = $(".menu-btn"), mnav = $(".mobile-nav");
  if (menuBtn && mnav) {
    menuBtn.addEventListener("click", function () {
      var open = mnav.classList.toggle("open");
      menuBtn.setAttribute("aria-expanded", String(open));
      menuBtn.innerHTML = I(open ? "x" : "menu");
    });
    $$("a", mnav).forEach(function (a) { a.addEventListener("click", function () { mnav.classList.remove("open"); menuBtn.setAttribute("aria-expanded", "false"); menuBtn.innerHTML = I("menu"); }); });
  }

  /* ---------- Reveal on scroll ---------- */
  var rv = $$(".rv");
  if ("IntersectionObserver" in window && !reduce) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -8% 0px" });
    rv.forEach(function (el) { io.observe(el); });
  } else { rv.forEach(function (el) { el.classList.add("in"); }); }

  /* ---------- Hero waveform: plays once as a cue (no sound, no microphone) ---------- */
  $$(".wave").forEach(function (w) {
    var n = +w.getAttribute("data-bars") || 22, h = "";
    for (var i = 0; i < n; i++) h += "<i></i>";
    w.innerHTML = h;
    var bars = $$("i", w), ticks = 0;
    if (reduce) { bars.forEach(function (b, i) { b.style.height = (30 + 50 * Math.abs(Math.sin(i * 0.7))) + "%"; }); return; }
    var id = setInterval(function () {
      ticks++;
      bars.forEach(function (b, i) { b.style.height = (18 + Math.random() * 82 * Math.abs(Math.sin((i + ticks) * 0.45))) + "%"; });
      if (ticks > 22) { clearInterval(id); bars.forEach(function (b, i) { b.style.height = (24 + 40 * Math.abs(Math.sin(i * 0.6))) + "%"; }); }
    }, 110);
  });

  /* ---------- Problem: before / after ---------- */
  $$("[data-ba]").forEach(function (root) {
    var tabs = $$("[data-ba-tab]", root), panels = $$("[data-ba-panel]", root);
    tabs.forEach(function (t) {
      t.addEventListener("click", function () {
        var k = t.getAttribute("data-ba-tab");
        tabs.forEach(function (x) { x.setAttribute("aria-selected", String(x === t)); });
        panels.forEach(function (p) { p.hidden = p.getAttribute("data-ba-panel") !== k; });
      });
    });
  });

  /* ---------- Value timeline ---------- */
  $$("[data-vt]").forEach(function (root) {
    var tabs = $$("[data-vt-tab]", root), panels = $$("[data-vt-panel]", root), grow = $(".grow", root), dots = $$(".vt-dots span", root);
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () {
        tabs.forEach(function (x) { x.setAttribute("aria-selected", String(x === t)); });
        panels.forEach(function (p, j) { p.hidden = j !== i; });
        if (grow) grow.style.width = (i === 0 ? 33 : i === 1 ? 66 : 100) + "%";
        dots.forEach(function (d, j) { d.classList.toggle("on", j <= i); });
      });
    });
    autoCycle(root, tabs.length, function (i) { tabs[i].click(); }, 4200, function () {
      return tabs.findIndex(function (t) { return t.getAttribute("aria-selected") === "true"; });
    });
  });

  /* ---------- Signature: voice → organised records ---------- */
  var demo = $("[data-demo]");
  if (demo) whenNear(demo, function () {
    var words = {
      mr: ["आज", "द्राक्षाच्या", "दोन", "नंबर", "प्लॉटला", "पाणी", "दिलं.", "सहा", "मजूर", "होते.", "उद्या", "फवारणी", "करायची", "आहे."],
      en: "Today I watered grape plot two. Six workers were there. Spraying has to be done tomorrow."
    };
    var plots = [{ mr: "प्लॉट १", en: "Plot 1" }, { mr: "प्लॉट २", en: "Plot 2" }, { mr: "प्लॉट ३", en: "Plot 3" }];
    var st = { step: 1, playing: false, timer: null, waveTimer: null, plot: 1, confirmed: false, fixOpen: false };
    var stage = $(".demo-stage", demo), stepsEl = $$(".steps li", demo), bar = $(".steps-wrap .bar", demo);
    var durations = { 1: 4600, 2: 3200, 3: 4200, 4: 2800 };
    var SATHI = '<div class="sathi-line"><img src="' + ASSET + 'img/sathi-avatar.png" alt="" width="40" height="40"><b>' +
      L("श्रम साथीला हे समजलं", "Here is what Shram Sathi understood") + "</b></div>";

    function cards() {
      var pill = st.step === 4 ? '<span class="pill dev">' + L("तुमची खात्री बाकी", "Waiting for you") + "</span>"
                               : '<span class="pill dev">' + L("तपासायचं बाकी", "To check") + "</span>";
      var ok = false;
      var fix = st.step === 3
        ? '<div class="fixwrap"><button class="fix-btn" type="button" data-fix>' + L("बदला", "Change") + "</button>" +
          (st.fixOpen ? '<div class="fix-menu">' + plots.map(function (p, i) {
            return '<button type="button" data-plot="' + i + '" aria-pressed="' + (i === st.plot) + '">' + T(p) + "</button>"; }).join("") + "</div>" : "") + "</div>"
        : "";
      return '<div class="demo-cards">' +
        '<div class="dcard ' + (ok ? "confirmed" : "") + '"><div class="ring solid">' + I("drop") + "</div><div><span class=\"k\">" + L("पाणी", "Irrigation") + "</span><b>" +
          L("द्राक्ष · " + plots[st.plot].mr, "Grapes · " + plots[st.plot].en) + '</b><span class="sub">' + L("आज", "Today") + "</span></div>" + pill + fix + "</div>" +
        '<div class="dcard ' + (ok ? "confirmed" : "") + '"><div class="ring solid">' + I("users") + "</div><div><span class=\"k\">" + L("हजेरी", "Attendance") + "</span><b>" +
          L("६ जण होते", "6 people reported") + '</b><span class="sub">' + L("मजुरी सांगितली नाही, म्हणून अंदाजाने भरली नाही: —", "No wage was said, so none is guessed: —") + "</span></div>" + pill + "</div>" +
        '<div class="dcard ' + (ok ? "confirmed" : "") + '"><div class="ring solid">' + I("cal") + "</div><div><span class=\"k\">" + L("पुढचं काम", "Upcoming work") + "</span><b>" +
          L("उद्या फवारणी", "Spraying tomorrow") + '</b><span class="sub">' + L("उद्याच्या कामांत जोडलं", "Added to tomorrow's work") + "</span></div>" + pill + "</div>" +
        "</div>";
    }

    function speech(lit) {
      var spans = words.mr.map(function (w, i) { return '<span class="' + (i < lit ? "lit" : "") + '">' + w + "</span>"; }).join(" ");
      // the farmer always speaks Marathi; the English page adds the meaning underneath
      return PL === "en"
        ? '<div class="speech"><div class="cap en" style="font-family:var(--deva)">' + spans + '</div><p class="meaning en">' + words.en + "</p></div>"
        : '<div class="speech"><div class="cap mr" aria-label="' + words.mr.join(" ") + '">' + spans + "</div></div>";
    }

    function render() {
      var s = st.step, h = "";
      stepsEl.forEach(function (li, i) { li.classList.toggle("on", i + 1 === s); li.classList.toggle("done", i + 1 < s); });
      if (bar) bar.style.width = ((s - 1) / 4 * 80) + "%";
      var head = '<div class="demo-head"><div class="who"><span class="face f1" data-i="अ" aria-hidden="true"></span>' +
        L("अनिल पवार · मालक, बोलत आहेत", "Anil Pawar · owner, speaking") + "</div>" +
        '<div class="demo-ctrl">' +
        (st.playing ? '<button class="btn btn-ghost btn-sm" type="button" data-pause>' + I("pause") + L("थांबवा", "Pause") + "</button>"
                    : '<button class="btn btn-primary btn-sm" type="button" data-play>' + I("play") + (s === 1 ? L("उदाहरण ऐका", "Play example") : L("पुढे चला", "Continue")) + "</button>") +
        '<button class="btn btn-ghost btn-sm" type="button" data-replay aria-label="Replay">' + I("replay") + "</button></div></div>";

      if (s === 1) {
        h = head + '<div class="big-wave" aria-hidden="true">' + new Array(40).join("<i></i>") + "<i></i></div>" + speech(st.lit || 0) +
          '<div class="truth-row">' + I("mic") + L("बोललेलं. अजून कुठलीही नोंद झालेली नाही.", "Spoken. It is not a record yet.") + "</div>";
      } else if (s === 2) {
        h = head + speech(99) + SATHI + cards() +
          '<div class="truth-row">' + I("list") + L("तीन वेगळ्या नोंदी. अजून पक्क्या नाहीत.", "Three separate records. Not confirmed yet.") + "</div>";
      } else if (s === 3) {
        h = head + SATHI + cards() +
          '<div class="demo-msg">' + I("edit") + "<div>" + L("काही चुकलं असेल तर टॅप करून बदला, किंवा पुन्हा बोलून सांगा. हवं तर प्लॉट बदलून पाहा.", "If something is wrong, tap to change it, or just say it again. Try changing the plot.") + "</div></div>";
      } else if (s === 4) {
        h = head + cards() +
          '<div class="confirm-row"><button class="btn btn-primary" type="button" data-confirm>' + I("check") + L("पक्कं आहे", "This is right") + "</button>" +
          '<span class="small">' + L("तुम्ही पक्कं केल्यावरच ती तुमची नोंद होते.", "It becomes your record only when you confirm it.") + "</span></div>" +
          '<div class="truth">' +
          '<div class="truth-row"><span class="pill plain">1</span>' + L("बोललेलं", "Spoken") + " → " + L("समजलेलं", "Understood") + " → <b>" + L("तुम्ही पक्कं केलेलं", "Confirmed by you") + "</b></div>" +
          '<div class="truth-row">' + I("users") + L("मुकादम किंवा कामगाराने केलेली नोंद मालक मंजूर करेपर्यंत “मंजुरी बाकी” दिसते.", "A record made by the Mukadam or a worker shows “awaiting approval” until the owner approves it.") + "</div></div>";
      } else {
        h = head + '<div class="ledger"><div class="ledger-head">' + L("पवार मळा · आजची नोंद", "Pawar farm · today's record") + '<span class="tag">' + L("नोंद राहते", "Kept") + "</span></div>" +
          '<div class="ledger-row">' + I("drop") + L("पाणी · द्राक्ष " + plots[st.plot].mr, "Irrigation · grapes " + plots[st.plot].en) + '<span class="pill now">' + L("पक्कं", "Confirmed") + "</span></div>" +
          '<div class="ledger-row">' + I("users") + L("हजेरी · ६ जण · मजुरी —", "Attendance · 6 people · wage —") + '<span class="pill now">' + L("पक्कं", "Confirmed") + "</span></div>" +
          '<div class="ledger-row">' + I("cal") + L("उद्या · फवारणी", "Tomorrow · spraying") + '<span class="pill dev">' + L("बाकी काम", "Pending work") + "</span></div>" +
          '<div class="ledger-foot"><span>' + I("user") + "</span>" + L("नोंदवलं: अनिल पवार", "Recorded by: Anil Pawar") + "<span>" + L("दिवस, वेळ आणि हवामान आपोआप जोडलं", "Day, time and weather added automatically") + "</span><span>" + L("मूळ आवाज पुन्हा ऐकता येतो", "The original voice can be played back") + "</span></div></div>" +
          '<div class="demo-after"><p class="h3">' + L("तुम्ही जे बोलता, ते श्रम सफल नीट लावून देतं. <em>पक्कं काय, ते तुम्हीच ठरवता.</em>", "Shram Safal organises your words. <em>You decide what is confirmed.</em>") + "</p>" +
          '<div class="btn-row" style="margin-top:4px"><a class="btn btn-primary" href="' + (document.documentElement.getAttribute("data-play") === "off" ? "contact.html" : "get-app.html") + '">' + L("तुमच्या शेतावर वापरून पाहा", "Try Shram Safal on your own farm") + '</a><a class="btn btn-ghost" href="trust.html">' + L("तुमची नोंद कशी सुरक्षित राहते", "How your records are protected") + "</a></div></div>";
      }
      stage.innerHTML = '<div class="fade" style="display:grid;gap:18px">' + h + "</div>";
      if (s === 2 || s === 3 || s === 4) {
        var cs = $$(".dcard", stage);
        cs.forEach(function (c, i) { setTimeout(function () { c.classList.add("show"); }, reduce ? 0 : (s === 2 ? 350 + i * 450 : 40)); });
      }
      if (s === 1) animateWave();
    }

    function animateWave() {
      clearInterval(st.waveTimer);
      var bars = $$(".big-wave i", stage);
      if (!st.playing || reduce) { bars.forEach(function (b, i) { b.style.height = (20 + 30 * Math.abs(Math.sin(i * .5))) + "%"; }); return; }
      st.waveTimer = setInterval(function () { bars.forEach(function (b) { b.style.height = (15 + Math.random() * 85) + "%"; }); }, 120);
    }

    function lightWords() {
      var i = st.lit || 0, total = words.mr.length;
      var id = setInterval(function () {
        if (!st.playing || st.step !== 1) { clearInterval(id); return; }
        i++; st.lit = i;
        $$(".speech .cap span", stage).forEach(function (sp, j) { sp.classList.toggle("lit", j % total < i); });
        if (i >= total) clearInterval(id);
      }, 300);
    }

    function schedule() {
      clearTimeout(st.timer);
      if (!st.playing || st.step >= 5) { st.playing = false; return; }
      st.timer = setTimeout(function () {
        if (st.step === 4) st.confirmed = true;
        go(st.step + 1, true);
      }, durations[st.step]);
    }

    function go(n, keepPlaying) {
      st.step = Math.max(1, Math.min(5, n));
      if (!keepPlaying) st.playing = false;
      if (st.step >= 5) st.playing = false;
      st.fixOpen = st.step === 3 && st.playing ? false : st.fixOpen;
      render();
      if (st.step === 1 && st.playing) lightWords();
      schedule();
    }

    demo.addEventListener("click", function (e) {
      var t = e.target.closest("button");
      if (!t) return;
      if (t.hasAttribute("data-play")) { st.playing = true; if (st.step === 1) st.lit = 0; render(); if (st.step === 1) lightWords(); schedule(); }
      else if (t.hasAttribute("data-pause")) { st.playing = false; clearTimeout(st.timer); render(); }
      else if (t.hasAttribute("data-replay")) { st.lit = 0; st.plot = 1; st.fixOpen = false; st.playing = true; go(1, true); }
      else if (t.hasAttribute("data-step")) { st.lit = 99; go(+t.getAttribute("data-step"), false); }
      else if (t.hasAttribute("data-fix")) { st.playing = false; clearTimeout(st.timer); st.fixOpen = !st.fixOpen; render(); }
      else if (t.hasAttribute("data-plot")) { st.plot = +t.getAttribute("data-plot"); st.fixOpen = false; render(); }
      else if (t.hasAttribute("data-confirm")) { st.playing = false; go(5, false); }
    });
    render();
  });

  /* ---------- Roles and farms: who sees what (a diagram, never an app screen) ---------- */
  var POWERS = [
    { k: "record", i: "mic", t: { mr: "कामाची नोंद", en: "Record work" } },
    { k: "hajeri", i: "list", t: { mr: "हजेरी घेणं", en: "Take attendance" } },
    { k: "approve", i: "checkc", t: { mr: "नोंदी मंजूर करणं", en: "Approve records" } },
    { k: "money", i: "rupee", t: { mr: "पैसे व मजुरी पाहणं", en: "See money and wages" } },
    { k: "people", i: "users", t: { mr: "माणसं जोडणं, अधिकार देणं", en: "Invite people, give powers" } }
  ];
  var IDCARD = '<div class="idcard"><div class="qr" aria-hidden="true"></div><div><b>' + L("रमेश जाधव", "Ramesh Jadhav") + "</b><small>" +
    L("श्रम सफल ओळख क्रमांक · कायमचा", "Shram Safal ID · permanent") + "</small></div></div>";
  var DIGITS = ["१", "२", "३", "४"];

  function access(o) {
    var own = o.plots === "own";
    var plots = DIGITS.map(function (d, i) {
      var on = own || o.plots[i];
      return '<div class="plotc ' + (own ? "own" : on ? "on" : "off") + '">' + I(own ? "user" : on ? "check" : "lock") +
        "<span>" + L("प्लॉट " + d, "Plot " + (i + 1)) + "</span></div>";
    }).join("");
    var pw = POWERS.map(function (p) {
      var yes = !!o.powers[p.k];
      return '<li class="' + (yes ? "yes" : "no") + '">' + I(p.i) + "<span>" + T(p.t) + '</span><b class="yn">' + (yes ? L("हो", "Yes") : L("नाही", "No")) + "</b></li>";
    }).join("");
    return '<div class="access fade">' +
      '<div class="access-head"><span class="face ' + o.fc + '" data-i="' + o.face + '" aria-hidden="true"></span><div><b>' + T(o.name) + "</b><small>" + T(o.farm) + "</small></div>" +
      '<span class="pill now">' + T(o.role) + "</span></div>" +
      (o.until ? '<div class="until-line">' + I("clock") + T(o.until) + "</div>" : "") +
      '<p class="list-title">' + L("कोणते प्लॉट", "Which plots") + '</p><div class="plotmap">' + plots + "</div>" +
      (own ? '<p class="small" style="margin:8px 0 0">' + L("कोणत्याही प्लॉटवर काम करतात, पण दिसतं फक्त स्वतःचं काम.", "They work on any plot, but see only their own work.") + "</p>" : "") +
      '<p class="list-title" style="margin-top:18px">' + L("कोणते अधिकार", "Which powers") + '</p><ul class="powers">' + pw + "</ul>" +
      (o.idcard ? IDCARD : "") + "</div>";
  }

  var FARM = { mr: "पवार मळा", en: "Pawar farm" };
  var ALL = [true, true, true, true];
  var ROLES = {
    owner: {
      face: "अ", fc: "f1", name: { mr: "अनिल पवार", en: "Anil Pawar" }, role: { mr: "मालक", en: "Owner" }, plots: ALL,
      powers: { record: 1, hajeri: 1, approve: 1, money: 1, people: 1 },
      can: [{ mr: "सगळ्या प्लॉटची, सगळ्यांची नोंद पाहणं", en: "See every plot and everyone's records" }, { mr: "इतरांच्या नोंदी मंजूर करणं किंवा शंका घेणं", en: "Approve, or question, records made by others" }, { mr: "पैसे, खर्च आणि मजुरी पाहणं", en: "See money, spending and wages" }, { mr: "माणसं जोडणं, आणि प्रत्येकाला कोणते अधिकार, कोणते प्लॉट, कधीपर्यंत ते ठरवणं", en: "Invite people and choose each person's powers, plots and end date" }],
      cannot: [{ mr: "दुसऱ्याच्या शेताची माहिती: ती त्या शेताची असते", en: "Another farm's information: it belongs to that farm" }]
    },
    family: {
      face: "सु", fc: "f2", name: { mr: "सुनीता पवार", en: "Sunita Pawar" }, role: { mr: "घरचे", en: "Family" }, plots: ALL,
      powers: { record: 1, hajeri: 1, approve: 1, money: 0, people: 0 },
      can: [{ mr: "कामाची नोंद करणं आणि हजेरी घेणं", en: "Record work and take attendance" }, { mr: "नोंदी मंजूर करणं, कारण मालकाने तो अधिकार दिला आहे", en: "Approve records, because the owner gave that power" }],
      cannot: [{ mr: "पैसे व मजुरी: मालकाने हा अधिकार दिलेला नाही", en: "Money and wages: the owner has not given this power" }, { mr: "माणसं जोडणं किंवा अधिकार बदलणं", en: "Inviting people or changing powers" }]
    },
    mukadam: {
      face: "शं", fc: "f3", name: { mr: "शंकर माने", en: "Shankar Mane" }, role: { mr: "मुकादम", en: "Mukadam" }, plots: [true, true, false, false],
      until: { mr: "१५ डिसेंबरपर्यंतच. त्यानंतर आपोआप बंद होतं.", en: "Until 15 December; stops by itself after that" },
      powers: { record: 1, hajeri: 1, approve: 0, money: 0, people: 0 },
      can: [{ mr: "प्लॉट १ व २ वरच्या कामाची नोंद", en: "Record work on plots 1 and 2" }, { mr: "हजेरी घेणं", en: "Take attendance" }, { mr: "१५ डिसेंबरनंतर हे अधिकार आपोआप थांबतात", en: "These powers stop by themselves after 15 December" }],
      cannot: [{ mr: "नोंदी मंजूर करणं", en: "Approving records" }, { mr: "पैसे, खर्च, मजुरी", en: "Money, spending, wages" }, { mr: "प्लॉट ३ व ४", en: "Plots 3 and 4" }]
    },
    worker: {
      face: "र", fc: "f4", name: { mr: "रमेश जाधव", en: "Ramesh Jadhav" }, role: { mr: "कामगार", en: "Worker" }, plots: "own", idcard: true,
      powers: { record: 1, hajeri: 0, approve: 0, money: 0, people: 0 },
      can: [{ mr: "स्वतःचे कामाचे दिवस आणि केलेलं काम पाहणं", en: "See their own working days and work done" }, { mr: "दिलेलं काम पाहणं आणि “काम झालं” सांगणं", en: "See work given to them and say “work done”" }, { mr: "कायमचा ओळख क्रमांक आणि QR कार्ड; स्वतःचा फोन नसला तरी नाव नोंदीत असतं", en: "A permanent ID and QR card; their name is on the record even without a phone of their own" }],
      cannot: [{ mr: "इतरांची मजुरी किंवा हजेरी", en: "Other people's wages or attendance" }, { mr: "शेताचा खर्च आणि इतर प्लॉटची माहिती", en: "Farm spending and other plots" }]
    }
  };

  var rolesRoot = $("[data-roles]");
  if (rolesRoot) whenNear(rolesRoot, function () {
    var tabsEl = $$("[data-role]", rolesRoot), vis = $("[data-access]", rolesRoot), detail = $(".role-detail", rolesRoot);
    function show(k) {
      var r = ROLES[k];
      tabsEl.forEach(function (t) { t.setAttribute("aria-selected", String(t.getAttribute("data-role") === k)); });
      vis.innerHTML = access({ face: r.face, fc: r.fc, name: r.name, farm: FARM, role: r.role, plots: r.plots, powers: r.powers, until: r.until, idcard: r.idcard });
      detail.innerHTML = '<div class="fade"><p class="list-title">' + L("हे करू शकतात", "Can do") + '</p><ul class="can-list yes">' +
        r.can.map(function (c) { return "<li>" + I("check") + T(c) + "</li>"; }).join("") + "</ul>" +
        '<p class="list-title" style="margin-top:16px">' + L("हे दिसत नाही, करता येत नाही", "Cannot see or do") + '</p><ul class="can-list no">' +
        r.cannot.map(function (c) { return "<li>" + I("x") + T(c) + "</li>"; }).join("") + "</ul></div>";
    }
    tabsEl.forEach(function (t) { t.addEventListener("click", function () { show(t.getAttribute("data-role")); }); });
    show("owner");
    var KEYS = tabsEl.map(function (t) { return t.getAttribute("data-role"); });
    autoCycle(rolesRoot, KEYS.length, function (i) { show(KEYS[i]); }, 4400, function () {
      return tabsEl.findIndex(function (t) { return t.getAttribute("aria-selected") === "true"; });
    });
  });

  var farmsRoot = $("[data-farms]");
  if (farmsRoot) whenNear(farmsRoot, function () {
    var FARMS = [
      { farm: { mr: "काळे मळा (स्वतःचं शेत)", en: "Kale farm (his own)" }, role: { mr: "मालक", en: "Owner" }, plots: ALL, powers: ROLES.owner.powers },
      { farm: { mr: "पवार मळा", en: "Pawar farm" }, role: { mr: "मुकादम", en: "Mukadam" }, plots: [true, true, false, false], until: ROLES.mukadam.until, powers: ROLES.mukadam.powers },
      { farm: { mr: "देशमुख बाग", en: "Deshmukh orchard" }, role: { mr: "कामगार", en: "Worker" }, plots: "own", powers: ROLES.worker.powers }
    ];
    var tabsEl = $$("[data-farm]", farmsRoot), vis = $("[data-access]", farmsRoot);
    function show(i) {
      var f = FARMS[i];
      tabsEl.forEach(function (t) { t.setAttribute("aria-selected", String(+t.getAttribute("data-farm") === i)); });
      vis.innerHTML = access({ face: "सं", fc: "f2", name: { mr: "संतोष काळे", en: "Santosh Kale" }, farm: f.farm, role: f.role, plots: f.plots, powers: f.powers, until: f.until });
    }
    tabsEl.forEach(function (t) { t.addEventListener("click", function () { show(+t.getAttribute("data-farm")); }); });
    show(0);
    autoCycle(farmsRoot, FARMS.length, show, 4400, function () {
      return tabsEl.findIndex(function (t) { return t.getAttribute("aria-selected") === "true"; });
    });
  });

  /* ---------- Scroll progress: the thin green line that runs through the whole story ---------- */
  var prog = $(".progress");
  if (prog) {
    var ticking = false;
    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var h = document.documentElement.scrollHeight - innerHeight;
        prog.style.width = (h > 0 ? (scrollY / h) * 100 : 0) + "%";
        ticking = false;
      });
    }, { passive: true });
  }

  function onceVisible(el, fn, margin) {
    if (!el) return;
    if (!("IntersectionObserver" in window)) { fn(); return; }
    var o = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { fn(); o.disconnect(); } });
    }, { rootMargin: margin || "0px 0px -25% 0px" });
    o.observe(el);
  }

  // Heavy parts are built only when the visitor scrolls near them, so the first screen is drawn fast.
  function whenNear(el, fn) {
    if (!el) return;
    if (!("IntersectionObserver" in window)) { fn(); return; }
    var o = new IntersectionObserver(function (es) {
      if (es.some(function (e) { return e.isIntersecting; })) { o.disconnect(); fn(); }
    }, { rootMargin: "900px 0px" });
    o.observe(el);
  }

  /* ---------- Auto-play: semi-literate visitors only scroll; each interactive part
     steps through by itself while in view. A tap pauses it for a while, then it resumes. ---------- */
  function autoCycle(root, n, show, ms, current) {
    // Runs even with "reduce motion": content steps through for people who only scroll;
    // the decorative movement itself is already switched off by CSS in that mode.
    if (!root || n < 2 || !("IntersectionObserver" in window)) return;
    var timer = null, visible = false, holdUntil = 0;
    var bar = document.createElement("span");
    bar.className = "autobar";
    bar.innerHTML = "<i></i>";
    bar.style.setProperty("--d", ms + "ms");
    bar.setAttribute("aria-hidden", "true");
    root.insertBefore(bar, root.firstChild);
    function restartBar() { var b = bar.firstChild; b.style.animation = "none"; void b.offsetWidth; b.style.animation = ""; }
    function tick() {
      clearTimeout(timer);
      if (!visible) return;
      var wait = holdUntil - Date.now();
      if (wait > 0) { bar.classList.add("paused"); timer = setTimeout(tick, wait); return; }
      bar.classList.remove("paused");
      restartBar();
      timer = setTimeout(function () {
        var i = current ? current() : -1;
        show(((i < 0 ? 0 : i) + 1) % n);
        tick();
      }, ms);
    }
    new IntersectionObserver(function (es) {
      es.forEach(function (e) { visible = e.isIntersecting; if (visible) tick(); else clearTimeout(timer); });
    }, { threshold: 0.3 }).observe(root);
    function hold() { holdUntil = Date.now() + 12000; tick(); }
    root.addEventListener("pointerdown", hold);
    root.addEventListener("keydown", hold);
  }

  /* ---------- Beat 5: the demo starts by itself when it comes into view (no sound, no microphone) ---------- */
  var auto = $("[data-autoplay]");
  if (auto) onceVisible(auto, function () {
    var b = $("[data-play]", auto);
    if (b) b.click();
  }, "0px 0px -35% 0px");

  /* ---------- Beat 8: the larger picture — three rings around the farm's true record ---------- */
  var ORB = [
    { r: 1, i: "user", t: { mr: "तुम्ही", en: "You" }, today: { mr: "फोनवर कोणी सांगितलं तेवढंच.", en: "Only what someone told you on the phone." },
      withr: { mr: "आज नोंदलेलं काम, प्लॉटनुसार. मंजुरी तुमच्या हातात.", en: "Today's recorded work, plot by plot. Approval stays in your hands." }, s: ["now"] },
    { r: 1, i: "home", t: { mr: "घरचे", en: "Family" }, today: { mr: "वहीतली बिलं, अर्धवट माहिती.", en: "Bills in a notebook, half the picture." },
      withr: { mr: "तीच नोंद, मालकाने दिलेल्या प्लॉट आणि अधिकारांपुरती.", en: "The same record, limited to the plots and powers the owner gave." }, s: ["now"] },
    { r: 1, i: "list", t: { mr: "मुकादम", en: "Mukadam" }, today: { mr: "“चार मजूर, दोन दिवस” डोक्यात.", en: "“Four workers, two days” in his head." },
      withr: { mr: "ठरलेल्या प्लॉटसाठी, ठरलेल्या तारखेपर्यंत हजेरी आणि कामाची नोंद.", en: "Attendance and work records for set plots, until a set date." }, s: ["now"] },
    { r: 1, i: "hand", t: { mr: "कामगार", en: "Worker" }, today: { mr: "“मंगळवारची मजुरी मिळाली का?” पुरावा नाही.", en: "“Was I paid for Tuesday?” No proof." },
      withr: { mr: "स्वतःचे दिवस, स्वतःचं काम आणि स्वतःचा ओळख क्रमांक.", en: "Their own days and work, and their own ID number." }, s: ["now"] },
    { r: 2, i: "users", t: { mr: "शेतकरी गट", en: "FPO" }, today: { mr: "सदस्य सांगतात तेवढंच.", en: "Only what members say." },
      withr: { mr: "सदस्यांच्या शेतांचं एकत्र चित्र, प्रत्येक शेतकऱ्याच्या परवानगीने.", en: "A combined view of member farms, with each farmer's permission." }, s: ["dev"] },
    { r: 2, i: "book", t: { mr: "तज्ज्ञ", en: "Experts" }, today: { mr: "सगळ्यांसाठी एकच वेळापत्रक.", en: "One schedule for everyone." },
      withr: { mr: "तुम्ही दाखवायचं ठरवलं, तर प्लॉटचा इतिहास पाहून सल्ला देता येईल.", en: "If you choose to show it, advice could be based on your plot's history." }, s: ["future"] },
    { r: 2, i: "sprout", t: { mr: "कुशल टीम", en: "Skilled crews" }, today: { mr: "“आज दहा माणसं पाहिजेत.”", en: "“Need ten people today.”" },
      withr: { mr: "कामाच्या नोंदीवरून कुशल टीम ओळखता येऊ शकेल.", en: "Skilled crews could one day be recognised from their recorded work." }, s: ["future"] },
    { r: 3, i: "building", t: { mr: "बँक", en: "Bank" }, today: { mr: "सातबारा आणि कागदपत्रं.", en: "Land papers and documents." },
      withr: { mr: "तुम्ही ठरवलं तर, शेतात वेळोवेळी झालेल्या कामाची नोंद बँकेला दाखवता येऊ शकेल. कर्ज द्यायचं की नाही, हा निर्णय बँकेचाच.", en: "If you choose, you could show the bank your farm's work record over time. Whether to lend is still the bank's decision." }, s: ["future"] },
    { r: 3, i: "umbrella", t: { mr: "विमा", en: "Insurer" }, today: { mr: "मंडळातल्या हवामान केंद्राचे आकडे.", en: "Numbers from the revenue circle's weather station." },
      withr: { mr: "नुकसानाआधी आणि नंतर तुमच्या प्लॉटवर काय झालं, याच्या तारखेसह नोंदी. नोंद आता तयार असते; जोडणी ही पुढची शक्यता. दाव्याचा निर्णय विमा कंपनीचाच.", en: "Dated records of what happened on your plot before and after a loss. The record exists now; a link to insurers is a future possibility, and the claim decision stays with the insurer." }, s: ["future"] },
    { r: 3, i: "truck", t: { mr: "निर्यातदार", en: "Exporters" }, today: { mr: "काढणीच्या दिवशीचा माल.", en: "The produce on harvest day." },
      withr: { mr: "तारीख, औषध आणि मात्रेसह फवारणीची नोंद. नोंद आता तयार असते; थेट जोडणी ही पुढची शक्यता.", en: "A spray record with dates, products and doses. The record exists now; a direct link to exporters is a future possibility." }, s: ["future"] },
    { r: 3, i: "shield", t: { mr: "सरकार", en: "Government" }, today: { mr: "सातबाऱ्यावरची माहिती.", en: "What is on the land record." },
      withr: { mr: "ॲग्रीस्टॅक शेतकरी ओळख क्रमांक आणि सर्व्हे नंबर नोंदीत ठेवण्याची तयारी.", en: "Getting ready to carry the AgriStack Farmer ID and survey numbers." }, s: ["dev"] },
    { r: 3, i: "network", t: { mr: "संशोधन", en: "Research" }, today: { mr: "सर्वेक्षणातले अंदाज.", en: "Estimates from surveys." },
      withr: { mr: "अभ्यासासाठी, ओळख पटणार नाही अशी केलेली माहिती. तीही फक्त स्पष्ट परवानगीने.", en: "De-identified data for study, only with clear permission." }, s: ["future"] },
    { r: 2, i: "leaf", t: { mr: "इतर शेतकरी", en: "Fellow farmers" }, today: { mr: "ऐकीव गोष्टी आणि सल्ला.", en: "Hearsay and advice." },
      withr: { mr: "त्यांच्या परवानगीने, त्याच टप्प्यावर त्यांनी प्रत्यक्ष काय केलं ते. नुसता सल्ला नाही, नोंदलेला अनुभव.", en: "With their permission, what they actually did at the same stage. Real practice, not just advice." }, s: ["future"] }
  ];
  var STATUS = {
    now: '<span class="pill now">' + L("आता उपलब्ध", "Available now") + "</span>",
    dev: '<span class="pill dev">' + L("तयार होत आहे", "Being developed") + "</span>",
    future: '<span class="pill future">' + L("पुढची शक्यता", "Future possibility") + "</span>"
  };
  var orbitRoot = $("[data-orbit]");
  if (orbitRoot) whenNear(orbitRoot, function () {
    var orbit = $(".orbit", orbitRoot), detail = $(".orbit-detail", orbitRoot);
    // Hand-placed angles (degrees, 0 = right, clockwise) so labels on different rings never collide.
    var R = { 1: 24, 2: 34, 3: 45 };
    var ANGLE = [-135, -45, 135, 45, 18, 162, 90, -90, -18, 54, 126, 198, -118];
    var pos = ORB.map(function (n, i) {
      var a = ANGLE[i] * Math.PI / 180;
      return [50 + R[n.r] * Math.cos(a), 50 + R[n.r] * Math.sin(a)];
    });
    var svg = '<svg viewBox="0 0 100 100" aria-hidden="true">' +
      '<circle class="ringfill r3" cx="50" cy="50" r="45"/><circle class="ringfill r2" cx="50" cy="50" r="34"/><circle class="ringfill r1" cx="50" cy="50" r="24"/>' +
      '<circle class="ringc r3" cx="50" cy="50" r="45"/><circle class="ringc r2" cx="50" cy="50" r="34"/><circle class="ringc r1" cx="50" cy="50" r="24"/>';
    ORB.forEach(function (n, i) {
      var p = pos[i];
      svg += '<line class="spoke" data-sp="' + i + '" x1="50" y1="50" x2="' + p[0].toFixed(2) + '" y2="' + p[1].toFixed(2) + '"/>';
      if (!reduce) svg += '<circle class="pulse" r=".7"><animateMotion dur="' + (2.6 + (i % 4) * 0.5) + 's" begin="' + (i * 0.37).toFixed(2) + 's" repeatCount="indefinite" path="M50,50 L' + p[0].toFixed(2) + "," + p[1].toFixed(2) + '"/></circle>';
    });
    svg += "</svg>";
    var html = svg + '<div class="orbit-core"><div><small>' + L("मध्यभागी", "At the centre") + "</small><b>" + L("शेताची विश्वासार्ह आठवण", "Trusted farm memory") + "</b></div></div>";
    ORB.forEach(function (n, i) {
      html += '<button type="button" class="onode r' + n.r + '" data-on="' + i + '" style="left:' + pos[i][0].toFixed(2) + "%;top:" + pos[i][1].toFixed(2) + '%" aria-pressed="false" title="' + n.t[PL] + '" aria-label="' + n.t[PL] + '"><span class="ring">' + I(n.i) + "</span>" + T(n.t) + "</button>";
    });
    orbit.innerHTML = html;
    var ringName = { 1: L("तुमची टीम", "Your team"), 2: L("शेताभोवतीचे लोक", "People around the farm"), 3: L("संस्था", "Institutions") };
    function show(i) {
      var n = ORB[i];
      $$("[data-on]", orbit).forEach(function (b) { b.setAttribute("aria-pressed", String(+b.getAttribute("data-on") === i)); });
      $$("[data-sp]", orbit).forEach(function (l) { l.classList.toggle("on", +l.getAttribute("data-sp") === i); });
      detail.innerHTML = '<div class="fade"><div class="head"><span class="ring solid">' + I(n.i) + "</span><div><b>" + T(n.t) + "</b><small>" + ringName[n.r] + "</small></div></div>" +
        '<div class="row today">' + I("eyeoff") + "<div><small>" + L("आज त्यांना दिसतं", "WHAT THEY SEE TODAY") + "</small><p>" + T(n.today) + "</p></div></div>" +
        '<div class="row with">' + I("eye") + "<div><small>" + L("नोंद असली की (परवानगीनुसार)", "WITH THE RECORD (AS PERMITTED)") + "</small><p>" + T(n.withr) + "</p></div></div>" +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">' + n.s.map(function (k) { return STATUS[k]; }).join("") + "</div>" +
        (n.r === 3 ? '<p class="small" style="margin:14px 0 0">' + L("फक्त नोंद ठेवल्याने कर्ज, विम्याची भरपाई, जास्त भाव किंवा प्रमाणपत्र मिळत नाही. ते निर्णय बँक, विमा कंपनी, खरेदीदार किंवा प्रमाणपत्र देणारी संस्थाच घेते.", "A record alone does not bring a loan, an insurance payout, a better price or a certificate. Those decisions stay with the bank, insurer, buyer or certifier.") + "</p>" : "") +
        "</div>";
    }
    orbit.addEventListener("click", function (e) { var b = e.target.closest("[data-on]"); if (b) show(+b.getAttribute("data-on")); });
    show(0);
    autoCycle(orbitRoot, ORB.length, show, 3600, function () {
      return $$("[data-on]", orbit).findIndex(function (b) { return b.getAttribute("aria-pressed") === "true"; });
    });
  });

  /* ---------- Your reason: today's problem beside the Shram Safal answer ---------- */
  var REASONS = [
    { i: "shield", t: { mr: "शेतावर नियंत्रण हवं", en: "I want control of my farm" },
      old: { mr: "सगळं फोनवर विचारावं लागतं. कोणी काय केलं, ते खात्रीने कळत नाही.", en: "You have to ask everything on the phone, and never know for sure who did what." },
      neu: { mr: "प्रत्येक नोंद कोणी केली, कधी, कोणत्या प्लॉटवर, ते दिसतं. मंजुरी तुमच्या हातात. कोणाला काय दिसेल, ते तुम्हीच ठरवता.", en: "You see who recorded what, when, and on which plot. Approval stays with you, and you decide who sees what." },
      f: [{ mr: "मंजूर / शंका", en: "Approve / question" }, { mr: "प्रत्येकाचे अधिकार", en: "Powers per person" }, { mr: "हजेरी", en: "Attendance" }],
      who: {mr: "मालक", en: "Farm owner"}, sc: "control",
      b: [{mr: "सकाळी मुकादमाला फोन: “पाणी दिलं का?” उत्तर: “हो, दिलं.”", en: "Morning, a call to the Mukadam: “Was the plot watered?” “Yes, done.”"}, {mr: "दुपारी घरी विचारलं: “आज किती माणसं आली?” कोणी पाच सांगतं, कोणी सहा.", en: "Afternoon, asking at home: “How many came today?” One says five, another says six."}, {mr: "संध्याकाळपर्यंत तीन फोन, तीन उत्तरं. खरं काय झालं, ते शेवटपर्यंत कळत नाही.", en: "By evening: three calls, three answers. What really happened, you never quite find out."}],
      c: {mr: "शेत तुमचं, पण शेताचं खरं चित्र दुसऱ्यांच्या शब्दावर अवलंबून.", en: "It is your farm, but its true picture depends on someone else's word."} },
    { i: "scale", t: { mr: "स्पष्ट निर्णय घ्यायचेत", en: "I want clear decisions" },
      old: { mr: "निर्णय आठवणीवर आणि अंदाजावर होतात. मेहनत १०० टक्के, पण माप नाही.", en: "Decisions run on memory and guesswork. Full effort, but no measure." },
      neu: { mr: "प्लॉटनुसार काम, खर्च, निरीक्षणं आणि मागच्या हंगामाची नोंद समोर. काय ठरलं होतं आणि काय झालं, एका नजरेत.", en: "Work, spending, observations and last season's record, plot by plot. Planned versus done at a glance." },
      f: [{ mr: "तुलना", en: "Compare" }, { mr: "प्लॉटनुसार खर्च", en: "Spending by plot" }, { mr: "शेताचा इतिहास", en: "Farm history" }],
      who: {mr: "बागायतदार", en: "Grower"}, sc: "decide",
      b: [{mr: "खत वाढवायचं की नाही? मागच्या वर्षी नेमकं काय केलं होतं, ते आठवत नाही.", en: "More fertiliser or not? What exactly was done last year, nobody remembers."}, {mr: "खर्च काही वहीत, काही फोनमध्ये, काही डोक्यात. एकत्र कुठेच नाही.", en: "Spending is partly in a notebook, partly on the phone, partly in your head. Never in one place."}, {mr: "म्हणून निर्णय अंदाजावर होतो. मेहनत पूर्ण, पण हातात माप नाही.", en: "So the decision runs on a guess. Full effort, but nothing to measure with."}],
      c: {mr: "निर्णय चुकला, हे कळतं थेट काढणीला. तेव्हा बदलायला वेळच उरलेला नसतो.", en: "You learn the decision was wrong at harvest, when there is no time left to change it."} },
    { i: "plot", t: { mr: "अनेक प्लॉट, सांभाळणं अवघड", en: "Too many plots to run well" },
      old: { mr: "कोणत्या प्लॉटवर काय बाकी आहे, ते एका नजरेत दिसत नाही. काहीतरी राहून जातं.", en: "You can't see at a glance what's pending on which plot. Something gets missed." },
      neu: { mr: "प्रत्येक प्लॉटचं वेळापत्रक, आजची राहिलेली कामं आणि लक्ष द्यायच्या गोष्टी एकाच ठिकाणी. प्लॉटनुसार जबाबदारी देता येते.", en: "Each plot's schedule, today's pending work and what needs attention, in one place. Responsibility can be given plot by plot." },
      f: [{ mr: "लक्ष द्या यादी", en: "Attention list" }, { mr: "प्लॉटचं वेळापत्रक", en: "Plot schedule" }, { mr: "प्लॉटनुसार अधिकार", en: "Access by plot" }],
      who: {mr: "अनेक प्लॉटचे मालक", en: "Owner of many plots"}, sc: "plots",
      b: [{mr: "एकाच दिवशी प्लॉट १ ला फवारणी, प्लॉट ३ ला पाणी, प्लॉट ४ ला छाटणी.", en: "On the same day: spraying on plot 1, water on plot 3, pruning on plot 4."}, {mr: "कोणत्या प्लॉटवर काय बाकी आहे, हे सगळं डोक्यात लक्षात ठेवायचं.", en: "What is pending on which plot, all of it has to be kept in your head."}, {mr: "आठवड्याने लक्षात येतं: प्लॉट २ ची फवारणी राहूनच गेली.", en: "A week later you notice: plot 2's spray was missed."}],
      c: {mr: "एक काम राहिलं, तर त्याचा फटका पूर्ण प्लॉटला बसू शकतो.", en: "One missed task can cost a whole plot."} },
    { i: "phone", t: { mr: "मी शहरात, शेत लांब", en: "I live away from the farm" },
      old: { mr: "फोनवर जे सांगितलं, तेवढंच कळतं.", en: "You know only what you're told on the phone." },
      neu: { mr: "आजचं काम, हजेरी, खर्च तुमच्या फोनवर. मूळ आवाज ऐकता येतो, शंका घेता येते.", en: "Today's work, attendance and spending on your phone. You can play the original voice and raise a doubt." },
      f: [{ mr: "रोजचा आढावा", en: "Daily review" }, { mr: "मूळ आवाज", en: "Original voice" }, { mr: "शंका", en: "Question it" }],
      who: {mr: "शहरात राहणारे मालक", en: "Owner living in town"}, sc: "city",
      b: [{mr: "रोज संध्याकाळी फोन: “सगळं ठीक आहे ना?” उत्तर: “हो, सगळं ठीक.”", en: "Every evening a call: “All well?” “Yes, all well.”"}, {mr: "शनिवारी शेतावर गेल्यावर दिसतं: पानांवर डाग, आणि फवारणी झालेलीच नाही.", en: "On Saturday you reach the farm: spots on the leaves, and the spray was never done."}, {mr: "जे सांगितलं तेवढंच कळलं. जे दिसायला हवं होतं, ते दिसलंच नाही.", en: "You knew only what you were told, never what you needed to see."}],
      c: {mr: "अंतरामुळे प्रत्येक निर्णय उशिरा होतो.", en: "Distance makes every decision late."} },
    { i: "history", t: { mr: "माझ्या जमिनीचा अनुभव जपायचाय", en: "I want to keep what my land teaches me" },
      old: { mr: "जमीन दर हंगामात काहीतरी शिकवते. पण ते कुठेच लिहिलेलं नसतं, म्हणून पुढचा हंगाम पुन्हा अंदाजावर सुरू होतो.", en: "Your land teaches you something every season. But it is written nowhere, so the next season starts on guesswork again." },
      neu: { mr: "प्रत्येक प्लॉटची रोजची नोंद: काय केलं, काय दिसलं, काय बदललं, का बदललं. पुढच्या हंगामात तीच नोंद समोर.", en: "A daily record for each plot: what was done, what was seen, what changed and why. Next season, that same record is in front of you." },
      f: [{ mr: "प्लॉटची रोजची नोंद", en: "Daily plot record" }, { mr: "मागच्या हंगामाशी तुलना", en: "Compare with last season" }], link: "#compare",
      who: {mr: "अनुभवी बागायतदार", en: "Experienced grower"}, sc: "schedule",
      b: [{mr: "यंदा तीन नंबरच्या प्लॉटला पाणी कमी लागलं. मागच्या वर्षी जास्त लागलं होतं.", en: "This season, plot three needed less water. Last year it needed more."}, {mr: "का? माती बदलली, की पाऊस? सांगायला काही नोंदच नाही.", en: "Why? Did the soil change, or the rain? There is no record to tell."}, {mr: "पुढच्या हंगामात पुन्हा अंदाजावर सुरुवात.", en: "Next season starts on guesswork again."}],
      c: {mr: "जमीन दर हंगामात काहीतरी शिकवते. पण नोंद नसेल, तर तो धडा पुढच्या हंगामापर्यंत लक्षात राहत नाही.", en: "Your land teaches something every season. Without a record, the lesson doesn't last until the next one."} },
    { i: "list", t: { mr: "हजेरी-मजुरीचे वाद नकोत", en: "I don't want attendance and wage disputes" },
      old: { mr: "पगाराच्या दिवशी वहीतले आणि मुकादमच्या डोक्यातले आकडे जुळत नाहीत.", en: "On pay day, the notebook and the Mukadam's memory don't match." },
      neu: { mr: "एकच हजेरी, दोघांनाही दिसणारी. मजुरी अंदाजाने भरली जात नाही. कामगाराला स्वतःचे दिवस दिसतात.", en: "One attendance record both sides can see. Wages are never guessed. Workers see their own days." },
      f: [{ mr: "हजेरी", en: "Attendance" }, { mr: "कामगार ओळख", en: "Worker ID" }],
      who: {mr: "मालक आणि मुकादम", en: "Owner and Mukadam"}, sc: "wages",
      b: [{mr: "आठवडाभर हजेरी काही वहीत, काही मुकादमाच्या लक्षात.", en: "All week, attendance is partly in a notebook, partly in the Mukadam's memory."}, {mr: "पगाराच्या दिवशी वहीत सहा दिवस, मुकादम म्हणतो सात.", en: "On pay day the notebook says six days; the Mukadam says seven."}, {mr: "वाद होतो, आणि कामगारालाही खात्री नसते की त्याचे सगळे दिवस मोजले गेले.", en: "An argument starts, and the worker isn't sure all their days were counted either."}],
      c: {mr: "पैशापेक्षा जास्त जातो तो एकमेकांवरचा विश्वास.", en: "What is lost is more than money. It is trust in each other."} },
    { i: "truck", t: { mr: "निर्यातीसाठी फवारणी नोंद", en: "A spray record for export" },
      old: { mr: "निर्यातीसाठी तारखेसह फवारणीची नोंद लागते. ती आठवणीवरून भरावी लागते.", en: "Export needs a dated spray record, and it gets filled in from memory." },
      neu: { mr: "प्रत्येक फवारणी: तारीख, औषध, मात्रा, प्लॉट आणि कोणी केली. नोंद आपोआप तयार राहते.", en: "Every spray: date, product, dose, plot and who did it. The record is ready by itself." },
      f: [{ mr: "फवारणी नोंद", en: "Spray record" }, { mr: "तारीख आणि मात्रा", en: "Date and dose" }],
      who: {mr: "निर्यात करणारे बागायतदार", en: "Grower who exports"}, sc: "export",
      b: [{mr: "निर्यातदार विचारतो: “शेवटची फवारणी कधी? कोणतं औषध? किती मात्रा?”", en: "The exporter asks: “Last spray when? Which product? What dose?”"}, {mr: "वही शोधायची, बिलं जुळवायची, आणि बाकी आठवणीवरून भरायचं.", en: "You hunt for the notebook, match the bills, and fill the rest from memory."}, {mr: "एक तारीख चुकली, तरी माल अडकू शकतो.", en: "One wrong date, and the produce can be held back."}],
      c: {mr: "वर्षभराची मेहनत एका कागदावर अडू शकते.", en: "A whole year's work can get stuck on one sheet of paper."} },
    { i: "hand", t: { mr: "कुशल, भरवशाची माणसं हवीत", en: "Skilled people I can trust" },
      old: { mr: "“आज दहा माणसं पाहिजेत.” कोण येईल, त्यांना छाटणी जमेल का, हे माहीत नसतं.", en: "“Need ten people today.” Who will come, and can they prune? Nobody knows." },
      neu: { mr: "आजपासून प्रत्येक कामगाराचं नाव आणि काम नोंदीत. पुढे, तुमच्या प्लॉटला हवं ते कौशल्य शोधणं सोपं होऊ शकेल.", en: "From today, every worker's name and work is on the record. Later, finding the skill your plot needs could become easier." },
      f: [{ mr: "कामगार ओळख", en: "Worker ID" }, { mr: "कौशल्य-ओळख", en: "Skill profile" }], s: "future", link: "#skills",
      who: {mr: "छाटणीच्या हंगामातले मालक", en: "Owner in pruning season"}, sc: "skilled",
      b: [{mr: "उद्यापासून छाटणी. रात्री फोनवर फोन: “उद्या दहा माणसं पाठव.”", en: "Pruning starts tomorrow. Call after call at night: “Send ten people tomorrow.”"}, {mr: "सकाळी जी माणसं आली, त्यातल्या कोणाला छाटणी जमते, ते माहीत नसतं.", en: "In the morning, who among them can prune, you don't know."}, {mr: "छाटणी चुकली, तर त्याचा परिणाम पुढच्या हंगामापर्यंत दिसतो.", en: "A bad prune shows up all the way into next season."}],
      c: {mr: "कामाला हात मिळतात, पण भरवशाचे हात मिळत नाहीत.", en: "You find hands for the work, but not hands you can trust."} }
  ];
  /* ---------- Your reason, as a story: one person's day goes wrong in three moments, then the same scene is set right ---------- */
  // Flat illustrations drawn in code. Each scene has a problem layer (.pb, today) and an answer layer (.sl, with Shram Safal);
  // problem marks carry data-b="1|2|3" and appear with the matching story moment. Each scene also says where the light falls
  // for each moment (focus, in %), the sky for each moment (sky / skyS), and where the sun sits (sun, 4 positions).
  var SCENE = (function () {
    var INK = "#1d3b2c", HAIR = "#2b221d";
    var SKIN = ["#e6b089", "#c98f66", "#a7704d"];
    var AMB = "#c77d1a", RED = "#b04a3a", GRN = "#178b55", MINT = "#eaf4ec", LEAF = "#86b86b", LEAFD = "#4f8a3c", SOIL = "#ecdcb9", WATER = "#4f8fc7";
    function num(n) { return PL === "en" ? String(n) : String(n).replace(/[0-9]/g, function (d) { return "०१२३४५६७८९"[d]; }); }
    function say(mr, en) { return PL === "en" ? en : mr; }
    function E(tag, o, inner) {
      var s = "<" + tag;
      for (var k in o) if (o[k] !== null && o[k] !== undefined) s += " " + k + '="' + o[k] + '"';
      return s + (inner === undefined ? "/>" : ">" + inner + "</" + tag + ">");
    }
    function mix(o, more) { if (more) for (var k in more) o[k] = more[k]; return o; }
    function st(o, stroke, sw) { if (stroke !== 0) { o.stroke = stroke || INK; o["stroke-width"] = sw || 1.6; } return o; }
    function D(d, fill, stroke, sw, more) { return E("path", mix(st({ d: d, fill: fill || "none", "stroke-linecap": "round", "stroke-linejoin": "round" }, stroke, sw), more)); }
    function C(cx, cy, r, fill, stroke, sw, more) { return E("circle", mix(st({ cx: r2(cx), cy: r2(cy), r: r2(r), fill: fill || "none" }, stroke, sw), more)); }
    function B(x, y, w, h, rx, fill, stroke, sw, more) { return E("rect", mix(st({ x: r2(x), y: r2(y), width: r2(w), height: r2(h), rx: rx || 0, fill: fill || "none" }, stroke, sw), more)); }
    function OV(cx, cy, rx, ry, fill, more) { return E("ellipse", mix({ cx: r2(cx), cy: r2(cy), rx: r2(rx), ry: r2(ry), fill: fill }, more)); }
    function TX(x, y, s, size, fill, weight, anchor) { return E("text", { x: x, y: y, "text-anchor": anchor || "middle", "font-size": size || 13, "font-weight": weight || 800, fill: fill || INK }, s); }
    function r2(v) { return Math.round(v * 10) / 10; }
    function grp(cls, inner, b, delay) { return '<g class="' + cls + '"' + (b ? ' data-b="' + b + '"' : "") + (delay ? ' style="transition-delay:' + delay + 's"' : "") + ">" + inner + "</g>"; }
    function P(inner, b) { return grp("pb", inner, b); }
    function S(inner, delay) { return grp("sl", inner, 0, delay); }

    /* ----- people ----- */
    var LOOK = {
      owner: { skin: SKIN[1], top: "#f6f2e7", bottom: "#f1ece0", hat: "topi", kurta: 1 },
      young: { skin: SKIN[1], top: "#8c3b4a", bottom: "#4f5a6b" },
      grower: { skin: SKIN[0], top: "#6e8f3a", bottom: "#4f5a6b", hat: "cap", hatc: "#2c6e49" },
      grower2: { skin: SKIN[2], top: "#3c8f8a", bottom: "#4f5a6b", hat: "cap", hatc: "#2d4a5a" },
      woman: { skin: SKIN[1], top: "#7d3344", saree: "#a8455a", hair: "bun" },
      town: { skin: SKIN[0], top: "#5c8fbf", bottom: "#3d4757", collar: 1 },
      elder: { skin: SKIN[2], top: "#fbfaf6", bottom: "#ece6d8", hat: "pheta", hatc: "#f4f0e6", kurta: 1 },
      mukadam: { skin: SKIN[2], top: "#8c3b2e", bottom: "#ece6d8", hat: "pheta", hatc: "#e0892e" },
      family: { skin: SKIN[0], top: "#2f7a52", saree: "#3f9d68", hair: "bun" },
      son: { skin: SKIN[1], top: "#e08a2e", bottom: "#4f5a6b" },
      worker: { skin: SKIN[2], top: "#5c8fbf", bottom: "#6b5a4a", gamcha: 1 },
      worker2: { skin: SKIN[1], top: "#d8a24a", bottom: "#4f5a6b" },
      wworker: { skin: SKIN[2], top: "#c4562f", saree: "#e2b33c", hair: "bun" },
      exporter: { skin: SKIN[0], top: "#eef3f8", bottom: "#3d4757", hat: "cap", hatc: "#3d4757", collar: 1 }
    };
    // arms as [elbow, hand], in units from the feet: [sideways, up]
    var POSE = {
      stand: { l: [[-19, 70], [-17, 52]], r: [[19, 70], [17, 52]] },
      phone: { l: [[-19, 70], [-17, 52]], r: [[21, 78], [10, 104]] },
      hold: { l: [[-19, 70], [-5, 72]], r: [[19, 70], [5, 72]] },
      shrug: { l: [[-27, 76], [-33, 92]], r: [[27, 76], [33, 92]] },
      think: { l: [[-17, 68], [6, 74]], r: [[20, 78], [6, 99]] },
      head: { l: [[-19, 70], [-17, 52]], r: [[22, 98], [7, 121]] },
      point: { l: [[-19, 70], [-17, 52]], r: [[25, 84], [40, 92]] },
      pointL: { l: [[-25, 84], [-40, 92]], r: [[19, 70], [17, 52]] }
    };
    function person(x, y, s, look, pose, opt) {
      s = s || 1; opt = opt || {};
      var lk = LOOK[look] || look, pz = POSE[pose || "stand"];
      function X(v) { return r2(x + v * s); }
      function Y(v) { return r2(y - v * s); }
      function pt(p) { return X(p[0]) + " " + Y(p[1]); }
      if (opt.ghost) {
        var g = { "fill-opacity": ".92", "stroke-opacity": ".55", "stroke-dasharray": "4 4" };
        return D("M" + pt([-15, 0]) + "V" + Y(84) + "Q" + pt([-15, 93]) + " " + pt([0, 93]) + "Q" + pt([15, 93]) + " " + pt([15, 84]) + "V" + Y(0), "#f3efe6", INK, 1.5, g) +
          C(x, Y(109), 11 * s, "#f3efe6", INK, 1.5, g);
      }
      var top = lk.top, bot = lk.bottom || "#4f5a6b", hem = lk.kurta ? 40 : lk.saree ? 54 : 50;
      var o = OV(x, y + 1, 22 * s, 4 * s, "#3a2a14", { "fill-opacity": ".13" });
      if (opt.tank) o += B(X(-23), Y(94), 14 * s, 38 * s, 5 * s, WATER, INK, 1.4) + B(X(-22), Y(70), 12 * s, 4 * s, 1, "#2f5f8f", 0);
      if (lk.saree) {
        o += D("M" + pt([-13, 58]) + "L" + pt([-19, 1]) + "H" + X(19) + "L" + pt([13, 58]) + "Z", lk.saree, INK, 1.4) +
          D("M" + pt([3, 44]) + "L" + pt([5, 2]) + "M" + pt([9, 42]) + "L" + pt([12, 2]), null, "#000", 1.1, { "stroke-opacity": ".18" });
      } else {
        o += D("M" + pt([-12, hem + 4]) + "L" + pt([-11, 2]) + "H" + X(-2) + "L" + pt([0, 34]) + "L" + pt([2, 2]) + "H" + X(11) + "L" + pt([12, hem + 4]) + "Z", bot, INK, 1.4);
      }
      o += OV(X(-6.5), Y(1.6), 6.2 * s, 2.5 * s, "#5a4334") + OV(X(6.5), Y(1.6), 6.2 * s, 2.5 * s, "#5a4334");
      o += D("M" + pt([-14, hem]) + "L" + pt([-16, 84]) + "Q" + pt([-16, 92]) + " " + pt([-8, 93]) + "H" + X(8) + "Q" + pt([16, 92]) + " " + pt([16, 84]) + "L" + pt([14, hem]) + "Z", top, INK, 1.4);
      o += D("M" + pt([5, hem]) + "L" + pt([7, 93]) + "H" + X(8) + "Q" + pt([16, 92]) + " " + pt([16, 84]) + "L" + pt([14, hem]) + "Z", "#000", 0, 0, { "fill-opacity": ".07" });
      if (lk.saree) o += D("M" + pt([9, 93]) + "L" + pt([-14, 58]) + "L" + pt([-5, 55]) + "L" + pt([15, 86]) + "Z", lk.saree, INK, 1.2);
      if (lk.kurta) o += D("M" + pt([0, 92]) + "V" + Y(76), null, INK, 1.1, { "stroke-opacity": ".45" });
      if (lk.collar) o += D("M" + pt([-6, 93]) + "L" + pt([0, 86]) + "L" + pt([6, 93]), "#fff", INK, 1.1);
      if (lk.gamcha) o += D("M" + pt([-15, 90]) + "Q" + pt([-8, 97]) + " " + pt([-2, 93]) + "L" + pt([-8, 64]) + "L" + pt([-15, 66]) + "Z", "#ecd7a6", INK, 1.1) +
        D("M" + pt([-12, 82]) + "L" + pt([-5, 84]) + "M" + pt([-13, 74]) + "L" + pt([-6, 76]), null, "#b5513a", 1.4);
      function arm(sx, p) {
        var d = "M" + X(sx) + " " + Y(86) + "L" + pt(p[0]) + "L" + pt(p[1]);
        return D(d, null, INK, 7 * s + 2.6) + D(d, null, top, 7 * s) + C(X(p[1][0]), Y(p[1][1]), 3.7 * s, lk.skin, INK, 1.2);
      }
      var raisedL = pz.l[1][1] > 95, raisedR = pz.r[1][1] > 95;
      if (!raisedL) o += arm(-13, pz.l);
      if (!raisedR) o += arm(13, pz.r);
      if (opt.clip) o += B(X(-10), Y(84), 20 * s, 26 * s, 2, "#fff", INK, 1.3) + B(X(-4), Y(86), 8 * s, 4 * s, 1, "#8a6a48", 0) +
        D("M" + pt([-6, 76]) + "H" + X(6) + "M" + pt([-6, 70]) + "H" + X(4) + "M" + pt([-6, 64]) + "H" + X(5), null, INK, 1, { "stroke-opacity": ".4" });
      if (opt.card) o += B(X(-11), Y(80), 22 * s, 15 * s, 2.5, "#fff", GRN, 1.4) + C(X(-5), Y(73), 3 * s, "#cfe6d6", 0) +
        D("M" + pt([1, 75]) + "H" + X(7) + "M" + pt([1, 71]) + "H" + X(6), null, GRN, 1.2);
      if (opt.phoneFront) o += phoneAt(x, Y(72), s);
      o += B(X(-3.5), Y(99), 7 * s, 8 * s, 0, lk.skin, 0) + C(X(10.6), Y(108), 2.3 * s, lk.skin, INK, 1) + C(x, Y(109), 11 * s, lk.skin, INK, 1.4);
      if (lk.hat !== "pheta") o += D("M" + pt([-11, 110]) + "Q" + pt([-11.5, 122]) + " " + pt([0, 122]) + "Q" + pt([11.5, 122]) + " " + pt([11, 110]) + "Q" + pt([3, 115]) + " " + pt([-11, 110]) + "Z", HAIR, INK, 1.1);
      if (lk.hair === "bun") o += C(X(-10), Y(117), 4.6 * s, HAIR, INK, 1.1);
      if (lk.hat === "topi") o += D("M" + pt([-12, 113]) + "L" + pt([-9.5, 124]) + "Q" + pt([0, 126]) + " " + pt([9.5, 124]) + "L" + pt([12, 113]) + "Q" + pt([0, 116.5]) + " " + pt([-12, 113]) + "Z", "#fbfaf4", INK, 1.2) +
        D("M" + pt([-1, 125]) + "L" + pt([1, 117]), null, INK, 1, { "stroke-opacity": ".4" });
      if (lk.hat === "pheta") o += D("M" + pt([-11, 112]) + "Q" + pt([-19, 104]) + " " + pt([-17, 90]) + "L" + pt([-12, 92]) + "Q" + pt([-13, 103]) + " " + pt([-8, 110]) + "Z", lk.hatc, INK, 1.1) +
        D("M" + pt([-13, 110]) + "Q" + pt([-15, 125]) + " " + pt([-2, 128]) + "Q" + pt([12, 129]) + " " + pt([13, 112]) + "Q" + pt([0, 116]) + " " + pt([-13, 110]) + "Z", lk.hatc, INK, 1.2) +
        D("M" + pt([-12, 118]) + "Q" + pt([0, 123]) + " " + pt([12, 118]) + "M" + pt([-10, 124]) + "Q" + pt([2, 127]) + " " + pt([10, 122]), null, "#000", 1, { "stroke-opacity": ".18" });
      if (lk.hat === "cap") o += D("M" + pt([-11.5, 111]) + "Q" + pt([-11.5, 124]) + " " + pt([0, 124]) + "Q" + pt([11.5, 124]) + " " + pt([11.5, 111]) + "Z", lk.hatc, INK, 1.2) +
        D("M" + pt([4, 112]) + "L" + pt([20, 111]) + "Q" + pt([14, 116]) + " " + pt([4, 116]) + "Z", lk.hatc, INK, 1.1);
      if (raisedL) o += arm(-13, pz.l);
      if (raisedR) o += arm(13, pz.r);
      if (opt.phone) o += phoneAt(X(pz.r[1][0]), Y(pz.r[1][1]) - 3 * s, s);
      return o;
    }
    function phoneAt(x, y, s) {
      s = s || 1;
      return B(x - 3.8 * s, y - 7 * s, 7.6 * s, 13.5 * s, 1.8 * s, "#25313b", 0) + B(x - 2.6 * s, y - 5.4 * s, 5.2 * s, 9 * s, 1, "#a7dcc0", 0);
    }
    function bust(look, id) {
      return '<svg viewBox="0 0 64 64" aria-hidden="true"><defs><clipPath id="' + id + '"><circle cx="32" cy="32" r="31"/></clipPath></defs>' +
        '<circle cx="32" cy="32" r="31" fill="#eaf4ec"/><g clip-path="url(#' + id + ')">' + person(32, 116, 0.75, look, "stand") + "</g></svg>";
    }

    /* ----- places and things ----- */
    function land(o) {
      o = o || {};
      return D("M0 236Q60 214 130 226T260 220T390 214T480 224V320H0Z", "#d9e8cf", 0) +
        D("M0 252Q140 238 260 250T480 246V320H0Z", "#c6deb3", 0) + B(0, 268, 480, 52, 0, SOIL, 0) +
        D("M0 268H480", null, "#000", 1, { "stroke-opacity": ".06" }) + (o.night ? nightSky() : "");
    }
    function aerial() { return B(0, 92, 480, 228, 0, "#d6e8c8", 0) + D("M0 92H480", null, "#000", 1, { "stroke-opacity": ".06" }); }
    function sun(p) { return '<g class="rs-sun" style="transform:translate(' + p[0] + "px," + p[1] + 'px)">' + C(0, 0, 30, "#f8d36b", 0, 0, { "fill-opacity": ".22" }) + C(0, 0, 18, "#f8d36b", 0) + "</g>"; }
    function nightSky() {
      var s = '<g class="rs-night">' + B(0, 0, 480, 320, 0, "#14243b", 0, 0, { "fill-opacity": ".32" }) +
        D("M406 40a20 20 0 1 0 22 26a16 16 0 1 1 -22 -26z", "#f4ecd2", 0);
      [[60, 30], [120, 54], [190, 24], [250, 60], [320, 30], [350, 80], [450, 110], [30, 90]].forEach(function (p) { s += C(p[0], p[1], 1.6, "#fff", 0); });
      return s + "</g>";
    }
    function trellis(x0, x1, yb, bare) {
      var s = "", x;
      for (x = x0; x <= x1; x += 44) s += B(x - 2, yb - 58, 4, 58, 1, "#8a6a48", 0);
      s += D("M" + x0 + " " + (yb - 52) + "H" + x1 + "M" + x0 + " " + (yb - 38) + "H" + x1, null, "#6b5640", 1, { "stroke-opacity": ".6" });
      if (bare) {
        for (x = x0 + 6; x < x1; x += 22) s += D("M" + x + " " + (yb - 52) + "q8 -16 20 -10M" + x + " " + (yb - 52) + "q-6 -14 -16 -12", null, "#7a5a3a", 1.6);
      } else {
        for (x = x0 + 8; x < x1; x += 22) s += OV(x, yb - 50, 14, 8, LEAF) + OV(x + 9, yb - 44, 10, 6, LEAFD, { "fill-opacity": ".55" });
        for (x = x0 + 16; x < x1; x += 44) s += bunch(x, yb - 38);
      }
      return s;
    }
    function bunch(x, y, c) { c = c || "#a6c96a"; return C(x, y, 2.7, c, 0) + C(x - 3, y + 4, 2.7, c, 0) + C(x + 3, y + 4, 2.7, c, 0) + C(x, y + 8, 2.7, c, 0) + C(x - 1.5, y + 12, 2.4, c, 0); }
    function pom(x, y, r, spots) {
      var s = OV(x, y + 1, r * 1.1, 3, "#3a2a14", { "fill-opacity": ".12" }) + C(x, y - r, r, LEAFD, 0) + C(x - r * 0.35, y - r * 1.2, r * 0.72, LEAF, 0) + C(x + r * 0.45, y - r * 0.9, r * 0.55, LEAF, 0);
      [[0.3, 0.8], [-0.4, 0.6], [0.1, 1.45]].forEach(function (f) { s += C(x + f[0] * r, y - f[1] * r, r * 0.2, "#c0392b", 0); });
      if (spots) s += C(x - r * 0.5, y - r * 1.25, 2.4, "#6b3f1d", 0) + C(x + r * 0.2, y - r * 1.5, 2, "#6b3f1d", 0) + C(x + r * 0.6, y - r * 1.1, 2.2, "#6b3f1d", 0);
      return s;
    }
    function house(x, y) {
      return B(x, y - 62, 86, 62, 0, "#f4ead8", INK, 1.4) + D("M" + (x - 9) + " " + (y - 62) + "L" + (x + 43) + " " + (y - 94) + "L" + (x + 95) + " " + (y - 62) + "Z", "#c96d43", INK, 1.4) +
        D("M" + (x + 8) + " " + (y - 72) + "H" + (x + 78) + "M" + (x + 24) + " " + (y - 82) + "H" + (x + 62), null, "#8a3f22", 1.2, { "stroke-opacity": ".6" }) +
        B(x + 36, y - 38, 16, 38, 1, "#8a5a3a", INK, 1.2) + B(x + 10, y - 46, 15, 13, 1, "#cfe3f1", INK, 1.1) + B(x + 62, y - 46, 15, 13, 1, "#cfe3f1", INK, 1.1);
    }
    function town(x0, y) {
      var s = "", blocks = [[x0, 118, 40, "#e7ebf1"], [x0 + 44, 150, 38, "#dfe4ed"], [x0 + 86, 104, 34, "#ece5da"], [x0 + 124, 132, 40, "#e3e8ef"]];
      blocks.forEach(function (b) {
        s += B(b[0], y - b[1], b[2], b[1], 0, b[3], INK, 1.3);
        for (var yy = y - b[1] + 10; yy < y - 14; yy += 16) for (var xx = b[0] + 6; xx < b[0] + b[2] - 7; xx += 11) s += B(xx, yy, 6, 8, 1, "#c4d3e4", 0);
      });
      return s;
    }
    function cloud(x, y, s) { s = s || 1; return D("M" + (x - 30 * s) + " " + y + "a14 14 0 0 1 8 -26a19 19 0 0 1 35 -5a14 14 0 0 1 19 16a10 10 0 0 1 -3 15z", "#fff", "#9fb3c4", 1.6); }
    function rain(x, y) { var s = ""; for (var i = -2; i <= 2; i++) s += D("M" + (x + i * 12) + " " + (y + 6) + "l-5 12", null, WATER, 1.8, { "stroke-opacity": ".8" }); return s; }
    function ring(x, y) { return '<g class="ring">' + D("M" + (x + 8) + " " + (y - 8) + "a11 11 0 0 1 0 16M" + (x + 13) + " " + (y - 13) + "a18 18 0 0 1 0 26", null, AMB, 2) + "</g>"; }
    var TONE = { amb: [AMB, "#fff8ee"], red: [RED, "#fff1ee"], ink: ["#55665c", "#ffffff"], grn: [GRN, "#f1faf3"] };
    function bub(x, y, w, h, tx, ty, inner, tone) {
      var t = TONE[tone || "amb"], bx = Math.max(x + 10, Math.min(x + w - 22, tx - 6));
      return D("M" + (x + 10) + " " + y + "H" + (x + w - 10) + "Q" + (x + w) + " " + y + " " + (x + w) + " " + (y + 10) + "V" + (y + h - 10) + "Q" + (x + w) + " " + (y + h) + " " + (x + w - 10) + " " + (y + h) +
        "H" + (bx + 12) + "L" + tx + " " + ty + "L" + bx + " " + (y + h) + "H" + (x + 10) + "Q" + x + " " + (y + h) + " " + x + " " + (y + h - 10) + "V" + (y + 10) + "Q" + x + " " + y + " " + (x + 10) + " " + y + "Z", t[1], t[0], 1.8) + (inner || "");
    }
    function think(x, y, w, h, tx, ty, inner, tone) {
      var t = TONE[tone || "amb"];
      return B(x, y, w, h, h / 2, t[1], t[0], 1.8) + C(tx + (x + w / 2 - tx) * 0.45, ty - (ty - y - h) * 0.45, 5, t[1], t[0], 1.6) + C(tx, ty, 3, t[1], t[0], 1.4) + (inner || "");
    }
    function q(x, y, r) { r = r || 10; return '<g class="wob">' + C(x, y, r, AMB, "#fff", 2) + TX(x, y + r * 0.45, "?", r * 1.3, "#fff") + "</g>"; }
    function bang(x, y, r) { r = r || 10; return '<g class="wob">' + C(x, y, r, RED, "#fff", 2) + TX(x, y + r * 0.45, "!", r * 1.3, "#fff") + "</g>"; }
    function ok(x, y, r) {
      r = r || 9;
      return C(x, y, r, GRN, "#fff", 1.6) + D("M" + r2(x - r * 0.42) + " " + r2(y + r * 0.02) + "l" + r2(r * 0.3) + " " + r2(r * 0.32) + "l" + r2(r * 0.56) + " " + r2(-r * 0.6), null, "#fff", Math.max(1.6, r * 0.22));
    }
    function flag(x, y) { return C(x, y, 9, "#fff6e6", AMB, 1.5) + D("M" + (x - 3) + " " + (y + 5) + "V" + (y - 5) + "L" + (x + 5) + " " + (y - 2.5) + "L" + (x - 3) + " " + y, AMB, 0); }
    function glyph(n, x, y, c) {
      c = c || GRN;
      switch (n) {
        case "drop": return D("M" + x + " " + (y - 6) + "q5.5 6.5 0 11q-5.5 -4.5 0 -11z", c, 0);
        case "people": return C(x - 3, y - 2.5, 2.4, c, 0) + C(x + 3.5, y - 2.5, 2.4, c, 0) + D("M" + (x - 7.5) + " " + (y + 5) + "q4.5 -6 9 0M" + (x - 1) + " " + (y + 5) + "q4.5 -6 9 0", null, c, 1.6);
        case "cal": return B(x - 5.5, y - 5, 11, 10.5, 1.8, null, c, 1.4) + D("M" + (x - 5.5) + " " + (y - 1.5) + "H" + (x + 5.5), null, c, 1.4);
        case "spray": return B(x - 3.5, y - 2, 7, 8.5, 1.8, c, 0) + D("M" + x + " " + (y - 2) + "V" + (y - 5) + "H" + (x + 4.5), null, c, 1.4) + C(x + 6.5, y - 6.5, 0.9, c, 0) + C(x + 7, y - 3.5, 0.9, c, 0);
        case "scissors": return secateurs(x, y, c, 0.55);
        case "leaf": return D("M" + (x - 5) + " " + (y + 5) + "q0 -10 10 -10q0 10 -10 10z", c, 0) + D("M" + (x - 5) + " " + (y + 5) + "l6 -6", null, "#fff", 1);
        case "play": return D("M" + (x - 3) + " " + (y - 5) + "L" + (x + 5) + " " + y + "L" + (x - 3) + " " + (y + 5) + "Z", c, 0);
        case "bottle": return B(x - 3.5, y - 2.5, 7, 9, 1.8, c, 0) + B(x - 1.6, y - 6, 3.2, 3.5, 0.6, c, 0);
        case "cup": return D("M" + (x - 4.5) + " " + (y - 4) + "H" + (x + 4.5) + "L" + (x + 3) + " " + (y + 5) + "H" + (x - 3) + "Z", null, c, 1.5) + D("M" + (x - 3.6) + " " + y + "H" + (x + 3.6), null, c, 1.2);
        case "cloud": return D("M" + (x - 6) + " " + (y + 3) + "a3.5 3.5 0 0 1 1 -7a5 5 0 0 1 9 -1a3.5 3.5 0 0 1 2 8z", c, 0);
        case "id": return B(x - 6, y - 4.5, 12, 9, 1.5, null, c, 1.3) + C(x - 2.5, y - 0.5, 1.8, c, 0) + D("M" + (x + 1) + " " + (y - 1.5) + "H" + (x + 4) + "M" + (x + 1) + " " + (y + 1.5) + "H" + (x + 3.5), null, c, 1.1);
        case "phone": return B(x - 3.5, y - 6, 7, 12, 1.5, null, c, 1.4);
        case "check": return C(x, y, 6.5, c, 0) + D("M" + (x - 3) + " " + y + "l2.2 2.4l4 -4.6", null, "#fff", 1.6);
        default: return "";
      }
    }
    function card(x, y, w, title, rows) {
      var h = 36 + rows.length * 24, s = B(x + 3, y + 5, w, h, 12, "#0a4a2b", 0, 0, { "fill-opacity": ".1" }) + B(x, y, w, h, 12, "#fff", GRN, 1.8) +
        D("M" + x + " " + (y + 12) + "Q" + x + " " + y + " " + (x + 12) + " " + y + "H" + (x + w - 12) + "Q" + (x + w) + " " + y + " " + (x + w) + " " + (y + 12) + "V" + (y + 26) + "H" + x + "Z", GRN, 0) +
        TX(x + 12, y + 18, title, 12, "#fff", 800, "start");
      rows.forEach(function (r, i) {
        var yy = y + 44 + i * 24;
        s += C(x + 19, yy - 4, 9, MINT, 0) + glyph(r[0], x + 19, yy - 4, GRN) + TX(x + 34, yy, r[1], 12, INK, 700, "start") +
          (r[2] === "flag" ? flag(x + w - 17, yy - 4) : r[2] === "none" ? "" : ok(x + w - 17, yy - 4, 7.5));
      });
      return s;
    }
    function register(x, y, w, h, inner) {
      return B(x, y, w, h, 3, "#fff", INK, 1.4) + D("M" + (x + w / 2) + " " + y + "V" + (y + h), null, INK, 1.2, { "stroke-opacity": ".5" }) +
        D("M" + (x + 6) + " " + (y + 12) + "H" + (x + w / 2 - 6) + "M" + (x + 6) + " " + (y + 22) + "H" + (x + w / 2 - 8) + "M" + (x + 6) + " " + (y + 32) + "H" + (x + w / 2 - 6) +
          "M" + (x + w / 2 + 6) + " " + (y + 12) + "H" + (x + w - 6) + "M" + (x + w / 2 + 6) + " " + (y + 22) + "H" + (x + w - 8), null, INK, 1, { "stroke-opacity": ".3" }) + (inner || "");
    }
    function receipt(x, y, rot) {
      return '<g transform="rotate(' + rot + " " + (x + 13) + " " + (y + 17) + ')">' + D("M" + x + " " + y + "H" + (x + 26) + "V" + (y + 34) + "l-4 -3l-4 3l-5 -3l-4 3l-5 -3l-4 3z", "#fff", INK, 1.2) +
        D("M" + (x + 5) + " " + (y + 8) + "H" + (x + 21) + "M" + (x + 5) + " " + (y + 15) + "H" + (x + 18) + "M" + (x + 5) + " " + (y + 22) + "H" + (x + 20), null, INK, 1, { "stroke-opacity": ".35" }) + "</g>";
    }
    function sack(x, y) {
      return D("M" + (x - 16) + " " + y + "Q" + (x - 19) + " " + (y - 26) + " " + (x - 12) + " " + (y - 40) + "L" + (x - 7) + " " + (y - 46) + "H" + (x + 7) + "L" + (x + 12) + " " + (y - 40) + "Q" + (x + 19) + " " + (y - 26) + " " + (x + 16) + " " + y + "Z", "#f1ead9", INK, 1.4) +
        B(x - 15, y - 26, 30, 11, 0, "#3f9d68", 0, 0, { "fill-opacity": ".85" }) + D("M" + (x - 8) + " " + (y - 46) + "q8 -5 16 0", null, INK, 1.2);
    }
    function crate(x, y) {
      return B(x, y - 24, 36, 24, 2, "#2f7f8f", INK, 1.3) + D("M" + (x + 4) + " " + (y - 14) + "H" + (x + 32) + "M" + (x + 4) + " " + (y - 8) + "H" + (x + 32), null, "#fff", 1, { "stroke-opacity": ".35" }) +
        C(x + 8, y - 26, 5, "#c0392b", 0) + C(x + 18, y - 27, 5.5, "#b5332a", 0) + C(x + 28, y - 26, 5, "#c0392b", 0);
    }
    function truck(x, y) {
      return OV(x + 62, y + 2, 66, 5, "#3a2a14", { "fill-opacity": ".12" }) + B(x, y - 48, 96, 36, 3, "#f3efe4", INK, 1.4) + crate(x + 6, y - 48) + crate(x + 50, y - 48) +
        D("M" + (x + 96) + " " + (y - 12) + "V" + (y - 46) + "H" + (x + 116) + "L" + (x + 130) + " " + (y - 28) + "V" + (y - 12) + "Z", "#e2b33c", INK, 1.4) +
        B(x + 100, y - 42, 15, 12, 2, "#cfe3f1", INK, 1.1) + B(x, y - 14, 130, 4, 1, "#55605a", 0) +
        C(x + 22, y - 6, 9, "#2b2b2b", INK, 1.2) + C(x + 22, y - 6, 3.5, "#bbb", 0) + C(x + 106, y - 6, 9, "#2b2b2b", INK, 1.2) + C(x + 106, y - 6, 3.5, "#bbb", 0);
    }
    function barrier(x, y, open) {
      var arm = open ? '<g transform="rotate(70 ' + x + " " + (y - 50) + ')">' : "<g>";
      return B(x - 4, y - 56, 8, 56, 2, "#55605a", INK, 1.2) + arm + B(x - 74, y - 54, 74, 8, 3, "#fff", RED, 1.6) +
        D("M" + (x - 64) + " " + (y - 54) + "l-6 8M" + (x - 44) + " " + (y - 54) + "l-6 8M" + (x - 24) + " " + (y - 54) + "l-6 8", null, RED, 3) + "</g>";
    }
    function secateurs(x, y, c, s) {
      s = s || 1; c = c || INK;
      return '<g transform="translate(' + x + " " + y + ") scale(" + s + ')">' + D("M-2 -2L-9 -15Q-6 -16 -3 -13L2 -3", c, 0) + D("M2 -2L9 -15Q6 -16 3 -13L-2 -3", c, 0, 0, { "fill-opacity": ".75" }) +
        D("M-2 0Q-9 6 -10 14", null, c, 3.2) + D("M2 0Q9 6 10 14", null, c, 3.2) + C(0, -1, 1.6, "#fff", 0) + "</g>";
    }
    function magnifier(x, y, r, inner) {
      return D("M" + (x + r * 0.7) + " " + (y + r * 0.7) + "L" + (x + r * 1.35) + " " + (y + r * 1.35), null, "#55605a", 5) + C(x, y, r, "#fffdf6", INK, 2) + (inner || "") + C(x, y, r, null, INK, 2);
    }
    function eyeOff(x, y) {
      return C(x, y, 17, "#fff1ee", RED, 2) + D("M" + (x - 10) + " " + y + "q10 -10 20 0q-10 10 -20 0z", null, RED, 1.8) + C(x, y, 3.2, RED, 0) + D("M" + (x - 10) + " " + (y + 10) + "L" + (x + 10) + " " + (y - 10), null, RED, 2.2);
    }
    function link(d, solved) {
      return solved ? D(d, null, GRN, 2.4, { pathLength: 1, "class": "draw" }) : D(d, null, AMB, 1.9, { "stroke-dasharray": "5 6", "class": "ants" });
    }
    function wrap(inner) { return '<svg viewBox="0 0 480 320" aria-hidden="true">' + inner + "</svg>"; }

    /* ----- the eight stories ----- */
    var STORIES = {
      control: function () {
        var cardRows = [["drop", say("पाणी · प्लॉट २ · सकाळी", "Water · plot 2 · morning")], ["people", say("हजेरी · ६ जण", "Attendance · 6 people")], ["cal", say("उद्या · फवारणी", "Tomorrow · spraying")]];
        return {
          tag: say("३ फोन, ३ उत्तरं", "3 calls, 3 answers"), fix: say("एकच खरी नोंद", "One true record"),
          sky: ["morning", "noon", "evening"], skyS: "calm", sun: [[70, 70], [250, 40], [438, 92], [372, 52]],
          focus: [[16, 60], [80, 60], [45, 46]],
          svg: wrap(land() + trellis(14, 280, 262) + house(372, 292) +
            P(OV(176, 238, 84, 22, "#fff", { "fill-opacity": ".78" }) + q(176, 236, 9), 1) +
            person(66, 294, 0.9, "mukadam", "phone", { phone: 1 }) + person(344, 294, 0.86, "family", "phone", { phone: 1 }) + person(424, 296, 0.78, "son", "stand") +
            P(person(214, 298, 1.08, "owner", "phone", { phone: 1 })) + S(person(214, 298, 1.08, "owner", "hold", { phoneFront: 1 }), 0.1) +
            P(ring(225, 184) + link("M224 182Q150 120 76 197") + bub(18, 122, 104, 36, 74, 180, TX(70, 145, say("हो, दिलं!", "Yes, done!"), 15, AMB)), 1) +
            P(link("M228 180Q290 128 352 200") + bub(296, 124, 46, 38, 346, 184, TX(319, 150, num(5), 19, AMB)) + bub(392, 138, 46, 38, 422, 196, TX(415, 164, num(6), 19, RED, 800), "red"), 2) +
            P(B(172, 30, 84, 24, 12, "#fff", AMB, 1.5) + glyph("phone", 188, 42, AMB) + TX(226, 47, say("हो", "Yes"), 13, AMB) +
              B(172, 60, 84, 24, 12, "#fff", AMB, 1.5) + glyph("phone", 188, 72, AMB) + TX(226, 77, num(5), 13, AMB) +
              B(172, 90, 84, 24, 12, "#fff", RED, 1.5) + glyph("phone", 188, 102, RED) + TX(226, 107, num(6), 13, RED) + q(214, 140, 13), 3) +
            S(card(148, 22, 196, say("आजची नोंद · पवार मळा", "Today · Pawar farm"), cardRows), 0.1) +
            S(link("M168 130Q110 150 70 182", 1) + link("M330 130Q350 150 344 186", 1) + link("M240 130V196", 1), 0.3) +
            S(ok(92, 176, 9) + ok(372, 182, 9) + ok(244, 204, 9), 0.7))
        };
      },
      decide: function () {
        var s = land();
        for (var x = 120; x < 470; x += 26) s += D("M" + x + " 262q-5 -9 -10 -9q5 0 10 9q5 -9 10 -9q-5 0 -10 9", LEAF, LEAFD, 1);
        return {
          tag: say("निर्णय अंदाजावर", "Decisions on a guess"), fix: say("प्लॉटनुसार माप", "Measured, plot by plot"),
          sky: ["morning", "morning", "noon"], skyS: "calm", sun: [[90, 62], [110, 54], [250, 40], [300, 46]],
          focus: [[30, 28], [72, 72], [86, 30]],
          svg: wrap(s + sack(40, 292) + sack(78, 294) +
            P(person(206, 296, 1.08, "grower", "think")) + S(person(206, 296, 1.08, "grower", "hold", { phoneFront: 1 }), 0.1) +
            P(think(24, 30, 192, 100, 196, 162, B(46, 48, 58, 62, 6, "#fff", "#9aa59e", 1.5, { "stroke-dasharray": "3 3" }) + TX(75, 72, say("मागचं", "Last"), 11, "#7d8a82", 700) + TX(75, 88, say("वर्ष", "year"), 11, "#7d8a82", 700) +
              D("M58 98H92", null, "#9aa59e", 1.2, { "stroke-dasharray": "2 3" }) + sack(140, 112) + q(186, 64, 12)), 1) +
            P(register(292, 236, 66, 44, TX(325, 262, "₹ ?", 12, AMB)) + receipt(330, 176, -14) + receipt(372, 194, 12) +
              B(404, 248, 18, 30, 3, "#25313b", 0) + B(406, 251, 14, 22, 1, "#a7dcc0", 0) + C(432, 236, 9, "#fff8ee", AMB, 1.5) + TX(432, 240, "₹", 11, AMB), 2) +
            P('<g transform="rotate(-13 402 74)">' + D("M346 74H458", null, INK, 2.6) + D("M346 74l-15 26h30zM458 74l-15 26h30z", MINT, INK, 1.5) +
              B(337, 84, 16, 16, 3, "#fff", INK, 1.3) + C(341, 88, 1.4, INK, 0) + C(349, 96, 1.4, INK, 0) + C(345, 92, 1.4, INK, 0) + TX(458, 96, "?", 15, AMB) + "</g>" +
              D("M402 74V150", null, INK, 2.6) + D("M386 150H418", null, INK, 2.6) + q(402, 48, 10), 3) +
            S(B(268, 26, 194, 128, 12, "#0a4a2b", 0, 0, { "fill-opacity": ".1" }) + B(265, 22, 194, 128, 12, "#fff", GRN, 1.8) +
              D("M265 34Q265 22 277 22H447Q459 22 459 34V48H265Z", GRN, 0) + TX(277, 40, say("प्लॉटनुसार खर्च", "Spending by plot"), 12, "#fff", 800, "start") +
              B(284, 70, 18, 56, 3, "#cdd8d0", 0) + B(306, 86, 18, 40, 3, GRN, 0) + B(346, 80, 18, 46, 3, "#cdd8d0", 0) + B(368, 66, 18, 60, 3, GRN, 0) +
              D("M276 126H398", null, INK, 1.2, { "stroke-opacity": ".4" }) + TX(304, 141, say("प्लॉट १", "Plot 1"), 10, INK, 700) + TX(366, 141, say("प्लॉट २", "Plot 2"), 10, INK, 700) +
              B(410, 61, 9, 9, 2, "#cdd8d0", 0) + B(410, 77, 9, 9, 2, GRN, 0), 0.15) +
            S(TX(424, 69, say("मागे", "Last"), 10, INK, 700, "start") + TX(424, 85, say("आता", "Now"), 10, INK, 700, "start"), 0.2) +
            S(ok(60, 232, 10), 0.6))
        };
      },
      plots: function () {
        var s = aerial();
        function quad(x, y) { return "M" + (x + 20) + " " + y + "H" + (x + 130) + "L" + (x + 110) + " " + (y + 58) + "H" + x + "Z"; }
        s += D(quad(176, 104), "#e9dfc6", INK, 1.4) + D(quad(320, 104), "#e9dfc6", INK, 1.4) + D(quad(156, 184), "#e9dfc6", INK, 1.4) + D(quad(300, 184), "#e9dfc6", INK, 1.4);
        for (var i = 0; i < 4; i++) { s += D("M" + (198 + i * 4) + " " + (116 + i * 12) + "H" + (288 + i * 4), null, "#6b5640", 1.2) + C(206 + i * 4, 116 + i * 12, 4, LEAF, 0) + C(232 + i * 4, 116 + i * 12, 4, LEAF, 0) + C(258 + i * 4, 116 + i * 12, 4, LEAF, 0); }
        [[356, 126], [392, 126], [428, 126], [348, 150], [384, 150], [420, 150]].forEach(function (p) { s += C(p[0], p[1], 8, LEAFD, 0) + C(p[0] + 2, p[1] - 2, 2.4, "#c0392b", 0); });
        for (var j = 0; j < 4; j++) for (var k = 0; k < 7; k++) s += D("M" + (178 + k * 14 - j * 4) + " " + (198 + j * 13) + "l-2 -7m2 7l2 -7", null, LEAFD, 1.4);
        for (var m = 0; m < 9; m++) s += D("M" + (322 + m * 11) + " " + 236 + "V" + 196, null, "#5f9a45", 2.2) + D("M" + (322 + m * 11) + " " + 210 + "l6 -6", null, "#5f9a45", 1.4);
        [[196, 114, 1], [340, 114, 2], [176, 194, 3], [320, 194, 4]].forEach(function (p) { s += C(p[0], p[1], 9, "#fff", INK, 1.3) + TX(p[0], p[1] + 4, num(p[2]), 11, INK); });
        return {
          tag: say("एक फवारणी राहून गेली", "One spray got missed"), fix: say("राहिलेलं काम वेळेत दिसतं", "Pending work, seen in time"),
          sky: ["morning", "noon", "noon"], skyS: "calm", sun: [[446, 40], [446, 40], [446, 40], [446, 40]],
          focus: [[64, 50], [18, 26], [80, 36]],
          svg: wrap(s +
            P(person(86, 300, 1.08, "woman", "head")) + S(person(86, 300, 1.08, "woman", "hold", { phoneFront: 1 }), 0.1) +
            P(C(262, 140, 14, "#fff", AMB, 2) + glyph("spray", 262, 141, AMB) + C(250, 222, 14, "#fff", AMB, 2) + glyph("drop", 250, 223, WATER) + C(394, 222, 14, "#fff", AMB, 2) + secateurs(394, 224, AMB, 0.6), 1) +
            P(think(14, 30, 132, 72, 92, 158, D("M30 64c10 -18 20 10 30 -6s16 14 26 -2s12 10 22 -4M34 80c12 -8 22 8 34 -2s14 6 24 -4s8 4 18 -2", null, AMB, 2) +
              TX(44, 52, num(1), 11, AMB) + TX(120, 54, num(3), 11, AMB) + TX(96, 92, num(4), 11, AMB)), 2) +
            P(D(quad(320, 104), null, RED, 3.4) + C(380, 128, 2.6, "#6b3f1d", 0) + C(410, 150, 2.6, "#6b3f1d", 0) + bang(450, 100, 11) +
              B(330, 70, 96, 24, 12, "#fff1ee", RED, 1.5) + TX(378, 87, say("आठवड्याने", "A week later"), 12, RED), 3) +
            S(card(8, 34, 160, say("आज काय बाकी", "Pending today"), [["spray", say("प्लॉट १ · फवारणी", "Plot 1 · spray")], ["spray", say("प्लॉट २ · फवारणी", "Plot 2 · spray"), "flag"],
              ["drop", say("प्लॉट ३ · पाणी", "Plot 3 · water")], ["scissors", say("प्लॉट ४ · छाटणी", "Plot 4 · pruning")]]), 0.1) +
            S(ok(286, 112, 10) + flag(430, 112) + ok(266, 192, 10) + ok(410, 192, 10), 0.5))
        };
      },
      city: function () {
        var s = land() + town(6, 292) + D("M150 320C220 300 236 272 300 264S368 252 392 254", null, "#e6dbc4", 16) + D("M150 320C220 300 236 272 300 264S368 252 392 254", null, "#fff", 2, { "stroke-dasharray": "7 9" }) +
          pom(356, 270, 15) + pom(398, 266, 17, 0) + pom(440, 270, 15);
        return {
          tag: say("ऐकलेलं, पाहिलेलं नाही", "Heard, never seen"), fix: say("शेत रोज फोनवर दिसतं", "The farm, seen every day"),
          sky: ["evening", "noon", "noon"], skyS: "calm", sun: [[424, 96], [250, 38], [250, 38], [300, 46]],
          focus: [[86, 52], [82, 64], [52, 58]],
          svg: wrap(s +
            P(person(122, 298, 0.98, "town", "phone", { phone: 1 })) + S(person(122, 298, 0.98, "town", "hold", { phoneFront: 1 }), 0.1) +
            person(462, 298, 0.8, "mukadam", "phone", { phone: 1 }) +
            P(ring(132, 196) + link("M132 194Q300 98 468 210") + bub(350, 104, 118, 38, 462, 190, TX(409, 129, say("सगळं ठीक!", "All well!"), 15, "#3d5a4a"), "ink"), 1) +
            P(magnifier(390, 206, 27, pom(390, 234, 14, 1)) + B(298, 236, 13, 34, 4, WATER, INK, 1.3) + D("M311 244L332 270", null, "#55605a", 2) +
              D("M298 238q8 6 13 0M300 248q6 5 10 0", null, "#9aa5ad", 1, { "stroke-opacity": ".8" }) + C(305, 226, 9, "#fff1ee", RED, 1.5) + D("M301 222l8 8M309 222l-8 8", null, RED, 1.8), 2) +
            P(D("M180 270Q190 170 250 160T330 250", "#fff", 0, 0, { "fill-opacity": ".7" }) + eyeOff(250, 204), 3) +
            S(link("M132 194Q300 98 468 210", 1), 0.15) +
            S(card(148, 20, 196, say("आजची नोंद · शेत", "Today · the farm"), [["spray", say("फवारणी · झाली", "Spraying · done")], ["leaf", say("पानांवरचे डाग · फोटो", "Leaf spots · photo")], ["play", say("मूळ आवाज ऐका", "Play the original voice"), "none"]]), 0.35) +
            S(ok(356, 232, 8) + ok(398, 226, 8) + ok(440, 232, 8), 0.7))
        };
      },
      schedule: function () {
        var cols = [], s = land() + trellis(330, 474, 262);
        for (var i = 0; i < 7; i++) cols.push(92 + 14 + i * 28);
        var chart = B(14, 26, 304, 242, 6, "#f3ead9", "#d8c7a6", 1.4) + B(36, 50, 254, 166, 6, "#fff", INK, 1.5) +
          D("M36 62Q36 50 48 50H278Q290 50 290 62V74H36Z", MINT, 0) + TX(48, 67, say("प्लॉट ३: पाणी", "Plot 3: water"), 12, GRN, 800, "start") +
          glyph("drop", 56, 112, GRN) + TX(56, 132, say("मागचं वर्ष", "Last year"), 10, INK, 700) + glyph("drop", 56, 172, GRN) + TX(56, 190, say("यंदा", "This year"), 10, INK, 700) + D("M92 150H290", null, INK, 1, { "stroke-opacity": ".2" });
        cols.forEach(function (c, k) { chart += D("M" + (c + 14) + " 82V216", null, INK, 1, { "stroke-opacity": ".12" }) + TX(c, 96, num(k + 1), 10, "#7d8a82", 700); });
        chart += C(cols[1], 120, 8, "#fff", GRN, 2, { "stroke-dasharray": "3 3" }) + C(cols[4], 120, 8, "#fff", GRN, 2, { "stroke-dasharray": "3 3" }) + C(cols[1], 176, 8, GRN, 0);
        return {
          tag: say("शिकलेलं, पण लिहिलेलं नाही", "Learnt, but never written"), fix: say("जमिनीची शिकवण नोंदीत", "What the land taught, on the record"),
          sky: ["morning", "rain", "dawn"], skyS: "calm", sun: [[440, 62], [440, 62], [96, 300], [420, 54]],
          focus: [[34, 30], [56, 54], [76, 40]],
          svg: wrap(s +
            P(B(52, 40, 254, 166, 6, "#fbf8f1", "#c9bfa9", 1.4, { transform: "rotate(-3 180 120)" }) + TX(270, 66, say("पुढचा हंगाम", "Next season"), 10, "#9a8f78", 700, "end"), 3) +
            chart +
            P(C(162, 46, 7, RED, INK, 1) + D("M162 53V62", null, INK, 1.8) + D("M290 196l-20 20h20z", "#efe7d6", INK, 1.2), 1) +
            P(cloud(430, 64) + rain(430, 64) + C(cols[6], 176, 8, AMB, 0) + D("M" + (cols[4] + 9) + " 128L" + (cols[6] - 8) + " 168", null, AMB, 2, { "stroke-dasharray": "4 4" }) +
              D("M" + (cols[6] - 14) + " 164l7 5l1 -8", null, AMB, 2) +
              B(120, 222, 120, 40, 4, "#fbe7b8", AMB, 1.5, { transform: "rotate(-3 180 242)" }) + TX(168, 247, say("का बदललं?", "Why the change?"), 13, AMB) + q(222, 240, 10), 2) +
            P(person(392, 296, 1.04, "elder", "pointL")) + S(person(392, 296, 1.04, "elder", "hold", { phoneFront: 1 }), 0.1) +
            P(bub(300, 104, 128, 38, 388, 160, TX(364, 128, say("मागे काय बदललं?", "What changed last time?"), 12, AMB)), 3) +
            S(link("M" + (cols[4] + 9) + " 128L" + (cols[6] - 8) + " 168", 1) + C(cols[6], 176, 8, GRN, 0) + ok(cols[1], 120, 8) + ok(cols[1], 176, 8), 0.15) +
            S(card(110, 226, 190, say("बदल · कारणासह", "Change · with the reason"), [["cloud", say("पाऊस · २ दिवस पुढे", "Rain · moved 2 days")], ["people", say("सुचवलं · स्वीकारलं", "Suggested · accepted")]]), 0.4))
        };
      },
      wages: function () {
        var s = land(), week = "";
        for (var d = 0; d < 7; d++) {
          var x = 150 + d * 28;
          week += B(x, 54, 22, 22, 4, d < 4 ? "#fff" : "#fffaf0", d < 4 ? INK : AMB, 1.4, d < 4 ? null : { "stroke-dasharray": "3 3" }) + TX(x + 11, 48, num(d + 1), 10, "#7d8a82", 700) +
            (d < 4 ? D("M" + (x + 6) + " 65l4 4l7 -8", null, INK, 1.8) : TX(x + 11, 70, "?", 12, AMB));
        }
        var att = "";
        for (var e = 0; e < 7; e++) { var xx = 150 + e * 28; att += B(xx, 64, 22, 22, 4, e === 3 ? "#fff" : MINT, GRN, 1.3) + (e === 3 ? "" : D("M" + (xx + 6) + " 75l4 4l7 -8", null, GRN, 1.8)) + TX(xx + 11, 100, num(e + 1), 10, "#7d8a82", 700); }
        return {
          tag: say("६ दिवस की ७?", "6 days or 7?"), fix: say("एकच हजेरी, दोघांना दिसते", "One attendance, both see it"),
          sky: ["noon", "noon", "evening"], skyS: "calm", sun: [[86, 58], [250, 40], [424, 92], [372, 52]],
          focus: [[50, 20], [52, 52], [54, 50]],
          svg: wrap(s +
            P(person(244, 286, 0.9, "worker", "shrug")) + S(person(244, 286, 0.9, "worker", "hold", { card: 1 }), 0.1) +
            B(170, 236, 150, 10, 3, "#b98a5a", INK, 1.4) + B(182, 246, 8, 46, 2, "#9a6f45", 0) + B(300, 246, 8, 46, 2, "#9a6f45", 0) +
            register(186, 214, 62, 26) + B(262, 222, 34, 14, 2, "#7fbf8a", INK, 1.1) + B(266, 218, 34, 14, 2, "#8fcf9a", INK, 1.1) + TX(283, 229, "₹", 10, "#24543a") +
            person(104, 298, 1.04, "owner", "point") + person(386, 298, 1.04, "mukadam", "pointL") +
            P(TX(140, 70, say("हजेरी", "Attendance"), 12, INK, 800, "end") + week + C(378, 158, 3.5, "#fff8ee", AMB, 1.4) + C(366, 138, 5, "#fff8ee", AMB, 1.4) + C(350, 114, 7, "#fff8ee", AMB, 1.4) +
              D("M344 104L332 84", null, AMB, 1.6, { "stroke-dasharray": "3 4" }), 1) +
            P(C(233, 227, 9, "#fff8ee", AMB, 1.6) + TX(233, 232, num(6), 13, AMB) + bub(402, 110, 48, 40, 396, 168, TX(426, 137, num(7), 19, RED), "red") +
              D("M230 96l12 14l-10 4l14 16", null, RED, 2.8) + D("M266 96l-12 14l10 4l-14 16", null, RED, 2.8), 2) +
            P(bub(266, 146, 100, 32, 256, 176, TX(316, 167, say("माझे दिवस?", "My days?"), 13, AMB)), 3) +
            S(B(133, 25, 226, 92, 12, "#0a4a2b", 0, 0, { "fill-opacity": ".1" }) + B(130, 21, 226, 92, 12, "#fff", GRN, 1.8) +
              D("M130 33Q130 21 142 21H344Q356 21 356 33V44H130Z", GRN, 0) + TX(142, 37, say("हजेरी · हा आठवडा", "Attendance · this week"), 12, "#fff", 800, "start") + att, 0.15) +
            S(link("M150 112Q120 140 110 168", 1) + link("M340 112Q370 140 384 168", 1), 0.4) +
            S(ok(132, 166, 9) + ok(412, 166, 9), 0.7))
        };
      },
      export: function () {
        var s = land() + crate(250, 292) + crate(250, 268) + crate(212, 292) + truck(330, 292);
        return {
          tag: say("नोंद आठवणीवर", "Records from memory"), fix: say("फवारणी नोंद तयार", "Spray record ready"),
          sky: ["noon", "noon", "evening"], skyS: "calm", sun: [[300, 44], [300, 44], [424, 92], [372, 52]],
          focus: [[50, 26], [22, 52], [92, 66]],
          svg: wrap(s +
            P(person(86, 298, 1.04, "grower2", "think", { tank: 1 })) + S(person(86, 298, 1.04, "grower2", "stand", { tank: 1 }), 0.1) +
            person(178, 296, 0.96, "exporter", "hold", { clip: 1 }) +
            P(bub(152, 44, 188, 64, 184, 168, C(186, 70, 13, "#fff", AMB, 1.6) + glyph("cal", 186, 70, AMB) + TX(186, 98, say("कधी?", "When?"), 12, AMB) +
              C(246, 70, 13, "#fff", AMB, 1.6) + glyph("bottle", 246, 70, AMB) + TX(246, 98, say("कोणतं?", "Which?"), 12, AMB) +
              C(306, 70, 13, "#fff", AMB, 1.6) + glyph("cup", 306, 70, AMB) + TX(306, 98, say("किती?", "How much?"), 12, AMB)), 1) +
            P(register(8, 200, 60, 40, TX(38, 226, "?", 14, AMB)) + receipt(118, 176, -16) + receipt(126, 218, 10) + think(84, 124, 50, 30, 92, 166, TX(109, 145, "…", 16, AMB)) + q(144, 160, 9), 2) +
            P(barrier(468, 292, 0) + bang(446, 210, 11), 3) +
            S(barrier(468, 292, 1), 0.2) +
            S(card(10, 34, 198, say("फवारणी नोंद · प्लॉट २", "Spray record · plot 2"), [["cal", say("तारीख आणि वेळ", "Date and time")], ["bottle", say("औषधाचं नाव", "Product name")], ["cup", say("मात्रा", "Dose")], ["people", say("कोणी केली", "Done by")]]), 0.3) +
            S(link("M208 92Q240 120 190 180", 1) + ok(198, 200, 9) + ok(410, 216, 11), 0.6))
        };
      },
      skilled: function () {
        var s = land({ night: 1 }) + trellis(196, 474, 258, 1);
        return {
          tag: say("कोणाला छाटणी जमते?", "Who can actually prune?"), fix: say("कामाचा इतिहास नोंदीत", "Work history on record"),
          sky: ["night", "morning", "noon"], skyS: "calm", sun: [[60, 330], [80, 72], [250, 40], [300, 48]],
          focus: [[28, 46], [64, 60], [86, 36]],
          svg: wrap(s +
            P(person(86, 298, 1.04, "young", "phone", { phone: 1 })) + S(person(86, 298, 1.04, "young", "hold", { phoneFront: 1 }), 0.1) +
            P(ring(97, 186) + bub(120, 96, 138, 40, 104, 176, TX(189, 122, say("उद्या दहा माणसं!", "Ten people tomorrow!"), 13, AMB)), 1) +
            P(person(236, 292, 0.9, 0, 0, { ghost: 1 }) + person(282, 292, 0.9, 0, 0, { ghost: 1 }) + person(328, 292, 0.9, 0, 0, { ghost: 1 }) + person(374, 292, 0.9, 0, 0, { ghost: 1 }) +
              C(306, 150, 15, "#fff", AMB, 1.8) + secateurs(306, 153, AMB, 0.75) + q(326, 136, 9), 2) +
            P(magnifier(420, 118, 30, D("M394 130Q418 116 448 108", null, "#7a5a3a", 3.2) + D("M422 102L434 126", null, RED, 3.4) + bunch(408, 126, "#c9d6b8")) + bang(456, 86, 10), 3) +
            S(person(236, 292, 0.9, "worker", "hold", { card: 1 }) + person(282, 292, 0.9, "wworker", "hold", { card: 1 }) + person(328, 292, 0.9, "worker2", "hold", { card: 1 }) + person(374, 292, 0.9, "son", "hold", { card: 1 }), 0.15) +
            S(C(236, 166, 11, "#fff", GRN, 1.6) + secateurs(236, 168, GRN, 0.55) + C(328, 166, 11, "#fff", GRN, 1.6) + secateurs(328, 168, GRN, 0.55), 0.5) +
            S(card(124, 22, 200, say("कामाचा इतिहास", "Work history"), [["scissors", say("छाटणीचं काम · नोंदीत", "Pruning work · on record")], ["id", say("कायमचा ओळख क्रमांक", "Permanent worker ID")]]), 0.7))
        };
      }
    };
    var BUST = { control: "owner", decide: "grower", plots: "woman", city: "town", schedule: "elder", wages: "mukadam", export: "grower2", skilled: "young" };
    return { story: function (k) { return STORIES[k](); }, bust: function (k, id) { return bust(BUST[k] || "owner", id); } };
  })();

  function avatar(r, i) {
    return '<span class="rs-av">' + SCENE.bust(r.sc, "rsav" + i) + '<span class="rs-badge">' + I(r.i) + "</span></span>";
  }

  var rs = $("[data-reasons2]");
  if (rs) whenNear(rs, function () {
    var people = $(".rs-people", rs), sceneEl = $(".rs-scene", rs), head = $(".rs-head", rs), textEl = $(".rs-text", rs), phaseEl = $(".rs-phase", rs);
    // Calm pacing: each moment gets about three seconds to be read before the next one arrives
    var TIMES = { b1: 700, b2: 3800, b3: 6900, cost: 9600, solve: 12400 }, CYCLE = 17500;
    var SKIES = ["dawn", "morning", "noon", "evening", "night", "rain", "calm"];
    var cur = -1, timers = [], sc = null;
    people.innerHTML = REASONS.map(function (r, i) {
      return '<button type="button" class="rs-person" role="tab" data-p="' + i + '" aria-selected="false">' + avatar(r, i) +
        '<span class="rs-pt"><small>' + T(r.who) + "</small><b>" + T(r.t) + "</b></span></button>";
    }).join("");
    phaseEl.innerHTML = '<button type="button" class="rs-ph p" data-ph="p" aria-pressed="true"><i></i>' + L("आज असं होतं", "Today") + "</button>" +
      '<button type="button" class="rs-ph s" data-ph="s" aria-pressed="false"><i></i>' + L("श्रम सफलसोबत", "With Shram Safal") + "</button>";
    function later(ms, fn) { timers.push(setTimeout(fn, ms)); }
    function stop() { timers.forEach(clearTimeout); timers = []; }
    // Sky, sun and light only change custom properties; the CSS moves composited layers (opacity / transform), so motion stays smooth
    function light(sky, sunAt, focus) {
      sceneEl.setAttribute("data-sky", sky);
      if (sunAt) { sceneEl.style.setProperty("--sx", (sunAt[0] / 4.8).toFixed(2)); sceneEl.style.setProperty("--sy", (sunAt[1] / 3.2).toFixed(2)); }
      if (focus) { sceneEl.style.setProperty("--fx", focus[0]); sceneEl.style.setProperty("--fy", focus[1]); }
    }
    function setPhase(ph) {
      $$("[data-ph]", phaseEl).forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-ph") === ph)); });
      rs.classList.toggle("is-solved", ph === "s");
      sceneEl.classList.toggle("solved", ph === "s");
      if (ph === "s" && sc) light(sc.skyS, sc.sun[3]);
    }
    function problemHtml(r, all) {
      return '<div class="rs-prob fade"><ol class="rs-beats">' + r.b.map(function (b, k) {
        return '<li class="' + (all ? "on" : "") + '" data-bt="' + (k + 1) + '"><span class="n">' + L("०१२३"[k + 1], String(k + 1)) + "</span><span>" + T(b) + "</span></li>";
      }).join("") + '</ol><p class="rs-cost' + (all ? " on" : "") + '"><small>' + L("परिणाम", "What it costs") + "</small>" + T(r.c) + "</p></div>";
    }
    function solutionHtml(r) {
      return '<div class="rs-sol fade"><p class="rs-sol-t">' + T(r.neu) + "</p>" +
        '<div class="rs-feats">' + r.f.map(function (f) { return "<span>" + I("check") + T(f) + "</span>"; }).join("") +
        (r.s === "future" ? '<span class="pill future">' + L("पुढची शक्यता", "Future possibility") + "</span>" : "") + "</div>" +
        (r.link ? '<p style="margin:14px 0 0"><a class="link-arrow" href="' + r.link + '">' + L("पुढे पाहा", "See more") + "</a></p>" : "") + "</div>";
    }
    function beat(k) {
      sceneEl.classList.add("b" + k);
      sceneEl.setAttribute("data-now", String(k));
      if (sc) light(sc.sky[k - 1], sc.sun[k - 1], sc.focus[k - 1]);
      var li = $('[data-bt="' + k + '"]', textEl);
      if (li) li.classList.add("on");
    }
    function showProblem(r, all) {
      setPhase("p");
      sceneEl.classList.remove("b1", "b2", "b3");
      sceneEl.removeAttribute("data-now");
      if (sc) light(sc.sky[0], sc.sun[0], sc.focus[0]);
      textEl.innerHTML = problemHtml(r, all);
      if (all) { beat(1); beat(2); beat(3); }
    }
    function showSolution(r) { setPhase("s"); textEl.innerHTML = solutionHtml(r); }
    function render(i) {
      var r = REASONS[i];
      cur = i;
      $$("[data-p]", people).forEach(function (b) { b.setAttribute("aria-selected", String(+b.getAttribute("data-p") === i)); });
      head.innerHTML = '<span class="rs-who">' + T(r.who) + '</span><p class="rs-quote">“' + T(r.t) + "”</p>";
      sc = SCENE.story(r.sc);
      // the same drawing twice: "a" carries the problem layer, "b" the answer layer; the two cross-fade
      var art = function (k) { return sc.svg.replace("<svg ", '<svg class="rs-art ' + k + '" '); };
      sceneEl.innerHTML = '<span class="rs-sky" aria-hidden="true">' + SKIES.map(function (k) { return '<i data-k="' + k + '"></i>'; }).join("") + "</span>" +
        '<span class="rs-sunh" aria-hidden="true"><i></i></span>' + art("a") + art("b") +
        '<span class="rs-clip" aria-hidden="true"><span class="rs-spot"></span></span>' +
        '<span class="rs-tag" aria-hidden="true">' + sc.tag + '</span><span class="rs-fix" aria-hidden="true">' + I("check") + sc.fix + "</span>";
      sceneEl.setAttribute("aria-label", r.old[PL]);
      showProblem(r, false);
      return r;
    }
    function show(i) {
      stop();
      var r = render(i);
      var tab = $('[data-p="' + i + '"]', people);
      if (tab && people.scrollWidth > people.clientWidth) people.scrollTo({ left: tab.offsetLeft - 12, behavior: reduce ? "auto" : "smooth" });
      later(TIMES.b1, function () { beat(1); });
      later(TIMES.b2, function () { beat(2); });
      later(TIMES.b3, function () { beat(3); });
      later(TIMES.cost, function () { var c = $(".rs-cost", textEl); if (c) c.classList.add("on"); });
      later(TIMES.solve, function () { showSolution(r); });
    }
    people.addEventListener("click", function (e) { var b = e.target.closest("[data-p]"); if (b) show(+b.getAttribute("data-p")); });
    phaseEl.addEventListener("click", function (e) {
      var b = e.target.closest("[data-ph]");
      if (!b || cur < 0) return;
      stop();
      if (b.getAttribute("data-ph") === "s") showSolution(REASONS[cur]); else showProblem(REASONS[cur], true);
    });
    // Person one waits, unplayed, until the section is on screen. The story replays only after the section has fully left the
    // screen and come back, so small scrolls never restart it.
    render(0);
    var outside = true;
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (e.intersectionRatio === 0) { outside = true; stop(); }
          else if (e.intersectionRatio >= 0.3 && outside) { outside = false; show(cur); }
        });
      }, { threshold: [0, 0.3] }).observe(rs);
    } else show(0);
    autoCycle(rs, REASONS.length, show, CYCLE, function () { return cur; });
  });

  /* ---------- The real problem: eight questions in four groups, each answered by what Shram Safal does ---------- */
  // Copy deck: 09-PROBLEM-DISCOVERY-COPY.md. r = the matching person in "Your reason" (REASONS index).
  var QCATS = [
    { sky: "morning", i: "users", n: { mr: "एकत्र माहिती", en: "All in one place" }, a: { mr: "सगळ्यांची माहिती एका ठिकाणी येते का?", en: "Does everyone's information come to one place?" } },
    { sky: "noon", i: "sprout", n: { mr: "जमिनीची शिकवण", en: "What your land teaches" }, a: { mr: "तुमची जमीन काय सांगते, हे कोणी विचारतं का?", en: "Does anyone ask what your land is telling you?" } },
    { sky: "evening", i: "shield", n: { mr: "भरवसा", en: "Trust" }, a: { mr: "भरवसा कोणावर ठेवायचा?", en: "Whom do you trust?" } },
    { sky: "night", i: "rupee", n: { mr: "खर्चाचा हिशोब", en: "Where the money goes" }, a: { mr: "शेतात गेलेला प्रत्येक रुपया दिसतो का?", en: "Can you see every rupee spent on the farm?" } }
  ];
  // h = the answer's headline, p = three proof points, v = which picture draws the answer (see SV below)
  var QUESTIONS = [
    { c: 0, r: 0, v: "one", s: { mr: "सगळे एकच सांगतात?", en: "Same story?" },
      q: { mr: "मालक, घरचे, मुकादम, कामगार, सगळे एकाच शेतासाठी राबतात. पण आज शेतात काय झालं, असं विचारलं तर सगळे एकच सांगतात का?", en: "Owner, family, Mukadam and workers all work for the same farm. But ask what happened on the farm today: do they all say the same thing?" },
      t: { mr: "प्रत्येकाला आपापला भाग दिसतो. म्हणून ज्याचं त्याचं खरं वेगळं असतं.", en: "Each person sees their own part, so each person's truth is different." },
      x: { mr: "सगळ्यांची एकच नोंद. कोणी, काय, कधी नोंदवलं, ते दिसतं. मंजुरी तुमच्या हातात.", en: "One record for everyone. You see who recorded what, and when. Approval stays with you." },
      h: { mr: "सगळ्यांची एकच नोंद. सगळ्यांना तीच दिसते.", en: "One record for everyone. Everyone sees the same one." },
      p: [{ mr: "कोणी नोंदवलं", en: "Who recorded it" }, { mr: "कधी नोंदवलं", en: "When it was recorded" }, { mr: "मंजुरी तुमच्या हातात", en: "Approval stays with you" }] },
    { c: 0, r: 5, v: "att", s: { mr: "हिशोब जुळतो?", en: "Do the counts match?" },
      q: { mr: "पगाराच्या दिवशी वहीतला हिशोब आणि मुकादमाचा हिशोब जुळतो का?", en: "On pay day, does the count in the notebook match the Mukadam's count?" },
      t: { mr: "वाद मजुरीचा नसतो. कोणाचा हिशोब खरा मानायचा, याचा असतो.", en: "The quarrel isn't really about wages. It is about whose count to believe." },
      x: { mr: "एकच हजेरी, दोघांच्याही समोर. कामगारालाही आपल्या कामाचे दिवस दिसतात.", en: "One attendance record, in front of both sides. Workers see their own working days too." },
      h: { mr: "एकच हजेरी, दोघांच्याही समोर.", en: "One attendance record, in front of both sides." },
      p: [{ mr: "रोजची हजेरी", en: "Attendance every day" }, { mr: "मालक आणि मुकादम, दोघांनाही दिसते", en: "Owner and Mukadam both see it" }, { mr: "कामगारालाही आपले दिवस दिसतात", en: "Workers see their own days" }] },
    { c: 1, r: 1, v: "hist", s: { mr: "जमिनीचं कोणी ऐकतं?", en: "Who listens to your land?" },
      q: { mr: "सल्ला सगळीकडून मिळतो. पण तुमच्या जमिनीने तुम्हाला काय शिकवलं, ते कोणी विचारतं का?", en: "Advice comes from everywhere. But does anyone ask what your own land has taught you?" },
      t: { mr: "सल्ला सगळ्यांसाठी एकच असतो. पण प्रत्येक जमिनीचा गुण वेगळा असतो, आणि ती काय सांगते, ते कुठेच लिहिलेलं नसतं.", en: "Advice is the same for everyone. But every piece of land has its own nature, and what it tells you is written down nowhere." },
      x: { mr: "प्रत्येक प्लॉटची रोजची नोंद: काय केलं, काय दिसलं, हवामान कसं होतं. तुमच्या जमिनीचा स्वतःचा इतिहास.", en: "A daily record for each plot: what was done, what was seen, what the weather was. Your land's own history." },
      h: { mr: "तुमच्या जमिनीचा स्वतःचा इतिहास.", en: "Your land's own history." },
      p: [{ mr: "काय केलं", en: "What was done" }, { mr: "काय दिसलं", en: "What was seen" }, { mr: "हवामान कसं होतं", en: "What the weather was" }] },
    { c: 1, r: 4, v: "sched", s: { mr: "कोणाचं वेळापत्रक?", en: "Whose schedule?" },
      q: { mr: "कंपनीचं एक वेळापत्रक, सल्लागाराचं दुसरं, शेजाऱ्याचं तिसरं. तुमच्या जमिनीला कोणतं लागू पडतं, ते नक्की सांगता येतं का?", en: "The company has one schedule, an adviser another, your neighbour a third. Can you say for sure which one suits your land?" },
      t: { mr: "प्रत्येकाचा सल्ला आपल्या जागी बरोबर असतो. पण तुम्ही कोणतं पाळलं, आणि शेतात काय फरक पडला, याची नोंदच राहत नाही. म्हणून दर हंगामात पुन्हा तोच प्रश्न.", en: "Each one's advice is right in its own place. But nothing records which one you followed and what difference it made on your farm, so every season the same question comes back." },
      x: { mr: "तिन्ही वेळापत्रकं आणि तुमचा अनुभव शेजारी शेजारी ठेवून काम करता येतं. सगळे काय एकच सांगतात, आणि तुमच्या शेतात काय वेगळं दिसलं, ते तुमच्याच नोंदीतून कळतं.", en: "Work with all three schedules and your own experience side by side. What they all agree on, and what showed up differently on your farm, comes out of your own record." },
      h: { mr: "तीन वेळापत्रकं आणि तुमचा अनुभव, शेजारी शेजारी.", en: "Three schedules and your own experience, side by side." },
      p: [{ mr: "सगळे काय एकच सांगतात", en: "What they all agree on" }, { mr: "कोणाचं काय वेगळं", en: "What each does differently" }, { mr: "तुमच्या शेतात काय दिसलं, ते तुमच्या नोंदीत", en: "What your farm showed, in your own record" }] },
    { c: 2, r: 7, v: "trial", s: { mr: "नवं करायला मन कचरतं?", en: "Wary of the new?" },
      q: { mr: "नवं औषध असो, नवं तंत्र असो, की नवी पद्धत, वापरून पाहायला मन कचरतं का?", en: "A new product, a new technique or a new method: does something hold you back from trying it?" },
      t: { mr: "कारण भरवसा कोणावर ठेवायचा, हे कळत नाही. आणि कोणी प्रत्यक्ष करून पाहिलंय, त्याची नोंद ठेवलीय, असं उदाहरण समोर नसतं.", en: "Because we don't know whom to trust, and there is no example in front of us of someone who actually tried it and kept a record." },
      x: { mr: "तुम्ही तुमच्याच शेतात काय करून पाहिलं, ते तारखेनिशी नोंदीत राहतं.", en: "What you tried on your own farm stays on the record, with dates." },
      later: { mr: "इतर शेतकऱ्यांनी नोंदलेला अनुभव, त्यांच्या परवानगीने.", en: "Fellow farmers' recorded practice, with their permission." },
      h: { mr: "आधी एका प्लॉटवर करून पाहा, तारखेनिशी.", en: "Try it on one plot first, with dates." },
      p: [{ mr: "काय करून पाहिलं", en: "What you tried" }, { mr: "काय फरक दिसला", en: "What difference you saw" }, { mr: "सगळं तारखेनिशी", en: "All of it dated" }] },
    { c: 2, r: 6, v: "lock", s: { mr: "प्रयोगाचा पुरावा?", en: "Proof of your trial?" },
      q: { mr: "तुम्ही शेतात एखादा नवा प्रयोग केला आणि तो यशस्वी झाला, तर तो पुराव्यानिशी दाखवता येईल का?", en: "If you tried something new on your farm and it worked, could you show it, with proof?" },
      t: { mr: "प्रयोग तुमचा, यश तुमचं. पण नोंद नसेल, तर ते फक्त आठवणीत राहतं. पुढच्या हंगामाला उपयोग होत नाही, आणि कोणाला दाखवताही येत नाही.", en: "The experiment is yours, the success is yours. But without a record it stays only in memory: no use next season, and nothing to show anyone." },
      x: { mr: "पक्की केलेली नोंद तारखेनिशी राहते. बोलून नोंदवली असेल, तर मूळ आवाजासकट. ती कोणालाही गुपचूप बदलता येत नाही, म्हणून तिच्यावर भरवसा ठेवता येतो.", en: "A confirmed record stays with its date, and with the original voice when it was spoken. Nobody can change it silently, so it can be trusted." },
      h: { mr: "पक्की नोंद. ती कोणालाही गुपचूप बदलता येत नाही.", en: "A confirmed record. Nobody can change it quietly." },
      p: [{ mr: "तारखेनिशी", en: "Kept with its date" }, { mr: "बोलून नोंदवली, तर मूळ आवाजही राहतो", en: "The original voice stays, when spoken" }, { mr: "दुरुस्ती झाली, तर तीही दिसते", en: "Any correction stays visible" }] },
    { c: 3, r: 1, v: "spend", s: { mr: "किरकोळ खर्च कुठे?", en: "Small costs, where?" },
      q: { mr: "डिझेल, मोटरची दुरुस्ती, बाजारचं भाडं, कामगारांचा चहा-नाश्ता. हा खर्च कोणत्याच प्लॉटचा नसतो. याची कुठे नोंद राहते का?", en: "Diesel, motor repairs, transport to market, tea and snacks for workers. This spending belongs to no single plot. Is it recorded anywhere?" },
      t: { mr: "हा किरकोळ खर्च रोज होतो, पण कोणत्याच हिशोबात येत नाही. हंगामाच्या शेवटी पैसे गेलेले असतात, पण कुठे गेले, ते कळत नाही.", en: "These small costs happen every day but never enter any account. At season end the money is gone, and nobody knows where." },
      x: { mr: "असा खर्च तुम्ही बोलून, शेताचा खर्च म्हणून नोंदवता. प्लॉटचा खर्च आणि शेताचा खर्च मिळून एकूण हिशोब होतो. नोंदवलेला एकही रुपया सुटत नाही.", en: "You record it by speaking, as farm spending. Plot spending and farm spending together make the total. Not one recorded rupee is left out." },
      h: { mr: "किरकोळ खर्चही हिशोबात येतो.", en: "Small costs get counted too." },
      p: [{ mr: "बोलून नोंदवा", en: "Record it by speaking" }, { mr: "शेताचा खर्च वेगळा", en: "Farm spending kept apart" }, { mr: "नोंदवलेला एकही रुपया सुटत नाही", en: "Not one recorded rupee is left out" }] },
    { c: 3, r: 2, v: "cost", s: { mr: "एकरी खर्च किती?", en: "Cost per acre?" },
      q: { mr: "शेती तुम्ही करता. ती व्यवसायासारखी चालवायची म्हटलं, तर एकरी खर्च किती आला, हे आज सांगता येईल का?", en: "You farm. If you were to run it like a business, could you tell your cost per acre today?" },
      t: { mr: "मोजतात ते फक्त किती माल निघाला, एवढंच. त्यामागचं काम, निर्णय आणि खर्च कधीच दिसत नाहीत.", en: "Only how much crop came out gets counted. The work, the decisions and the spending behind it are never seen." },
      x: { mr: "प्रत्येक प्लॉटचा खर्च, आणि मागच्या हंगामाशी तुलना.", en: "Each plot's spending, compared with last season." },
      h: { mr: "प्रत्येक प्लॉटचा खर्च, मागच्या हंगामाशेजारी.", en: "Each plot's spending, beside last season." },
      p: [{ mr: "प्रत्येक प्लॉटचा खर्च", en: "Spending for each plot" }, { mr: "यंदा आणि मागचा हंगाम", en: "This season and last" }, { mr: "कुठे जास्त गेला, ते लगेच दिसतं", en: "Where it ran higher, at a glance" }] }
  ];
  function mnum(n) { return PL === "en" ? String(n) : String(n).replace(/[0-9]/g, function (d) { return "०१२३४५६७८९"[d]; }); }
  function qBust(q, id) { return SCENE.bust(REASONS[q.r].sc, id); }
  function toReason(i) {
    var sec = $("#reasons");
    if (!sec) return;
    sec.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    setTimeout(function () { var tab = $('[data-p="' + i + '"]'); if (tab) { tab.dispatchEvent(new Event("pointerdown", { bubbles: true })); tab.click(); } }, reduce ? 0 : 800);
  }
  // play a concept only while it is on screen; restart it after it has fully left and come back
  function whenSeen(root, start, stop) {
    if (!("IntersectionObserver" in window)) { start(); return; }
    var outside = true;
    new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.intersectionRatio === 0) { outside = true; stop(); }
        else if (e.intersectionRatio >= 0.35 && outside) { outside = false; start(); }
      });
    }, { threshold: [0, 0.35] }).observe(root);
  }

  /* Concept C (chosen 2 Nov): four groups as columns; each question lights up, its truth follows,
     then the answer arrives as a picture, a headline and three points. The closing lines stay below, always. */
  // SV draws the answer's picture. Sample names, dates and days are illustration only; no amounts are shown.
  var SV = (function () {
    function d(sec) { return ' style="--d:' + sec + 's"'; }
    function av(k, id) { return '<span class="sv-av">' + SCENE.bust(k, id) + "</span>"; }
    function card(head, icon, body, extra) { return '<div class="rc' + (extra || "") + '"' + d(.55) + '><p class="rc-h">' + I(icon) + "<b>" + head + "</b></p>" + body + "</div>"; }
    function row(icon, when, what, k) { return '<p class="rc-row"' + d(.8 + k * .35) + ">" + I(icon) + "<span><b>" + when + "</b> " + what + "</span></p>"; }
    function bar(label, w, cls, k) { return '<p class="rc-bar ' + (cls || "") + '"' + d(.8 + k * .25) + "><span>" + label + '</span><i style="--w:' + w + '%"></i></p>'; }
    var DAYS = { mr: ["सो", "मं", "बु", "गु", "शु", "श", "र"], en: ["M", "T", "W", "T", "F", "S", "S"] };
    return {
      one: function (id) {
        var who = [["control", L("मालक", "Owner")], ["plots", L("घरचे", "Family")], ["wages", L("मुकादम", "Mukadam")], ["skilled", L("कामगार", "Worker")]];
        return '<div class="sv sv-one"><div class="sv-ppl">' + who.map(function (w, k) { return '<span class="sv-p"' + d(k * .15) + ">" + av(w[0], id + k) + "<b>" + w[1] + "</b></span>"; }).join("") + "</div>" +
          '<svg class="sv-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M0 12C55 12 45 50 100 50M0 37C55 37 45 50 100 50M0 63C55 63 45 50 100 50M0 88C55 88 45 50 100 50"/></svg>' +
          card(L("आजची नोंद", "Today's record"), "mic", '<p class="rc-t"' + d(.8) + ">" + L("फवारणी, प्लॉट २", "Spraying, plot 2") + '</p><p class="rc-m"' + d(1) + ">" + L("नोंदवलं: मुकादम, सकाळी ८ वाजता", "Recorded by: Mukadam, 8 am") + "</p>" +
            '<span class="rc-ok"' + d(1.3) + ">" + I("check") + L("मंजूर", "Approved") + "</span>") + "</div>";
      },
      att: function (id) {
        var days = (PL === "en" ? DAYS.en : DAYS.mr).map(function (x, k) { return '<span class="' + (k === 6 ? "off" : "on") + '"' + d(.8 + k * .12) + "><small>" + x + "</small>" + (k === 6 ? "<i>–</i>" : I("check")) + "</span>"; }).join("");
        return '<div class="sv sv-att"><div class="att-who">' +
          '<span class="sv-chip"' + d(0) + ">" + av("control", id + "o") + "<b>" + L("मालक", "Owner") + "</b>" + I("eye") + "</span>" +
          '<span class="sv-chip"' + d(.15) + ">" + av("wages", id + "m") + "<b>" + L("मुकादम", "Mukadam") + "</b>" + I("eye") + "</span></div>" +
          card(L("या आठवड्याची हजेरी: सुनील", "This week's attendance: Sunil"), "list", '<div class="att-days">' + days + "</div>" + '<p class="rc-m"' + d(1.8) + "><b>" + L("६ दिवस हजर", "6 days present") + "</b></p>") +
          '<span class="sv-chip w"' + d(2) + ">" + av("skilled", id + "w") + "<b>" + L("कामगारालाही दिसते", "The worker sees it too") + "</b></span></div>";
      },
      hist: function () {
        return '<div class="sv sv-hist">' + card(L("प्लॉट ३ चा इतिहास", "Plot 3's history"), "history",
          '<div class="rc-tl">' + row("drop", L("१२ ऑक्टो", "12 Oct"), L("पाणी दिलं", "Watered"), 0) + row("eye", L("१५ ऑक्टो", "15 Oct"), L("पानांवर डाग दिसले", "Spots seen on leaves"), 1) +
          row("cloud", L("१८ ऑक्टो", "18 Oct"), L("पाऊस पडला", "It rained"), 2) + "</div>") +
          '<span class="sv-tag"' + d(2) + ">" + I("replay") + L("पुढच्या हंगामात कामी येतो", "Useful again next season") + "</span></div>";
      },
      sched: function () {
        var heads = [L("कंपनी", "Company"), L("सल्लागार", "Adviser"), L("शेजारी", "Neighbour"), L("तुमचा अनुभव", "Your experience")];
        var mid = ["leaf", "drop", "spray", "check"], cells = "";
        heads.forEach(function (h, k) {
          cells += '<div class="sc-col' + (k === 3 ? " you" : "") + '"' + d(k * .2) + "><b>" + h + "</b>" +
            '<span class="sc-c common">' + I("spray") + "</span>" +
            '<span class="sc-c ' + (k === 3 ? "mine" : "diff") + '">' + I(mid[k]) + "</span>" +
            '<span class="sc-c common">' + I("drop") + "</span></div>";
        });
        return '<div class="sv sv-sched"><div class="sc-grid">' + cells + '<span class="sc-band b1"' + d(1.1) + "></span><span class=\"sc-band b3\"" + d(1.1) + "></span></div>" +
          '<div class="sc-key"><span class="k-common"' + d(1.4) + "><i></i>" + L("सगळ्यांचं एकच", "All agree") + '</span><span class="k-mine"' + d(1.7) + "><i></i>" + L("तुमच्या शेतात दिसलं", "Seen on your farm") + "</span></div></div>";
      },
      trial: function () {
        return '<div class="sv sv-trial">' + card(L("करून पाहिलं: नवं औषध, प्लॉट १", "Tried: a new product, plot 1"), "sprout",
          '<div class="rc-tl">' + row("spray", L("१ ऑक्टो", "1 Oct"), L("फवारणी केली", "Sprayed"), 0) + row("checkc", L("१० ऑक्टो", "10 Oct"), L("फरक दिसला", "Difference seen"), 1) + "</div>") +
          '<div class="rc ghost"' + d(1.6) + '><p class="rc-h">' + I("users") + "<b>" + L("इतर शेतकऱ्यांचा अनुभव", "Fellow farmers' experience") + '</b></p><span class="sv-later">' + L("पुढची शक्यता", "Future possibility") + "</span></div></div>";
      },
      lock: function () {
        var wave = "";
        for (var k = 0; k < 18; k++) wave += '<i style="--h:' + [30, 55, 80, 45, 95, 60, 35, 70, 100, 50, 75, 40, 85, 55, 30, 65, 45, 25][k] + '%"></i>';
        return '<div class="sv sv-lock">' + card(L("पक्की नोंद", "Confirmed record"), "shield",
          '<p class="rc-t"' + d(.8) + ">" + L("छाटणी, प्लॉट २", "Pruning, plot 2") + '</p><p class="rc-m"' + d(1) + ">" + L("१४ ऑक्टो, रमेश", "14 Oct, Ramesh") + "</p>" +
          '<p class="rc-wave"' + d(1.2) + ">" + I("mic") + "<span>" + wave + "</span><small>" + L("मूळ आवाज", "Original voice") + "</small></p>" +
          '<p class="rc-fix"' + d(1.6) + ">" + I("edit") + L("दुरुस्ती कोणी, कधी, का केली, सगळं दिसतं", "Who corrected it, when and why: all visible") + "</p>", " sealed") +
          '<span class="sv-seal"' + d(1.9) + ">" + I("lock") + "</span></div>";
      },
      spend: function () {
        var chips = [L("डिझेल", "Diesel"), L("मोटरची दुरुस्ती", "Motor repairs"), L("बाजारचं भाडं", "Market transport"), L("चहा-नाश्ता", "Tea and snacks")];
        return '<div class="sv sv-spend"><div class="sp-chips">' + chips.map(function (c, k) { return '<span class="sv-chip"' + d(k * .15) + ">" + I("receipt") + "<b>" + c + "</b></span>"; }).join("") + "</div>" +
          '<svg class="sv-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M0 12C55 12 45 74 100 74M0 37C55 37 45 74 100 74M0 63C55 63 45 74 100 74M0 88C55 88 45 74 100 74"/></svg>' +
          card(L("हंगामाचा खर्च", "This season's spending"), "rupee",
            bar(L("प्लॉट १", "Plot 1"), 62, "", 0) + bar(L("प्लॉट २", "Plot 2"), 48, "", 1) + bar(L("प्लॉट ३", "Plot 3"), 70, "", 2) + bar(L("शेताचा खर्च", "Farm spending"), 34, "farm", 3) +
            '<p class="rc-total"' + d(1.9) + ">" + I("check") + "<b>" + L("एकूण हिशोब", "Total") + "</b><small>" + L("एकही रुपया सुटला नाही", "Not a rupee left out") + "</small></p>") + "</div>";
      },
      cost: function () {
        var rows = "";
        [[58, 72], [66, 52], [44, 47]].forEach(function (w, k) {
          rows += '<div class="cb-row"' + d(.8 + k * .3) + "><span>" + L("प्लॉट " + mnum(k + 1), "Plot " + (k + 1)) + '</span><p><i class="last" style="--w:' + w[0] + '%"></i><i class="now" style="--w:' + w[1] + '%"></i></p></div>';
        });
        return '<div class="sv sv-cost">' + card(L("प्रत्येक प्लॉटचा खर्च", "Spending for each plot"), "trend",
          '<p class="cb-key"' + d(.7) + '><span class="last"><i></i>' + L("मागचा हंगाम", "Last season") + '</span><span class="now"><i></i>' + L("यंदा", "This season") + "</span></p>" + rows) + "</div>";
      }
    };
  })();

  var qc = $("[data-qc]");
  if (qc) whenNear(qc, function () {
    var strip = $(".qc-strip", qc), panel = $(".qc-panel", qc), cur = 0, timers = [], N = QUESTIONS.length, solved = {};
    strip.innerHTML = QCATS.map(function (c, ci) {
      return '<div class="qc-col" data-sky="' + c.sky + '"><span class="qc-sky"><i></i><span class="qc-ic">' + I(c.i) + '</span></span><p class="qc-ch"><b>' + T(c.n) + "</b>" + T(c.a) + "</p>" + QUESTIONS.map(function (q, k) {
        return q.c !== ci ? "" : '<button type="button" class="qc-f" data-k="' + k + '"><span class="qc-av">' + qBust(q, "qc" + k) + '</span><span class="qc-s">' + T(q.s) + '</span><span class="qc-st" aria-hidden="true"><i class="q">?</i>' + I("check") + "</span></button>";
      }).join("") + "</div>";
    }).join("");
    function later(ms, f) { timers.push(setTimeout(f, ms)); }
    function stop() { timers.forEach(clearTimeout); timers = []; }
    function mark() {
      $$("[data-k]", strip).forEach(function (b) { var n = +b.getAttribute("data-k"); b.classList.toggle("on", n === cur); b.classList.toggle("solved", !!solved[n]); });
      $$(".qc-col", strip).forEach(function (col, ci) { col.classList.toggle("on", QUESTIONS[cur].c === ci); });
    }
    function show(k) {
      stop();
      if (k >= N) { k = 0; solved = {}; }
      cur = k;
      mark();
      var f = $('[data-k="' + k + '"]', strip);
      if (f) requestAnimationFrame(function () { if (strip.scrollWidth > strip.clientWidth) strip.scrollTo({ left: f.closest(".qc-col").offsetLeft - 16, behavior: reduce ? "auto" : "smooth" }); });
      var q = QUESTIONS[k], c = QCATS[q.c];
      panel.innerHTML = '<div class="qc-p fade" data-v="' + q.v + '">' +
        '<div class="qc-prob"><p class="qc-n">' + I(c.i) + T(c.n) + '</p><p class="qc-q">' + T(q.q) + '</p><p class="qc-truth">' + T(q.t) + "</p></div>" +
        '<span class="qc-arrow" aria-hidden="true"><b>' + I("check") + "</b></span>" +
        '<div class="qc-sol"><p class="qc-lab">' + L("श्रम सफलसोबत", "With Shram Safal") + "</p>" + SV[q.v]("sv" + k) +
        '<p class="qc-h">' + T(q.h) + '</p><ul class="qc-pts">' + q.p.map(function (p) { return "<li>" + I("check") + T(p) + "</li>"; }).join("") + "</ul></div></div>";
      var t = $(".qc-truth", panel), sol = $(".qc-sol", panel);
      if (reduce) { t.classList.add("on"); sol.classList.add("on"); solved[k] = true; mark(); later(16000, function () { show(k + 1); }); return; }
      later(2800, function () { t.classList.add("on"); });
      later(5600, function () { sol.classList.add("on"); });
      later(6800, function () { solved[k] = true; mark(); });
      later(15200, function () { show(k + 1); });
    }
    qc.addEventListener("click", function (e) {
      var f = e.target.closest("[data-k]"), go = e.target.closest("[data-go]");
      if (f) show(+f.getAttribute("data-k"));
      else if (go) { e.preventDefault(); toReason(0); }
    });
    var close = $(".qc-close [data-go]");
    if (close) close.addEventListener("click", function (e) { e.preventDefault(); toReason(0); });
    show(0); stop();
    whenSeen(qc, function () { show(cur); }, stop);
  });

  /* ---------- 100%: three tubes fill to the brim, each marked in its own measure; then one daily record measures all ---------- */
  var hmRoot = $("[data-hm]");
  if (hmRoot) whenNear(hmRoot, function () {
    $$("[data-bust]", hmRoot).forEach(function (el, i) { el.innerHTML = SCENE.bust(el.getAttribute("data-bust"), "hm" + i); });
    if (reduce) { hmRoot.classList.add("now", "go"); return; }
    whenSeen(hmRoot, function () { hmRoot.classList.add("go"); }, function () { hmRoot.classList.remove("go"); });
  });

  /* ---------- Planned vs done: one plot, fourteen days ---------- */
  var CMP = {
    plan: [
      { d: 2, i: "drop", t: { mr: "पाणी", en: "Water" } }, { d: 4, i: "spray", t: { mr: "फवारणी", en: "Spray" } },
      { d: 7, i: "sprout", t: { mr: "खत", en: "Fertiliser" } }, { d: 10, i: "spray", t: { mr: "फवारणी", en: "Spray" } }, { d: 12, i: "drop", t: { mr: "पाणी", en: "Water" } }
    ],
    act: [
      { d: 2, k: "done", i: "drop", t: { mr: "पाणी", en: "Water" }, why: { mr: "ठरल्याप्रमाणे, त्याच दिवशी झालं.", en: "Done as planned, on the day." } },
      { d: 5, k: "extra", i: "eye", t: { mr: "डाग", en: "Spots" }, why: { mr: "वेळापत्रकात नव्हतं, पण दिसलं: प्लॉट २ मधल्या पानांवर डाग. फोटो आणि मूळ आवाज नोंदीत.", en: "An unplanned observation: spots on the leaves in plot 2. Photo and original voice on the record." } },
      { d: 6, k: "late", i: "spray", t: { mr: "फवारणी", en: "Spray" }, why: { mr: "ठरलं होतं दिवस ४ ला. पावसामुळे दोन दिवस उशीर. कारण नोंदीत आहे.", en: "Planned for day 4. Two days late because of rain. The reason is on the record." } },
      { d: 7, k: "done", i: "sprout", t: { mr: "खत", en: "Fertiliser" }, why: { mr: "ठरल्याप्रमाणे. कोणतं खत, किती, आणि खर्च नोंदीत.", en: "As planned. Which fertiliser, how much, and the cost, on the record." } },
      { d: 8, k: "late", i: "spray", t: { mr: "फवारणी", en: "Spray" }, why: { mr: "ठरलं होतं दिवस १० ला. डाग दिसल्यामुळे फवारणी दोन दिवस आधी केली. कारण नोंदीत आहे.", en: "Planned for day 10. Because of the spots, it was sprayed two days earlier. The reason is on the record." } },
      { d: 12, k: "miss", i: "alert", t: { mr: "राहिलं", en: "Missed" }, why: { mr: "पाणी राहिलं: मोटर बंद होती. ही गोष्ट उद्याच्या “लक्ष द्या” यादीत आली.", en: "Water missed: the motor was down. It moved to tomorrow's attention list." } }
    ]
  };
  var DEV = ["", "१", "२", "३", "४", "५", "६", "७", "८", "९", "१०", "११", "१२", "१३", "१४"];
  var cmpRoot = $("[data-cmp]");
  if (cmpRoot) whenNear(cmpRoot, function () {
    var grid = $(".cmp-inner", cmpRoot), detail = $(".cmp-detail", cmpRoot);
    var h = "<span></span>";
    for (var d = 1; d <= 14; d++) h += '<span class="cmp-day">' + L(DEV[d], String(d)) + "</span>";
    function lane(label, items, cls) {
      var row = '<span class="cmp-lane">' + T(label) + "</span>", map = {};
      items.forEach(function (it, idx) { map[it.d] = idx; });
      for (var d = 1; d <= 14; d++) {
        if (map[d] === undefined) { row += '<span class="cmp-cell"></span>'; continue; }
        var it = items[map[d]];
        row += '<button type="button" class="cmp-item ' + (cls === "plan" ? "plan" : "act " + it.k) + '" data-c="' + cls + ":" + map[d] + '" aria-pressed="false" style="transition-delay:' + (map[d] * 0.18) + 's">' + I(it.i) + T(it.t) + "</button>";
      }
      return row;
    }
    h += lane({ mr: "वेळापत्रक", en: "Schedule" }, CMP.plan, "plan") + lane({ mr: "प्रत्यक्ष", en: "Actual" }, CMP.act, "act");
    grid.innerHTML = h;
    var actBtns = $$('[data-c^="act:"]', grid);
    autoCycle(cmpRoot, actBtns.length, function (i) { pick(actBtns[i]); }, 3600, function () {
      return actBtns.findIndex(function (x) { return x.getAttribute("aria-pressed") === "true"; });
    });
    grid.addEventListener("click", function (e) {
      var b = e.target.closest("[data-c]");
      if (b) pick(b);
    });
    function pick(b) {
      $$("[data-c]", grid).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      var p = b.getAttribute("data-c").split(":"), it = CMP[p[0]][+p[1]];
      detail.innerHTML = p[0] === "plan"
        ? "<b>" + L("ठरलं: ", "Planned: ") + T(it.t) + "</b> · " + L("दिवस " + DEV[it.d], "day " + it.d) + ". " + L("तुम्ही निवडलेल्या वेळापत्रकातून.", "From the schedule you chose.")
        : "<b>" + T(it.t) + " · " + L("दिवस " + DEV[it.d], "day " + it.d) + "</b>. " + T(it.why);
    }
    onceVisible(cmpRoot, function () { cmpRoot.classList.add("in"); });
  });

  /* ---------- From headcount to skilled crews ---------- */
  var ladder = $("[data-ladder]");
  if (ladder) whenNear(ladder, function () {
    var steps = $$(".lstep", ladder), parts = $$(".wpart", ladder);
    function show(l) {
      steps.forEach(function (s) { s.setAttribute("aria-pressed", String(+s.getAttribute("data-l") === l)); });
      parts.forEach(function (p) { p.hidden = p.getAttribute("data-p").split(",").indexOf(String(l)) < 0; });
    }
    steps.forEach(function (s) { s.addEventListener("click", function () { show(+s.getAttribute("data-l")); }); });
    show(1);
    autoCycle(ladder, steps.length, function (i) { show(i + 1); }, 3400, function () {
      return steps.findIndex(function (s) { return s.getAttribute("aria-pressed") === "true"; });
    });
  });

  /* ---------- FPO page: one plot's day, or all member farms ---------- */
  var dash = $("[data-dash]");
  if (dash) whenNear(dash, function () {
    var rows = $$(".frow[data-f]", dash), day = $(".plotday", dash), title = $("[data-plot-title]", dash);
    var DAYS = [
      { mr: "पवार मळा · प्लॉट २", en: "Pawar farm · plot 2", r: [["drop", { mr: "पाणी झालं", en: "Watered" }, "now"], ["spray", { mr: "फवारणी: पावसामुळे २ दिवस उशीर", en: "Spray: 2 days late, rain" }, "dev"], ["users", { mr: "हजेरी · ६ जण", en: "Attendance · 6 people" }, ""]] },
      { mr: "काळे मळा · प्लॉट १", en: "Kale farm · plot 1", r: [["clip", { mr: "छाटणी पूर्ण", en: "Pruning complete" }, "now"], ["users", { mr: "हजेरी · ८ जण", en: "Attendance · 8 people" }, ""]] },
      { mr: "देशमुख बाग · प्लॉट ३", en: "Deshmukh orchard · plot 3", r: [["alert", { mr: "५ दिवस नोंद नाही", en: "No record for 5 days" }, "miss"], ["phone", { mr: "फील्ड टीमने फोन करावा", en: "Field team to call" }, "dev"]] },
      { mr: "जाधव मळा · प्लॉट १", en: "Jadhav farm · plot 1", r: [["spray", { mr: "फवारणी: काढणीआधीचे दिवस पाळले", en: "Spray: pre-harvest days respected" }, "now"], ["checkc", { mr: "मालकाने मंजूर केलं", en: "Approved by the owner" }, "now"]] }
    ];
    var PILL = { now: '<span class="pill now">' + L("ठीक", "OK") + "</span>", dev: '<span class="pill dev">' + L("लक्ष", "Watch") + "</span>", miss: '<span class="pill" style="color:#b04a3a;border-color:#e2b9b0;background:#fff6f4">' + L("लक्ष द्या", "Act") + "</span>" };
    function show(i) {
      rows.forEach(function (r) { r.setAttribute("aria-pressed", String(+r.getAttribute("data-f") === i)); });
      var d = DAYS[i];
      title.innerHTML = T(d);
      day.innerHTML = d.r.map(function (x) { return '<div class="row fade">' + I(x[0]) + T(x[1]) + (x[2] ? PILL[x[2]] : "") + "</div>"; }).join("");
    }
    rows.forEach(function (r) { r.addEventListener("click", function () { show(+r.getAttribute("data-f")); }); });
    show(0);
    autoCycle(dash, DAYS.length, show, 3800, function () {
      return rows.findIndex(function (r) { return r.getAttribute("aria-pressed") === "true"; });
    });
  });

  /* ---------- In short: the DFES loop lights each step in turn (plays by itself) ---------- */
  var dfes = $("[data-dfes]");
  if (dfes) whenNear(dfes, function () {
    var steps = $$(".dfes-step", dfes);
    function show(i) { steps.forEach(function (s, k) { s.classList.toggle("on", k === i); }); }
    show(0);
    autoCycle(dfes, steps.length, show, 2600, function () {
      return steps.findIndex(function (s) { return s.classList.contains("on"); });
    });
  });

  /* ---------- Frame-rate control: endless background motion runs only while it is on screen ---------- */
  if ("IntersectionObserver" in window) {
    var live = new IntersectionObserver(function (es) { es.forEach(function (e) { e.target.classList.toggle("is-live", e.isIntersecting); }); });
    $$(".final").forEach(function (el) { live.observe(el); });
  }

  /* ---------- Article share bar: copy the link, or open the phone's own share sheet ---------- */
  $$("[data-share-copy]").forEach(function (b) {
    var lab = $(".sh-lab", b), was = lab.textContent, timer;
    function done() {
      lab.textContent = pageLang === "en" ? "Link copied" : "लिंक कॉपी झाली";
      b.classList.add("ok");
      clearTimeout(timer);
      timer = setTimeout(function () { lab.textContent = was; b.classList.remove("ok"); }, 2500);
    }
    function fallback(url) {
      var t = document.createElement("textarea");
      t.value = url; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(t);
      if (ok) done(); else window.prompt(was, url);  // the phone refused to copy: show the link so it can be copied by hand
    }
    b.addEventListener("click", function () {
      var url = b.getAttribute("data-share-copy");
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).then(done, function () { fallback(url); });
      else fallback(url);
    });
  });
  if (navigator.share) $$("[data-share-native]").forEach(function (b) {
    b.hidden = false;
    b.addEventListener("click", function () {
      navigator.share({ title: b.getAttribute("data-title"), text: b.getAttribute("data-title"), url: b.getAttribute("data-url") }).catch(function () {});
    });
  });

  /* ---------- Role tables: each cell carries its column name, so on phones a row becomes a card ---------- */
  $$(".rtable").forEach(function (t) {
    var heads = $$("thead th", t).map(function (th) { return th.textContent.trim(); });
    $$("tbody tr", t).forEach(function (tr) { $$("td", tr).forEach(function (td, i) { if (i && heads[i]) td.setAttribute("data-label", heads[i]); }); });
  });

  /* ---------- Counting (Google Analytics, live site only): register buttons by place, registrations, WhatsApp shares ---------- */
  // analytics.js defines gtag only in the live build, and sends only on shramsafal.in; anywhere else this does nothing.
  function track(name, params) { if (typeof window.gtag === "function") { try { window.gtag("event", name, params); } catch (e) { /* never block a click */ } } }
  document.addEventListener("click", function (e) {
    var a = e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    if (a.hasAttribute("data-wa-share")) { track("whatsapp_share", { page_lang: PL }); return; }
    if (!/(^|\/)contact\.html($|[?#])/.test(a.getAttribute("href")) || !(a.classList.contains("btn") || a.classList.contains("top-strip"))) return;
    var kind = (/[?&]type=(fpo|partner)(?:&|#|$)/.exec(a.getAttribute("href")) || [])[1];  // FPO and partner enquiry buttons are counted apart
    var where = kind || (a.classList.contains("top-strip") ? "top_strip" : a.closest(".mobile-nav") ? "menu" : a.closest(".site-header") ? "header" :
      a.closest(".hero") ? "hero" : a.closest(".persona-cta") ? "persona" : a.closest("#start") ? "final" : a.closest(".post-cta") ? "blog" :
      a.closest("#how") ? "demo" : "other");
    track("register_click", { cta_location: where, page_lang: PL });
  }, true);

  /* ---------- Registration form: same Google Sheet receiver as before. Taluka goes in the village/taluka column. ---------- */
  var CONTACT_ENDPOINT = "https://script.google.com/macros/s/AKfycbz46TEB86d8PIv1ovonsQlICEzMe21sbxuNYmyUPrGKYkNsMhsMPXM_RPZXte17Ey9J/exec";
  var form = $("[data-contact]");
  if (form) (function () {
    var F = function (k) { return form.elements.namedItem(k); };
    var status = $(".cstatus", form), btn = $("button[type=submit]", form), sending = false;
    var distBox = $("[data-district]", form), thanks = $("[data-thanks]");
    var type = new URLSearchParams(location.search).get("type");
    if (/^(fpo|partner)$/.test(type || "")) F("role").value = type;
    function say(cls, mr, en) { status.className = "cstatus wide " + cls; status.innerHTML = cls || mr ? L(mr, en) : ""; }
    // A typed value starting with = + - or @ would become a formula in the Google Sheet; a leading ' keeps it plain text
    function cell(v) { return /^[=+\-@]/.test(v) ? "'" + v : v; }
    function outside() { var o = F("taluka").selectedOptions[0]; return !!(o && o.hasAttribute("data-outside")); }
    // An Indian mobile: 10 digits starting 6-9, with an optional +91, 91 or 0 in front
    function mobileOf(v) { var d = v.replace(/\D/g, ""); if (d.length === 12 && d.indexOf("91") === 0) d = d.slice(2); else if (d.length === 11 && d[0] === "0") d = d.slice(1); return /^[6-9]\d{9}$/.test(d) ? d : ""; }
    F("taluka").addEventListener("change", function () {
      var show = outside();
      distBox.hidden = !show; F("district").required = show;  // it is the next field; focus stays where the person is
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (sending) return;
      var name = F("name").value.trim(), mobile = mobileOf(F("mobile").value), taluka = F("taluka").value;
      var out = outside(), district = out ? F("district").value.trim() : "सोलापूर / Solapur";
      var bad = { name: !name, mobile: !mobile, taluka: !taluka, district: out && !district };
      Object.keys(bad).forEach(function (k) { F(k).closest(".field").classList.toggle("bad", bad[k]); });
      $(".field-err", form).hidden = !bad.mobile || !F("mobile").value.trim();
      var first = ["name", "mobile", "taluka", "district"].filter(function (k) { return bad[k]; })[0];
      if (first === "district") { say("err", "तुमचा जिल्हा लिहा.", "Please write your district."); F(first).focus(); return; }
      if (first) { say("err", "नाव, १० अंकी मोबाईल नंबर आणि तालुका भरा.", "Please fill in your name, a 10-digit mobile number and your taluka."); F(first).focus(); return; }
      // Registering is the consent to be called: the line above the button says so.
      var payload = { language: doc.getAttribute("lang") || "mr", page: location.pathname, consent: "yes",
        name: cell(name), mobile: mobile, village: taluka, district: cell(district), role: F("role").value, company_website: F("company_website").value };
      sending = true; btn.disabled = true;
      say("", "पाठवत आहोत…", "Sending…");
      fetch(CONTACT_ENDPOINT, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload), redirect: "follow" })
        .then(function (r) { return r.json().then(function (d) { if (!r.ok || !d || !d.ok) throw new Error("not saved"); }); })
        .then(function () {
          track("register_submit", { taluka: taluka.split(" / ").pop(), district: out ? district.replace(/[^\p{L}\p{M} ]/gu, "").trim().slice(0, 40) : "Solapur", page_lang: PL });
          form.hidden = true; thanks.hidden = false;
          thanks.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" }); thanks.focus({ preventScroll: true });
        })
        .catch(function () { say("err", "नाव पोचलं नाही. थोड्या वेळाने पुन्हा पाठवा, किंवा arvesystems@gmail.com वर लिहा.", "It didn't go through. Please try again shortly, or write to arvesystems@gmail.com."); })
        .then(function () { sending = false; btn.disabled = false; });
    });
  })();

  /* ---------- Motion switch in the preview bar ---------- */
  $$("[data-motion]").forEach(function (b) {
    b.innerHTML = reduce ? L("हालचाल चालू करा", "Turn motion on") : L("हालचाल बंद करा", "Turn motion off");
    b.addEventListener("click", function () {
      try { localStorage.setItem("ss-motion", reduce ? "on" : "off"); } catch (e) { /* storage blocked */ }
      location.reload();
    });
  });

  /* ---------- Cinematic layer: one farm day from dawn to dusk ---------- */
  (function () {
    var sky = document.createElement("div");
    sky.className = "sky";
    sky.setAttribute("aria-hidden", "true");
    sky.innerHTML = '<i class="sun"></i>';
    document.body.insertBefore(sky, document.body.firstChild);
    var sun = sky.firstChild;
    // dawn, morning, day, field-green afternoon, dusk
    var SKY = [[255, 255, 255], [255, 255, 255], [255, 255, 255], [255, 255, 255], [255, 255, 255]];
    var SUN = [[255, 196, 120], [255, 226, 160], [230, 245, 200], [200, 235, 190], [255, 170, 110]];
    function at(stops, p) {
      var seg = p * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(seg)), t = seg - i;
      return stops[i].map(function (v, k) { return Math.round(v + (stops[i + 1][k] - v) * t); });
    }
    var heroVis = $(".hero-visual"), heroLines = $(".hero .plot-lines"), heroH = 0, ticking = false;
    function paint() {
      ticking = false;
      var h = document.documentElement.scrollHeight - innerHeight;
      var p = h > 0 ? Math.max(0, Math.min(1, scrollY / h)) : 0;
      sky.style.setProperty("--sky", "rgb(" + at(SKY, p).join(",") + ")");
      var c = at(SUN, p);
      sky.style.setProperty("--sun", "rgba(" + c.join(",") + ",.34)");
      if (reduce) return;
      // the sun travels across the sky as the page scrolls
      sun.style.transform = "translate(" + (8 + p * 84) + "vw," + (16 - Math.sin(p * Math.PI) * 10) + "vh)";
      // gentle parallax inside the hero only
      if (heroVis && scrollY < (heroH || innerHeight * 1.2)) {
        heroVis.style.transform = "translateY(" + (scrollY * 0.12).toFixed(1) + "px)";
        if (heroLines) heroLines.style.transform = "translateY(" + (scrollY * -0.08).toFixed(1) + "px)";
      }
    }
    window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(paint); } }, { passive: true });
    window.addEventListener("resize", function () { heroH = ($(".hero") || {}).offsetHeight || 0; paint(); });
    requestAnimationFrame(function () { heroH = ($(".hero") || {}).offsetHeight || 0; paint(); });
  })();

  /* ---------- Sections arrive: kicker line draws, chapter numeral fades in ---------- */
  (function () {
    var chapters = $$("[data-ch-mr]");
    chapters.forEach(function (sec, i) {
      var n = String(i + 1).padStart(2, "0");
      var dev = n.replace(/\d/g, function (d) { return "०१२३४५६७८९"[+d]; });
      var w = $(".wrap", sec);
      if (w) w.insertAdjacentHTML("afterbegin", '<span class="ch-num" aria-hidden="true">' + L(dev, n) + "</span>");
    });
    var secs = $$(".section, .page-hero, .fpo-hero");
    if (!("IntersectionObserver" in window)) { secs.forEach(function (s) { s.classList.add("seen"); }); return; }
    var so = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("seen"); so.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -20% 0px" });
    secs.forEach(function (s) { so.observe(s); });

    // Stagger: items in a group arrive one after another
    [".gg", ".mods", ".dfes-words", ".easy", ".grid-3", ".pillars", ".facts", ".practice", ".dignity", ".hpair", ".sensor", ".flow", ".people", ".chain"].forEach(function (g) {
      $$(g).forEach(function (grp) {
        $$(".rv", grp).forEach(function (el, i) { el.style.transitionDelay = (i * 110) + "ms"; });
      });
    });

    // Chapter caption: "02 · Your reason", with a ring showing how far through the chapter you are
    if (!chapters.length) return;
    var chip = document.createElement("div");
    chip.className = "chapter-chip";
    chip.setAttribute("aria-hidden", "true");
    chip.innerHTML = '<span class="cring"><b></b></span><span class="ctext"></span>';
    document.body.appendChild(chip);
    var ring = $(".cring", chip), num = $("b", chip), text = $(".ctext", chip), current = -1, pend = false;
    function update() {
      pend = false;
      var mid = scrollY + innerHeight * 0.45, idx = -1;
      chapters.forEach(function (c, i) { if (c.offsetTop <= mid) idx = i; });
      var hero = $(".hero");
      var foot = $(".site-footer");
      var show = idx >= 0 && (!hero || scrollY > hero.offsetHeight * 0.6) && (!foot || foot.getBoundingClientRect().top > innerHeight - 80);
      chip.classList.toggle("show", show);
      if (idx < 0) return;
      var start = chapters[idx].offsetTop, end = idx + 1 < chapters.length ? chapters[idx + 1].offsetTop : document.documentElement.scrollHeight;
      ring.style.setProperty("--cp", Math.max(0, Math.min(100, ((mid - start) / (end - start)) * 100)).toFixed(1));
      if (idx !== current) {
        current = idx;
        var c = chapters[idx], n = idx + 1;
        text.classList.add("swap");
        setTimeout(function () {
          num.innerHTML = L("०१२३४५६७८९"[n] || String(n), String(n));
          text.innerHTML = L(c.getAttribute("data-ch-mr"), c.getAttribute("data-ch-en"));
          text.classList.remove("swap");
        }, reduce ? 0 : 220);
      }
    }
    window.addEventListener("scroll", function () { if (!pend) { pend = true; requestAnimationFrame(update); } }, { passive: true });
    requestAnimationFrame(update);
  })();
})();
