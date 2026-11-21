# -*- coding: utf-8 -*-
"""Builds ../index.html and ../decisions.json from _work/src/*. Run: python -X utf8 _work/build.py"""
import json, os, html
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(HERE, 'src')
rd = lambda n: open(os.path.join(SRC, n), encoding='utf8').read()
E = html.escape

taps = {}
tp = os.path.join(HERE, 'taps.json')
if os.path.exists(tp):
    taps = json.load(open(tp, encoding='utf8'))
T = lambda k: str(taps.get(k, '?'))

# ------------------------------------------------------------------ BEFORE pictures: file, one-line caption (all true to the picture)
BEFORE = {
    'path': [
        ('b-hub-1', 'Setup hub, top: the profile card, "शेत तयार करणं 4 पैकी 4 पूर्ण", then the first two rows, each with "पूर्ण" and a "?" button.'),
        ('b-hub-2', 'Scrolled: water and power, machines, and the soil report marked "लवकरच", then the money and people groups.'),
        ('b-hub-3', 'Bottom of the hub: the app group (language, voice records, privacy, billing, version) and sign out.'),
    ],
    'signin': [
        ('b-in-1', 'First run: Sathi greets, two language buttons, "सुरू करूया".'),
        ('b-in-2', 'Login screen, empty: number, password, device tick, the consent tick, a grey button, two other doors.'),
        ('b-in-3', 'Login screen, filled and ticked: still one screen with seven controls.'),
        ('b-in-4', 'The notice sheet, first screen: intro and the five "कोणती माहिती, कशासाठी" blocks in dense text.'),
        ('b-in-5', 'The same sheet scrolled: what we will not do, service providers, "तुमचे हक्क" in small grey type.'),
        ('b-in-6', 'The permissions page: microphone, location and camera, only explained.'),
    ],
    'water': [
        ('b-water-1', 'Water and power page: the source list, "+ पाण्याचा स्रोत जोडा", then the timetable "वीज कधी असते?" below.'),
        ('b-water-2', 'Add a source, step 1 of 2: a typed name and the type chips.'),
        ('b-water-3', 'Step 2 of 2: the motor, with name, HP, phase and power source on one screen.'),
        ('b-water-4', 'The three-phase timetable: a 24-hour strip with 11 px labels, two time boxes and two switches.'),
    ],
    'plots': [
        ('b-plot-1', 'Crops and plots: the grape plots as a grid, and "+ या पिकात प्लॉट जोडा".'),
        ('b-plot-2', 'Adding a crop: a search box over a long photo grid.'),
        ('b-plot-3', 'Add plot, step 1 of 3: name, area, unit and the variety chips together; the step counter is small grey type.'),
        ('b-plot-4', 'Step 2 of 3: seed or saplings, company name, quantity and unit.'),
    ],
    'invite': [
        ('b-team-1', 'My team: each person with a role chip, what they can do, and a "बदला" button.'),
        ('b-team-2', 'The invite sheet, top: four role chips, the plots row, responsibility and the money question.'),
        ('b-team-3', 'The sheet, end: optional name, number and attendance-list worker, then "आमंत्रण तयार करा".'),
    ],
}
# AFTER pictures: n, hook step, caption
AFTER = {
    'path': [
        (1, 1, 'The road: two stops done, the next stop as one big card and one big "चला".'),
        (2, 2, 'He left halfway. The road remembers and says where it will start again.'),
        (3, 3, 'Water is done and ticked; the next stop is next.'),
        (4, 4, 'All done: a calm "छान" and the way back to speaking.'),
    ],
    'signin': [
        (1, 1, 'Language: Sathi greets in his own words, two big tiles.'),
        (2, 2, 'Mobile number: say it, or type on a big keypad.'),
        (3, 3, 'The notice, first page. It is read aloud (ऐका); the words are the app\'s own.'),
        (4, 14, 'The one big tick, with the app\'s own tick sentence.'),
        (5, 16, 'Permissions, one screen each, with a picture.'),
        (6, 19, 'The arrival.'),
    ],
    'water': [
        (1, 1, 'Where the water comes from: five drawn tiles and a mic.'),
        (2, 2, 'A suggested name, or say it.'),
        (3, 4, 'HP as one big number.'),
        (4, 6, 'Single or three phase, with the app\'s own helper lines.'),
        (5, 9, 'The 24-hour ring: drag two handles, or say it.'),
        (6, 10, 'What I understood, in one sentence.'),
    ],
    'plots': [
        (1, 1, 'Which crop: photo tiles and a mic.'),
        (2, 2, 'Variety: the app\'s own list as big tiles.'),
        (3, 3, 'Plot name: only a suggestion (variety plus number).'),
        (4, 4, 'Area as a big number, with एकर and गुंठा.'),
        (5, 8, 'The date: the app\'s own two choices.'),
        (6, 9, 'What I understood, and one save.'),
    ],
    'invite': [
        (1, 1, 'Four people, each with what they can do (the app\'s own words).'),
        (2, 2, 'Which plots they see: the app\'s own choices.'),
        (3, 3, 'Picking plots, crop by crop.'),
        (4, 4, 'Can they see money: yes or no. A permission, no amounts.'),
        (5, 8, 'What I understood, in the card\'s own words.'),
        (6, 9, 'The code, the QR or the link.'),
    ],
}

def before_strip(flow):
    fr = ''.join(
        '<figure class="fr"><button class="pic" type="button" aria-label="Enlarge: %s"><img src="img/%s.jpg" alt="%s"></button><figcaption>%s</figcaption></figure>' % (E(c), f, E(c), E(c))
        for f, c in BEFORE[flow])
    return '<div class="strip before"><h3><span class="tag">BEFORE</span> Real screens from the test app, taken today</h3><div class="frames">%s</div></div>' % fr

def after_strip(flow):
    fr = ''
    for n, s, c in AFTER[flow]:
        hook = '#f=%s&amp;s=%d&amp;nofx=1&amp;solo=1' % (flow, s)
        fr += ('<figure class="fr" data-hook="%s"><button class="pic" type="button" aria-label="Enlarge: %s"><img src="img/after-%s-%d.png" alt="%s"></button><figcaption>%s</figcaption></figure>'
               % (hook, E(c), flow, n, E(c), E(c)))
    return '<div class="strip after"><h3><span class="tag">AFTER</span> The new phone, %d key steps</h3><div class="frames">%s</div></div>' % (len(AFTER[flow]), fr)

AGAIN = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4"/></svg>'
def stage(flow, sub, extra='', taps_html=''):
    return ('<div class="stage" data-flow="%s"><div class="phone-col"><div class="ph"></div></div><div class="stage-side"><h3>Try it</h3><p class="sub">%s</p>'
            '<ol class="road"></ol><p class="road-note"></p><button class="again" type="button">%s Start again</button>'
            '<p class="demo-note">The mic is a drawing: it plays one fixed sample sentence (demo voice, sample words). Names and numbers on the phone are sample. %s</p>%s</div></div>') % (flow, sub, AGAIN, extra, taps_html)

def dots(n, kind='round', cls=''):
    return '<span class="dots %s">%s</span>' % (cls, ''.join('<i class="%s"></i>' % ('f' if kind == 'field' else '') for _ in range(int(n))))

def taps_block(today_html, now_html, today_dots='', now_dots=''):
    return ('<div class="taps"><b>Taps and typing: today vs now.</b><br>Today: %s%s<br>Now: %s%s</div>' % (today_html, today_dots, now_html, now_dots))

def sec(n, title, wrong, flow, sub, taps_html, extra=''):
    return ('<div class="sec" id="item-%d"><h2><span class="num">%d</span>%s</h2><p class="wrong">%s</p>%s%s%s%s</div>'
            % (n, n, title, wrong, before_strip(flow), after_strip(flow), stage(flow, sub, extra, taps_html), ''))

def dots_row(n_round, n_field=0, now=False):
    d = ''.join('<i></i>' for _ in range(n_round)) + ''.join('<i class="f"></i>' for _ in range(n_field))
    return '<span class="dots%s">%s</span>' % (' now' if now else '', d)

# ------------------------------------------------------------------ the five flow sections
S2 = sec(2, 'The setup path: a road, not a list',
    '<b>What is wrong today.</b> The setup hub is one long list: five setup rows over 3 phone screens that all look the same, each with a "पूर्ण" chip and a "?" button, and a counter that says "4 पैकी 4 पूर्ण". Nothing leads the farmer to the next job.',
    'path', 'A farm with two stops done. Tap "चला" to open a stop, pause with the button at the top, come back, finish.',
    taps_block('five equal rows in a long scroll, and a "?" on each; he must decide the order himself.',
               'one big card and one tap ("चला") per stop; the ticks and the summaries tell him the rest.'))
S3 = sec(3, 'Sign-in, notice and permissions: said, heard, ticked',
    '<b>What is wrong today.</b> Before the app opens he meets a first-run screen, a login screen with seven controls (OTP switch, number, password, device tick, consent tick, login button and join-with-code), a notice sheet of over 400 words in dense small type behind a link, and a permissions page.',
    'signin', 'From the first greeting to the arrival, in the order the farmer meets them. The notice has a "सगळं ऐका" button that plays all pages by itself (shortened for the demo).',
    taps_block('3 separate screens, a typed number plus a password or a code, one tick, and a notice of over 400 words behind a link that he is never required to open.',
               '%s touches with the mic and nothing typed (the notice is %s short pages: one "सगळं ऐका" tap plays them all, or he reads and taps पुढे).' % (T('signin'), T('signin_pages'))),
    'The notice is the app\'s own text, split into pages and never reworded. NEW BEHAVIOUR, not in the app today: the permission questions are asked here, one per screen. Today this page only explains and the phone asks at first use.')
S4 = sec(4, 'Water and power: one question at a time',
    '<b>What is wrong today.</b> Adding a well is a two-step form, and the motor step alone puts name, HP, phase, power source and drip details on one screen. The power timetable is a separate card further down the page, with a 24-hour strip drawn in 11 px type.',
    'water', 'Try the well. Pick a different type, or add a second motor, to see the questions repeat. Pick हो on the drip question to see the drip questions.',
    taps_block('4 taps from Home to the motor step, then at least 6 more fields, and the timetable on another card. ',
               '%s one-tap answers, nothing typed, and the timetable is included (the count above leaves it out). Each answer can be spoken instead.' % T('water'),
               dots_row(4, 6), dots_row(int(taps.get('water', 0) or 0), 0, True)),
    'The timetable asks for the phase the motor uses; if motors use both phases the question comes once for each. The alternate-week timetable stays in today\'s screen.')
S5 = sec(5, 'Crops and plots: the plot gets built by talking',
    '<b>What is wrong today.</b> The crop picker is a long searchable photo grid, and adding a plot is a 3-step form whose first step holds the name, area, unit and the variety chips together. The step counter ("पायरी १/३") is small grey type that is easy to miss.',
    'plots', 'Try the grape plot. Choose बियाणं instead of रोपं to see the seed questions. The new idea of adding several plots in one go is NOT shown.',
    taps_block('6 taps from Home to step 3 and 5 typed or filled fields. ',
               '%s touches (taps, or a spoken answer and one tap), nothing typed.' % T('plots'),
               dots_row(6, 5), dots_row(int(taps.get('plots', 0) or 0), 0, True)),
    'The plot name is the farmer\'s own. The app only suggests "variety plus number", and if his plot names already end in a number it keeps suggesting the next one in his own pattern, as today. In the demo the date also shows "आज दिवस N", the same count today\'s step 3 shows.')
S6 = sec(6, 'Inviting someone: who, which plots, then the code',
    '<b>What is wrong today.</b> The invite is one sheet that scrolls over two screens: role chips, a plots row, responsibility chips, the money question, then three optional fields and the make button.',
    'invite', 'Try inviting a मुकादम. Pick कामगार to see the money question disappear: the server does not allow it for that choice.',
    taps_block('at least 4 taps (role, money, make, then QR or link) plus the plots sheet, and up to 3 typed fields (name, number, worker). ',
               '%s touches by tap, nothing typed; every answer can be spoken.' % T('invite'),
               dots_row(4, 3), dots_row(int(taps.get('invite', 0) or 0), 0, True)),
    'The money question is a permission (can they see money), never an amount. The sample plots, names and the code are sample; the QR is a drawing, not a real code.')

# ------------------------------------------------------------------ page
IDEA_SVG = '''<svg class="draw" viewBox="0 0 460 330" role="img" aria-label="Left: a long form with many fields and tabs. Right: one big question, a breathing mic and big answer tiles.">
<g transform="translate(10,6)"><rect x="0" y="0" width="196" height="318" rx="22" fill="#fff" stroke="#C9C5BD" stroke-width="2"/>
<rect x="14" y="16" width="90" height="10" rx="5" fill="#A8A29E"/><rect x="14" y="40" width="168" height="26" rx="8" fill="#F1EFEA" stroke="#D6D3D1"/><rect x="14" y="76" width="120" height="8" rx="4" fill="#C9C5BD"/><rect x="14" y="90" width="168" height="26" rx="8" fill="#F1EFEA" stroke="#D6D3D1"/>
<rect x="14" y="128" width="46" height="22" rx="11" fill="#E7E5E4"/><rect x="66" y="128" width="46" height="22" rx="11" fill="#E7E5E4"/><rect x="118" y="128" width="46" height="22" rx="11" fill="#E7E5E4"/>
<rect x="14" y="162" width="100" height="8" rx="4" fill="#C9C5BD"/><rect x="14" y="176" width="80" height="26" rx="8" fill="#F1EFEA" stroke="#D6D3D1"/><rect x="102" y="176" width="80" height="26" rx="8" fill="#F1EFEA" stroke="#D6D3D1"/>
<rect x="14" y="214" width="140" height="8" rx="4" fill="#C9C5BD"/><rect x="14" y="228" width="168" height="26" rx="8" fill="#F1EFEA" stroke="#D6D3D1"/>
<rect x="14" y="262" width="168" height="14" rx="7" fill="#D6D3D1"/>
<g fill="#A8A29E"><circle cx="30" cy="298" r="6"/><circle cx="64" cy="298" r="6"/><circle cx="98" cy="298" r="6"/><circle cx="132" cy="298" r="6"/><circle cx="166" cy="298" r="6"/></g></g>
<g transform="translate(254,6)"><rect x="0" y="0" width="196" height="318" rx="22" fill="#FAF7F0" stroke="#047857" stroke-width="3"/>
<rect x="16" y="20" width="118" height="6" rx="3" fill="#CFE9DC"/><rect x="16" y="20" width="62" height="6" rx="3" fill="#047857"/><circle cx="162" cy="23" r="12" fill="#D1FAE5"/>
<rect x="16" y="50" width="150" height="14" rx="7" fill="#1C1917"/><rect x="16" y="72" width="104" height="14" rx="7" fill="#1C1917"/>
<circle cx="98" cy="136" r="38" fill="#047857" opacity=".14"/><circle cx="98" cy="136" r="30" fill="#047857"/><rect x="92" y="122" width="12" height="20" rx="6" fill="#fff"/><path d="M86 136a12 12 0 0 0 24 0M98 148v7" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>
<rect x="16" y="190" width="78" height="46" rx="14" fill="#fff" stroke="#D6D3D1" stroke-width="2"/><rect x="102" y="190" width="78" height="46" rx="14" fill="#065F46"/><rect x="16" y="244" width="78" height="46" rx="14" fill="#fff" stroke="#D6D3D1" stroke-width="2"/><rect x="102" y="244" width="78" height="46" rx="14" fill="#fff" stroke="#D6D3D1" stroke-width="2"/>
<rect x="38" y="209" width="34" height="8" rx="4" fill="#78716C"/><rect x="124" y="209" width="34" height="8" rx="4" fill="#fff"/><rect x="38" y="263" width="34" height="8" rx="4" fill="#78716C"/><rect x="124" y="263" width="34" height="8" rx="4" fill="#78716C"/></g></svg>'''

_i1 = IDEA_SVG.index('<g transform="translate(10,6)">'); _i2 = IDEA_SVG.index('<g transform="translate(254,6)">'); _e = IDEA_SVG.rindex('</svg>')
def _wrap(inner, lab):
    return '<svg class="draw" viewBox="0 0 216 330" role="img" aria-label="%s">%s</svg>' % (lab, inner)
IDEA_TODAY = _wrap(IDEA_SVG[_i1:_i2], 'A long form with many fields and tabs')
IDEA_NEW = _wrap(IDEA_SVG[_i2:_e].replace('translate(254,6)', 'translate(10,6)'), 'One big question, a breathing mic and big answer tiles')
ARROW = '<svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h16M14 6l6 6-6 6"/></svg>'
def I(name):
    return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">%s</svg>' % name
ICONS = {
    'one': '<circle cx="12" cy="12" r="8"/><path d="M10 9l2-1.5V16"/>',
    'mic': '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    'fill': '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    'road': '<path d="M7 21L10 3M17 21L14 3M12 7v2M12 13v2"/>',
    'soft': '<path d="M3 14c3-6 6-6 9 0s6 6 9 0"/>',
    'blocks': '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
}
RULES = [
    ('one', 'One question at a time', 'In his own words: his name, his crop and his plot are inside the sentence.'),
    ('mic', 'Voice first, never voice only', 'A big mic leads. Big one-tap answers and a typed way are always there too.'),
    ('fill', 'The app fills, he confirms', 'It shows what it understood in plain words ("मला असं ऐकू आलं") and he taps one big "बरोबर".'),
    ('road', 'A road, not tabs', 'One thin line shows the way and there is one big next. He can leave and come back to the same place.'),
    ('soft', 'Soft, never loud', 'A slowly breathing mic, low sounds, a gentle buzz. No shake, no knock, no confetti, no red alarm.'),
    ('blocks', 'Few blocks, reused', 'The same <strong id="block-count">?</strong> blocks build all four conversations, and <strong id="shared-count">?</strong> of them are used by more than one. A new screen costs a list of questions, not new design work.'),
]
rules_html = ''.join('<li><span class="ico">%s</span><div><b>%s</b><span>%s</span></div></li>' % (I(ICONS[i]), t, d) for i, t, d in RULES)

KEEP = [
    ('The Home voice flow', 'The "आज काय काम झालं" flow stays exactly as it is. It does not appear on this page.'),
    ('The waiting screen and the result screen', 'Not touched.'),
    ('The schedule cards', 'Another designer owns them.'),
    ('The consent wording', 'The notice and the tick sentence are the app\'s own words. Here they are only split into pages and read aloud.'),
    ('The fields', 'Every flow asks the same things today\'s forms ask. No field is added. Anything new is marked "new behaviour" next to the phone.'),
]
keep_html = ''.join('<li><span class="ico">%s</span><div><b>%s</b><br>%s</div></li>' % (I(ICONS['fill']), t, d) for t, d in KEEP)

OTHERS = [('Machines', 'adding a tractor, sprayer or other machine'), ('Soil and water report', 'the report that is still marked "लवकरच"'), ('Money pages', 'long pages of rows and totals'), ('Bill review', 'reading a bill and fixing its lines'), ('Compare (तुलना)', 'long comparison pages')]
others_html = ''.join('<li><b>%s</b><br>%s</li>' % (t, d) for t, d in OTHERS)

ASSETS = ''.join('<img id="asset-%s" src="img/%s" alt="">' % (k, f) for k, f in [
    ('sathi-point', 'a-sathi-point.png'), ('sathi-welcome', 'a-sathi-welcome.png'), ('logo', 'a-logo-mark.png'), ('grapes', 'a-grapes.jpg'), ('sugarcane', 'a-sugarcane.jpg'),
    ('onion', 'a-onion.jpg'), ('pomegranate', 'a-pomegranate.jpg'), ('tomato', 'a-tomato.jpg'), ('wheat', 'a-wheat.jpg')])

PAGE = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="data:,">
<title>The app asks, the farmer answers</title>
<style>
%%CSS%%
</style>
</head>
<body>
<div hidden aria-hidden="true" id="assets">%%ASSETS%%</div>

<header class="hero"><div class="wrap">
  <div>
    <h1>The app asks. The farmer answers.</h1>
    <p class="lead">This page proposes a new way for the ShramSafal setup screens to work. It is design only: <b>nothing here is built</b> in the app.</p>
    <p class="lead">The BEFORE pictures are real screens from the test app, taken today. The AFTER phones are drawings that really work: touch them, tap the mic, drag the dial.</p>
    <p class="lead">Voice stays the way the farmer talks. The Home voice flow is not touched. Only screens that need long reading or many taps turn into a conversation.</p>
  </div>
  <div class="moment" id="moment">
    <p class="q">रामू, तुमच्या शेताला पाणी कुठून येतं?</p>
    <div class="row"><div class="mic"><button class="mic-btn" type="button" aria-label="बोला">%%MIC%%</button><p class="mic-cap">बोला</p></div><p class="heard-line" aria-live="polite"><span style="color:var(--s400)">तुमचं उत्तर इथे दिसेल</span></p></div>
    <div class="chips" aria-hidden="true"><span class="chip">विहीर</span><span class="chip">बोअरवेल</span><span class="chip">कालवा</span><span class="chip">शेततळं</span><span class="chip">टँकर</span></div>
    <p class="note">Tap the mic. Demo voice, sample words: the mic is a drawing.</p>
  </div>
</div></header>

<main class="wrap">
<div class="blk" id="idea"><h2>The idea in one minute</h2>
  <div class="idea">
    <div class="side today"><h3>Today</h3><p>The farmer meets a form. He reads the labels, finds the field, types, scrolls and taps save. Tabs and lists decide the order.</p>%%IDEA_TODAY%%</div>
    <div class="arrow">%%ARROW%%</div>
    <div class="side new"><h3>New</h3><p>The app leads. It asks one plain question, he answers by voice or one tap, the app says what it understood, he confirms.</p>%%IDEA_NEW%%</div>
  </div>
  <ul class="rules">%%RULES%%</ul>
  <table class="matrix" id="matrix" aria-label="Which blocks each flow uses"></table>
  <p class="fine">The table is read from the working phones on this page, not typed by hand.</p>
</div>

<div class="blk" id="keep"><h2>What does not change</h2><ul class="keep">%%KEEP%%</ul></div>

<div class="sec" id="item-1"><h2><span class="num">1</span>How it should feel</h2>
  <p class="wrong">Six small effects carry the whole feeling. Press each one. The sounds are low sine tones (gain 0.05 to 0.08, fading in 300 to 700 ms); the buzz patterns are very short. Buzz works on Android only, because the app ships as an Android app; on a computer you see a soft glow instead.</p>
  <div class="feel" id="feel"></div>
  <div class="switches"><label class="sw"><input type="checkbox" id="sw-sound" checked><i></i>Sound</label><label class="sw"><input type="checkbox" id="sw-buzz" checked><i></i>Buzz</label></div>
  <p class="fine" id="buzz-where"></p>
</div>

%%S2%%
%%S3%%
%%S4%%
%%S5%%
%%S6%%

<div class="blk" id="others"><h2>Other screens with the same problem, not shown</h2>
  <p>The same blocks would carry these too. They are listed so the idea is clear; there is no decision on them here.</p>
  <ul class="list-sec">%%OTHERS%%</ul>
</div>
<footer class="end">Design only. Nothing on this page is built in the app. BEFORE: real screens from the test app, taken today. AFTER: recorded from the working phones above.</footer>
</main>

<dialog class="zoom" id="zoom"><div class="in"><img alt=""><p></p><button type="button">Close</button></div></dialog>
<script>
%%NOTICE%%
%%ART%%
%%ENGINE%%
%%FLOWS%%
%%PAGE%%
</script>
</body>
</html>
'''
MIC = '<svg viewBox="0 0 24 24" width="46" height="46" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>'

out = (PAGE.replace('%%CSS%%', rd('style.css')).replace('%%ASSETS%%', ASSETS).replace('%%MIC%%', MIC).replace('%%ARROW%%', ARROW)
       .replace('%%IDEA_TODAY%%', IDEA_TODAY).replace('%%IDEA_NEW%%', IDEA_NEW).replace('%%RULES%%', rules_html).replace('%%KEEP%%', keep_html).replace('%%OTHERS%%', others_html)
       .replace('%%S2%%', S2).replace('%%S3%%', S3).replace('%%S4%%', S4).replace('%%S5%%', S5).replace('%%S6%%', S6)
       .replace('%%NOTICE%%', 'const NOTICE = ' + open(os.path.join(SRC, 'notice.json'), encoding='utf8').read() + ';')
       .replace('%%ART%%', rd('art.js')).replace('%%ENGINE%%', rd('engine.js')).replace('%%FLOWS%%', rd('flows.js')).replace('%%PAGE%%', rd('page.js')))
open(os.path.join(ROOT, 'index.html'), 'w', encoding='utf8').write(out)

# ------------------------------------------------------------------ decisions.json
NOTHING = ' Nothing is built yet: this is a design decision only.'
D = [
 dict(n=1, title='How it should feel', q='Should every new setup conversation feel like the six effects on the page?',
  d='Soft, as shown',
  out='APPROVED: the feel of the new setup conversations is the six effects on the page (arrive, choose, mic on, heard, confirm, done): low sine tones at gain 0.05 to 0.08 fading over 300 to 700 ms; buzz patterns choose [6], mic [10], confirm [8,70,12], done [10,90,12,90,16], Android only; a slowly breathing mic (5 s, no rings); soft 600 ms transitions; a sound switch and a buzz switch; no shake, no knock, no confetti, no red alarms. What stays as it is today: the Home voice flow (आज काय काम झालं), the waiting screen and the result screen are not touched, and no field or word of consent changes.' + NOTHING),
 dict(n=2, title='The setup path: a road, not a list', q='Should the setup hub become a road with one big next stop?',
  d='A road with one big next',
  out='BUILD the setup hub (flow: path) as a vertical road: the five rows (माझी ओळख, पिकं आणि प्लॉट, पाणी आणि वीज, यंत्रं, माती व पाणी अहवाल) become five stops; finished stops show a tick and a one-line summary in words (for example "२ पिकं · १८ प्लॉट"); the next stop is one big card "पुढचं: ..." with one big "चला"; leaving halfway is remembered and resumed ("पुन्हा सुरू करा"); the "?" buttons become "ऐका" (read aloud); one thin progress line, no "1/7" counters; माती व पाणी अहवाल stays marked "लवकरच". What stays as it is today: every row and every screen behind it, the money, people-and-farms and app groups, the Home voice flow, waiting screen, result screen and the schedule cards.' + NOTHING),
 dict(n=3, title='Sign-in, notice and permissions: said, heard, ticked', q='Should sign-in become a conversation with the notice read aloud?',
  d='Spoken sign-in, notice read aloud',
  out='BUILD sign-in (flow: signin) as a conversation: greeting and language, mobile number by voice or a big keypad, the consent notice read aloud page by page (each real heading is one page with ऐका and पुढे, and "सगळं ऐका" plays all pages), the app\'s own tick sentence with ONE big tick BEFORE the code is sent (exactly as today: nothing about the farmer is saved until the tick), the code, the phone permissions one per screen, and the arrival screen. What stays as it is today: the consent wording is used word for word from consentNotice.ts and is not reworded, the stored consent record and its versions, password sign-in, the new-phone check and "कोड किंवा QR ने सामील व्हा" (not redrawn here), the Home voice flow, waiting screen and result screen. NEW BEHAVIOUR to confirm before building: the permission questions are asked on these screens, one at a time, instead of only at first use.' + NOTHING),
 dict(n=4, title='Water and power: one question at a time', q='Should adding water and power be asked one question at a time?',
  d='Water as a conversation',
  out='BUILD "पाणी आणि वीज" adding (flow: water) as a conversation: type of source (five drawn tiles), name with a suggestion, how many motors, then per motor HP, name, single or three phase, power source, drip yes or no (and, only on yes, pipe size, filter and litres per hour, which can be skipped), then the daily electricity cut window per phase used on a 24-hour ring (or "रोज वीज जात नाही"), a one-sentence summary, and one confirm. What stays as it is today: exactly the same fields and stored values (names, types, phases, power sources, drip details, the cut window), the limit of 4 motors except on a शेततळं, the alternate-week timetable and the existing water page, the Home voice flow, waiting screen, result screen and schedule cards.' + NOTHING),
 dict(n=5, title='Crops and plots: the plot gets built by talking', q='Should adding a crop plot be asked one question at a time?',
  d='Plots as a conversation',
  out='BUILD adding a plot (flow: plots) as a conversation: crop on photo tiles (a search stays available), variety as big tiles ("अन्य" opens the typing box), plot name (the app only SUGGESTS "variety plus number"; the name is the farmer\'s own; today\'s suggestion in his own number pattern stays), area with एकर or गुंठा, बियाणं or रोपं with company or nursery name (skippable only when a variety is chosen, as today) and quantity per acre with unit or plant age, then the date as "आज" or "आधी केली" with a big day-month-year picker and the "आज दिवस N" count, a summary, and one save. What stays as it is today: the same fields and stored values, the crop\'s own date word (छाटणी, लागवड, पेरणी), the checked schedule that follows by itself, and the Home voice flow, waiting screen, result screen and schedule cards. NOT included, not decided: adding several plots in one go.' + NOTHING),
 dict(n=6, title='Inviting someone: who, which plots, then the code', q='Should inviting someone be asked one question at a time?',
  d='Invite as a conversation',
  out='BUILD "नवीन व्यक्तीला बोलवा" (flow: invite) as a conversation: who (सहमालक, कुटुंब, मुकादम, कामगार, each with the app\'s own words for what they can do), which plots (all, chosen, own work; plots picked crop by crop), can they see money (a permission only, never an amount; not asked for a कामगार or own work, because the server refuses it), optional name, optional mobile number, optional worker from the attendance list, a summary in the card\'s own words, then "आमंत्रण तयार करा", then QR or link. What stays as it is today: the same fields, the same grant sent to the server, "एक एक परवानगी बदला" and the team card, the Home voice flow, waiting screen, result screen and schedule cards.' + NOTHING),
]
arr = [dict(n=x['n'], title=x['title'], q=x['q'], opts=[dict(k='A', t='Approve A', d=x['d'], rec=1, out=x['out'])]) for x in D]
json.dump(arr, open(os.path.join(ROOT, 'decisions.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print('built', len(out), 'bytes')
