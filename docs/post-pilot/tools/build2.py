"""Turn the redesign designer's index.html + decisions.json into one answer page.
usage: python -I build2.py
"""
import base64, json, os, re, sys

SRC = r"<folder that holds the design files, e.g. ../workflow-led-setup>"
SCR = r"<folder that holds addon.js and addon.css (this tools folder)>"
OUT = os.path.join(SRC, "answer-page-redesign.html")
HEAD = "Crop to plot to schedule redesign - my answers"
KEY = "ui9a-redesign-answers-v1"
SAVE = "ui-9a-crop-plot-schedule-redesign-2026-11-20"
# optional: python build2.py <folder> <out file name> <answers heading> <storage key> <save name>
if len(sys.argv) >= 6:
    SRC = sys.argv[1]
    OUT = os.path.join(SRC, sys.argv[2])
    HEAD, KEY, SAVE = sys.argv[3], sys.argv[4], sys.argv[5]

html = open(os.path.join(SRC, "index.html"), encoding="utf-8").read()
items = json.load(open(os.path.join(SRC, "decisions.json"), encoding="utf-8"))
css = open(os.path.join(SCR, "addon.css"), encoding="utf-8").read()
js = open(os.path.join(SCR, "addon.js"), encoding="utf-8").read()

# every decision needs a matching section in the page
for it in items:
    n = it["n"]
    pat = re.compile(r'<h2[^>]*>\s*<span class="num">\s*%d\s*</span>' % n)
    if not pat.search(html):
        sys.exit("page has no section numbered %d" % n)
    if not any(o["k"] == "A" for o in it["opts"]):
        sys.exit("item %d has no option A" % n)
    it["opts"] = [o for o in it["opts"] if o["k"] != "C"] + [
        {"k": "C", "t": "I want a change", "d": "write it in the box below", "out": ""}]
    for o in it["opts"]:
        for f in ("t", "d", "out"):
            o.setdefault(f, "")
    it.setdefault("q", "Which do you want?")
    it.setdefault("size", "")

# swap the item list and the title lines inside the script
a = js.index("var ITEMS=[")
b = js.index("];\nvar state={};") + 2
js = js[:a] + "var ITEMS=" + json.dumps(items, ensure_ascii=False) + ";\n" + js[b:]
js = re.sub(r"var KEY='[^']*';", "var KEY='%s';" % KEY, js, count=1)
js = re.sub(r"var SAVE_NAME='[^']*';", "var SAVE_NAME='%s';" % SAVE, js, count=1)
js = re.sub(r"var HEAD='[^']*';", "var HEAD=%s;" % json.dumps(HEAD, ensure_ascii=False), js, count=1)

summary = (
    '<div class="page" style="max-width:1260px;margin:0 auto;padding:0 20px 80px">\n'
    '<div class="sec" id="summary">\n'
    '<h2>Your answers: copy and paste into the chat</h2>\n'
    '<p class="small">Your choices above are saved in this browser, so you can close the page and come back. '
    'Items you leave unanswered are marked "hold, do not build".</p>\n'
    '<div id="sumtable"></div>\n'
    '<div class="btnrow">'
    '<button type="button" class="btn pri" id="copy">Copy my answer</button>'
    '<button type="button" class="btn" id="allrec">Approve all recommended</button>'
    '<button type="button" class="btn" id="clearall">Clear all answers</button>'
    '</div>\n'
    '<p id="copied" role="status" aria-live="polite"></p>\n'
    '<p><span class="disk" role="status" aria-live="polite"></span></p>\n'
    '<label class="nl" for="out">This is exactly what will be copied (you can also select it and press Ctrl+C)</label>\n'
    '<textarea id="out" readonly></textarea>\n'
    '</div></div>\n'
)
bar = (
    '<div class="bar"><b id="cnt"></b>'
    '<a href="#summary">See my answers</a>'
    '<button type="button" class="btn" id="copy2">Copy my answer</button>'
    '<span id="copied2" role="status" aria-live="polite" style="font-weight:800"></span>'
    '<span class="disk" role="status" aria-live="polite"></span></div>\n'
)

if html.count("</style>") < 1 or html.count("</body>") != 1:
    sys.exit("unexpected page structure")
html = html.replace("</style>", css + "\n</style>", 1)
html = html.replace("</body>", summary + bar + "<script>\n" + js + "\n</script>\n</body>")

# founder rule: pictures are labelled BEFORE and AFTER
html = html.replace('<span class="tag now">Now / B</span>', '<span class="tag now">BEFORE (and B)</span>')
html = html.replace('<span class="tag now">Now</span>', '<span class="tag now">BEFORE</span>')
html = html.replace('<span class="tag a">A - ', '<span class="tag a">AFTER A - ')
html = html.replace('<span class="tag b">B - ', '<span class="tag b">AFTER B - ')
html = html.replace('<span class="tag a">A</span>', '<span class="tag a">AFTER A</span>')
html = html.replace('<span class="tag b">B</span>', '<span class="tag b">AFTER B</span>')
html = html.replace('<span class="tag a">Pattern</span>', '<span class="tag a">AFTER (shared pattern)</span>')

# the designer's script builds the crop photo address at run time ('img/' + name + '.jpg'): give it the pictures themselves
OLD_PH = "url(img/'+(c==='c'?'cane':'grapes')+'.jpg)"
if OLD_PH in html:
    def _b64(name):
        return "data:image/jpeg;base64," + base64.b64encode(open(os.path.join(SRC, "img", name), "rb").read()).decode("ascii")
    html = html.replace(OLD_PH, "url('+(c==='c'?window.__IMGCANE:window.__IMGGRAPES)+')")
    shim = '<script>window.__IMGCANE="%s";window.__IMGGRAPES="%s";</script>\n' % (_b64("cane.jpg"), _b64("grapes.jpg"))
    k = html.index("<script")
    html = html[:k] + shim + html[k:]
    print("run-time photo address replaced")
elif "img/'+" in html:
    sys.exit("an image address is still built at run time and was not handled")

def inline(m):
    p = os.path.join(SRC, "img", m.group(1))
    if not os.path.exists(p):
        sys.exit("missing image " + p)
    ext = m.group(1).rsplit(".", 1)[1].lower()
    mime = {"jpg": "jpeg", "jpeg": "jpeg", "png": "png", "svg": "svg+xml", "webp": "webp"}[ext]
    return "data:image/%s;base64,%s" % (mime, base64.b64encode(open(p, "rb").read()).decode("ascii"))

html, n = re.subn(r"img/([A-Za-z0-9_.\-]+\.(?:jpg|jpeg|png|svg|webp))", inline, html)
print("images inlined:", n, "| decisions:", len(items))
open(OUT, "w", encoding="utf-8", newline="\n").write(html)
print("written", OUT, os.path.getsize(OUT), "bytes")
