// One-off: render the privacy notice markdown to a plain static HTML page.
// Handles only the subset the notice uses: # headings, paragraphs, **bold**, `code`,
// [text](url), pipe tables, -/1. lists, > quotes, --- rules, <!-- comments -->.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [, , src, out, lang, title, lede] = process.argv;
let md = readFileSync(src, "utf8").replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->/g, "");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');

const lines = md.split("\n");
const html = [];
let i = 0;
while (i < lines.length) {
  const l = lines[i];
  if (!l.trim()) { i++; continue; }
  let m;
  if ((m = l.match(/^(#{1,4})\s+(.*)$/))) { html.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++; continue; }
  if (/^---+\s*$/.test(l)) { html.push("<hr>"); i++; continue; }
  if (l.startsWith("|")) {
    const rows = [];
    while (i < lines.length && lines[i].startsWith("|")) { rows.push(lines[i]); i++; }
    const cells = (r) => r.replace(/^\||\|\s*$/g, "").split("|").map((c) => c.trim());
    const head = cells(rows[0]);
    const body = rows.slice(2).map(cells);
    html.push("<div class=\"tw\"><table><thead><tr>" + head.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>" +
      body.map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") + "</tbody></table></div>");
    continue;
  }
  if (l.startsWith(">")) {
    const q = [];
    while (i < lines.length && lines[i].startsWith(">")) { q.push(lines[i].replace(/^>\s?/, "")); i++; }
    html.push("<blockquote>" + q.join(" ").split(/\s{2,}/).map(inline).join("<br>") + "</blockquote>");
    continue;
  }
  if (/^\s*[-*]\s+/.test(l) || /^\s*\d+\.\s+/.test(l)) {
    const ordered = /^\s*\d+\./.test(l);
    const items = [];
    while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
      if (/^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) items[items.length - 1] += " " + lines[i].trim();
      else items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""));
      i++;
    }
    html.push(`<${ordered ? "ol" : "ul"}>` + items.map((t) => `<li>${inline(t)}</li>`).join("") + `</${ordered ? "ol" : "ul"}>`);
    continue;
  }
  const p = [];
  while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|---+\s*$|\||>|\s*[-*]\s+|\s*\d+\.\s+)/.test(lines[i])) { p.push(lines[i].trim()); i++; }
  html.push(`<p>${inline(p.join(" "))}</p>`);
}

const page = `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <!-- GENERATED from mobile-web/public/legal (the in-app privacy notice). Same words, no additions.
         If the notice changes, regenerate this page in the same commit. -->
    <title>${title} — ShramSafal</title>
    <meta name="description" content="${lede}" />
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <style>
      :root { --forest: #145225; --ink: #1c1c16; --muted: #4d5a50; --cream: #fdf9f0; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 24px 16px 64px; background: var(--cream); color: var(--ink);
        font-family: "Noto Sans Devanagari", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.65; }
      main { max-width: 760px; margin: 0 auto; }
      h1 { color: var(--forest); font-size: 1.8rem; line-height: 1.25; margin: 0 0 12px; }
      h2 { color: var(--forest); font-size: 1.25rem; margin: 36px 0 8px; }
      h3 { color: var(--forest); font-size: 1.05rem; margin: 24px 0 6px; }
      hr { border: 0; border-top: 1px solid #c0c9bd; margin: 28px 0; }
      blockquote { margin: 16px 0; padding: 12px 16px; border: 1px solid #c0c9bd; border-radius: 12px; background: #fff; }
      .tw { overflow-x: auto; margin: 16px 0; }
      table { border-collapse: collapse; width: 100%; min-width: 520px; background: #fff; }
      th, td { border: 1px solid #c0c9bd; padding: 8px 10px; text-align: left; vertical-align: top; font-size: 0.95rem; }
      th { background: #eef3ea; }
      code { background: #eef3ea; padding: 1px 5px; border-radius: 4px; font-size: 0.9em; }
      a { color: var(--forest); font-weight: 600; }
      li { margin-bottom: 6px; }
    </style>
  </head>
  <body>
    <main>
${html.join("\n")}
    </main>
  </body>
</html>
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page, "utf8");
console.log(`wrote ${out} (${page.length} bytes)`);
