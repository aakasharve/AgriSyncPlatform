// Google Analytics bootstrap, kept in a file rather than inline so the
// Content-Security-Policy can forbid inline scripts outright. An inline
// <script> would force script-src 'unsafe-inline', which re-opens the exact
// hole CSP exists to close.
window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag('js', new Date());
// send_page_view is off: this is a single-page app and pushState navigation
// fires no page load. App.tsx sends one page_view per route instead, so routes
// after the first are not lost and the first is not counted twice.
gtag('config', 'G-BBWVLKTLXQ', { send_page_view: false });
