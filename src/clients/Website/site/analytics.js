// Google Analytics: the same property the earlier shramsafal.in used. Kept in a file, not inline, because the site's
// Content-Security-Policy forbids inline scripts. It counts visits on shramsafal.in only, never on a local preview.
window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
if (/(^|\.)shramsafal\.in$/.test(location.hostname)) {
  gtag("js", new Date());
  gtag("config", "G-BBWVLKTLXQ");
}
