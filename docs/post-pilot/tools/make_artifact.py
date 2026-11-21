"""Turn the published approval page into a phone-ready Artifact file: fragment form (no html/head/body tags),
no network calls (answers are kept in the browser and copied to chat), phone-safe fixed bar."""
import re, sys

SRC = r"<the built answer page, e.g. answer-page-workflow.html>"
OUT = r"<where to write the phone artifact file>"

s = open(SRC, encoding="utf-8").read()

# 1. pull out the pieces
style = re.search(r"<style>(.*?)</style>", s, re.S).group(1)
body = re.search(r"<body[^>]*>(.*)</body>", s, re.S).group(1)

# 2. no network: answers live in the browser; the founder copies them into the chat
a = "var t=s==='ok'?'Saved to disk on this PC':(s==='fail'?'Not saved to disk (answers server not reachable). Use Copy my answer.':'');"
assert body.count(a) == 1, "setDisk line not found"
body = body.replace(a, "var t=s?'Saved in this browser. Tap Copy my answer, then paste it in the chat.':'';")

m = re.search(r"function toDisk\(\)\{.*?\n\}\nfunction fromDisk\(done\)\{.*?\n\}\n", body, re.S)
assert m, "toDisk/fromDisk not found"
body = body.replace(m.group(0), "function toDisk(){setDisk('ok');}\nfunction fromDisk(done){done(false);}\n")
body = body.replace("var SAVE_URL='http://localhost:3060/save/';", "var SAVE_URL='';")
assert "localhost" not in body, "a localhost address is still in the page"
left = re.findall(r"fetch\(", body)
print("fetch( calls left in page script:", len(left))

# 3. phone-safe bottom bar (fixed to the screen edge adds the bottom inset) and a stable name
style += "\n.bar{padding-bottom:calc(10px + env(safe-area-inset-bottom,0px))}\n"
out = ("<title>Setup workflow experiment</title>\n<style>" + style + "</style>\n" + body.strip() + "\n")
open(OUT, "w", encoding="utf-8", newline="\n").write(out)
print("written", OUT, len(out), "bytes; html/head/body tags left:", len(re.findall(r"<(?:!doctype|html|head|/head|body|/body|/html)\b", out, re.I)))
