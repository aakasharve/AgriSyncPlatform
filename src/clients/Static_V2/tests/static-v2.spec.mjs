import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const mustExist = [
  "package.json",
  "DESIGN_BOARD.md",
  "index.html",
  "src/main.tsx",
  "src/App.tsx",
  "src/styles.css",
  // What the shipped site depends on. The source PNG/SVG drafts this list
  // used to require are not committed (44 MB of design material); every image
  // the page imports is checked by the Vite build itself.
  "src/i18n.ts",
  "src/i18n-jsx/jsx-runtime.ts",
  "src/i18n-jsx/jsx-dev-runtime.ts",
  "scripts/prerender.mjs",
  "public/robots.txt",
  "public/sitemap.xml",
  "public/llms.txt",
];

for (const relativePath of mustExist) {
  assert.ok(
    fs.existsSync(path.join(root, relativePath)),
    `${relativePath} should exist`
  );
}

const packageJson = JSON.parse(read("package.json"));
const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
assert.equal(packageJson.type, "module", "Static_V2 should be ESM");
assert.ok(allDeps.motion, "Motion for React should be installed");
assert.ok(allDeps.react, "React should be installed");
assert.ok(allDeps.vite, "Vite should be installed");

const app = read("src/App.tsx");
const styles = read("src/styles.css");
const html = read("index.html");
const copyDraft = read("LIVE_COPY_PAGEWISE.md");
const navShell = app.slice(
  app.indexOf("function NavShell"),
  app.indexOf("function MobileLogoRevealMockup")
);
const footerShell = app.slice(
  app.indexOf("function FooterShell"),
  app.indexOf("export default function App")
);

assert.match(copyDraft, /Website Copy \(v2 · pre-reveal · trust-infrastructure\)/, "Local copy draft should be the v2 trust-infrastructure source");
assert.doesNotMatch(app, /ShramSafal should look small at the entry point, but feel massive in consequence/, "Top thesis should stay Marathi-only in the live site");
assert.match(app, /सुरुवात छोटी दिसते\. पण परिणाम शेताच्या संपूर्ण कामकाजावर जातो\./, "Site-wide Marathi thesis should remain");

assert.match(app, /मी शेतजमीन आहे म्हणून शेतकरी आहे/, "Home hero should use the v2 identity challenge");
assert.match(app, /शेती एक व्यवसाय म्हणून, नियोजनाने आणि नफ्याच्या दिशेने/, "Home hero should preserve the v2 highlighted business phrase");
assert.match(app, /शेतीत "वाटतं" आणि "खरंच झालं" यात मोठं अंतर असतं/, "Home scene 2 should use the v2 daily reality frame");
assert.match(app, /नष्ट होणारे कष्ट/, "Home scene 3 should use the v2 vanished-effort title");
assert.match(app, /एकही स्पष्ट पुरावा उरत नाही/, "Home scene 3 should state the missing proof problem");
assert.match(app, /माझं १००% पुरेसं होतं का/, "Home scene 4 should ask the v2 measurement question");
assert.match(app, /न मोजलेलं, चुकीच्या दिशेने दिलेलं १००%/, "Home scene 4 should use the v2 damage line");
assert.match(app, /प्रत्येक जण शेतकऱ्याला सल्ला द्यायला तयार असतो/, "Home scene 5 should use the v2 advice setup");
assert.match(app, /नियोजन · मोजमाप · जबाबदारी · सुधारणा/, "Home scene 6 should use the v2 spine mantra");
assert.match(app, /याच विचारातून उभं राहत आहे/, "Home scene 7 should use the centered logo-reveal line");
assert.match(app, /स्पष्टता → पुरावा → विश्वास → ओळख/, "Home scene 7 should carry the trust-spine ladder");
assert.match(app, /मजूर नियोजन, कामाची कार्यक्षमता, शेतमालकाची नजर/, "Home scene 7 should include the controlled ecosystem hint");
assert.match(app, /हे प्रत्येकासाठी नाही/, "Home scene 8 should remain self-selective");
assert.match(app, /ग्रामीण उद्योजक/, "Rural operator persona should be standardized to ग्रामीण उद्योजक");
assert.match(app, /पहिल्या जबाबदार गटात नाव जोडा/, "Sitewide CTA should use the v2 serious-group language");

assert.match(app, /आपल्या देशातला शेतकरी मेहनतीला कधीच कमी पडत नाही/, "Vision page should use the v2 founder thesis opening");
assert.match(app, /विश्वासार्ह स्मृती/, "Vision page should name reliable execution memory");
assert.match(app, /सॅटेलाइट आभाळातून शेत दाखवतो/, "Vision page should include the satellite/nadi metaphor");
assert.match(app, /खालच्या थरापासून:\s+रोजच्या कामाच्या सत्यापासून/, "Vision page should state the bottom execution-truth layer");
assert.match(app, /सत्य", "स्पष्टता", "पुरावा", "विश्वास/, "Vision flow should be truth to trust");
assert.match(app, /शेत चालतं मेहनतीवर\. पण शेती वाढते स्पष्टतेवर/, "Vision trust section should remain");

assert.match(app, /काम होतं\. पण रात्री त्यातलं अर्धं आठवणीतच राहतं/, "Farmers page should include the four-gap setup");
assert.match(app, /काम झालं, पण नोंद कच्ची राहिली/, "Farmers page should include gap 01");
assert.match(app, /मुकादम म्हणजे फक्त मजूर पुरवणारा दुवा नाही/, "Farmers page should include the mukadam-to-entrepreneur section");
assert.match(app, /तुमची स्वतःची विश्वासार्ह ओळख/, "Farmers page should end the credibility hint");
assert.match(app, /पुढची शेती अंदाजावर नाही, नोंदीवर चालणार आहे/, "Farmers page should carry the signature line");

assert.match(app, /पहिला जबाबदार गट/, "Join page should frame early access as a responsible group");
assert.match(app, /आम्हाला फक्त वापरकर्ते नकोत/, "Join page should include the selective-group rationale");
assert.match(app, /जे करू शकतो ते सांगतो\. जे करू शकत नाही, तेही सांगतो/, "Join page should include the honest promise section");
assert.match(app, /ShramSafal प्रवेश विनंती पाठवा/, "Join form CTA should match v2");
assert.match(app, /फॉर्म भरताना अडलात तर काळजी नको/, "Join page should include the v2 form reassurance");
assert.match(app, /टीम तुम्हाला फोन करते\. घाई नाही, विक्रीचा दबाव नाही/, "Join page should include next-step reassurance");

assert.match(app, /शेतीत सगळ्यात जास्त कमी पडतो तो एकच — विश्वास/, "Privacy page should open with the trust gap");
assert.match(app, /शेतकऱ्याला विश्वासार्ह ठरवणारी कोणतीच व्यवस्था नाही/, "Privacy page should state the trust infrastructure gap");
assert.match(app, /तुमच्या कामाचा पुरावा — हीच उद्या तुमची खरी ओळख/, "Privacy page should connect proof to identity");
assert.match(app, /तुमची माहिती तुमचीच/, "Privacy page should keep the calm data assurance");
assert.match(app, /विश्वास कमवायचा असतो/, "Privacy CTA should use the v2 trust line");

assert.match(app, /seoByPage/, "SPA routes should use v2 SEO metadata");
assert.match(app, /दृष्टी व विचार — श्रमसफल \| ShramSafal/, "Vision SEO title should match v2");
assert.match(app, /विश्वास हाच कणा — ShramSafal/, "Privacy SEO title should match v2");

assert.match(app, /from "motion\/react"/, "Use Motion's current React import path");
assert.match(app, /useScroll/, "Scroll-linked animation is required");
assert.match(app, /useTransform/, "Scroll-linked visual parallax is required");
assert.match(app, /whileHover/, "Hover motion is required");
assert.match(app, /HoverField/, "Granular hover wrapper is required");
assert.match(app, /function JoinEarlyAccessPage/, "Early access page should exist");
assert.match(app, /early-access-form/, "Early access form should exist");
assert.match(app, /type="submit"/, "Early access form should have a submit action");
// The waitlist form must really submit, and must only thank the farmer once a
// row actually exists. This replaced an assertion that banned `fetch(` outright
// — written when this page was a mockup. Its intent was "do not fake a
// submission", but taken literally it blocked the real submission and never
// checked the thing that mattered: handleSubmit used to be
// `preventDefault(); setSubmitted(true)`, thanking the farmer and discarding
// their phone number. Police that, not the presence of a network call.
assert.match(app, /fetch\(WAITLIST_ENDPOINT/, "Waitlist form must submit to the endpoint");
assert.match(app, /!response\.ok \|\| !result\?\.ok/, "Submission result must be checked before success is shown");
assert.match(app, /setStatus\("error"\)/, "A failed submission must surface an error, not a thank-you");
assert.doesNotMatch(app, /preventDefault\(\);\s*setSubmitted\(true\)/, "Success must never be set unconditionally on submit");
assert.match(app, /name="company_website"/, "Form should carry a honeypot field");

assert.match(navShell, /page-menu/, "Header should use a hover-reveal page cue");
assert.match(navShell, /grain-constellation/, "Header cue should be an agricultural grain constellation");
assert.match(navShell, /aria-expanded={menuOpen}/, "Header menu should expose controlled expanded state");
assert.match(navShell, /onBeforeNavigate={closeMenuAndClearFocus}/, "Header route links should close the menu before navigation");
assert.match(navShell, /tabIndex={menuOpen \? 0 : -1}/, "Hidden header route links should not stay in keyboard tab flow");
// Founder instruction 2026-10-03: the header now carries the brand lockup.
// This replaced "Header should stay logo-free", which existed because the
// site is written pre-reveal — the brand was meant to arrive in Scene 7
// ("ShramSafal ची सुरुवात"), and a header logo shows it from the first
// second instead. Trade made knowingly; if the reveal is restored, this
// assertion is the thing to flip back.
assert.match(navShell, /brand-lockup/, "Header should carry the brand lockup");
assert.match(navShell, /markLogo/, "Header lockup should use the shared brand mark");
// Brand art must be served at a size close to how it is displayed. The 1.74MB
// wordmark SVG wraps its raster as a luminance mask, and the 1600px mark was
// being squeezed into 40px in the footer — a 24x browser downscale that filters
// to mush. Both now resolve to pre-sized copies.
assert.match(app, /import markLogo from "\.\.\/assets\/brand\/ss-mark\.webp"/, "Mark should resolve to the sized copy");
assert.match(app, /import wordmarkLogo from "\.\.\/assets\/brand\/ss-wordmark\.webp"/, "Wordmark should resolve to the sized copy");
assert.doesNotMatch(app, /from "[^"]*wordmark-wide\.svg"/, "The 1.74MB wrapped-raster SVG should not be imported");
assert.doesNotMatch(app, /glimpse|Privacy & Trust वाचा|Structure Only|Visual-only waitlist preview|Footer page navigation|Open page navigation|Page navigation/, "Live JSX should not expose small English navigation/copy residues");

assert.match(footerShell, /wordmarkLogo/, "Footer should use the wide transparent brand wordmark");
assert.match(footerShell, /markLogo/, "Footer should include the transparent logo mark");
assert.doesNotMatch(footerShell, /AgriSync OS|ARVE/, "Footer should not reintroduce AgriSync or ARVE copy");

assert.match(styles, /Noto Serif Devanagari/, "Approved Devanagari display font is required");
assert.match(styles, /Noto Sans Devanagari/, "Approved Devanagari UI font is required");
assert.match(styles, /prefers-reduced-motion: reduce/, "Reduced-motion support is required");
assert.match(styles, /memory-dispersal-hero/, "Work dispersal scene styling is required");
assert.match(styles, /illusion-scene/, "100 percent illusion styling is required");
assert.match(styles, /product-reveal/, "Reveal scene styling is required");
assert.match(styles, /vision-page/, "Vision page styling is required");
assert.match(styles, /launch-page/, "Launch pages should share a visual system");
assert.match(styles, /early-access-form/, "Join page form styling is required");
assert.match(styles, /privacy-principle-grid/, "Privacy trust principles styling is required");
assert.match(styles, /\.page-menu\.is-open \.page-menu-panel/, "Header menu visibility should be controlled by state class");
assert.doesNotMatch(styles, /\.page-menu:hover \.page-menu-panel|\.page-menu:focus-within \.page-menu-panel/, "Header menu panel should not remain open from sticky focus or hover CSS alone");
assert.doesNotMatch(styles, /linear-gradient\(rgba\(7, 20, 13, 0\.04\) 1px/, "Global grain should not render visible grid lines on the home page");
assert.match(styles, /\.footer-shell\s*{[\s\S]*?display: flex;/, "Footer should be a single-line flex lockup");
assert.match(styles, /\.footer-page-nav\s*{[\s\S]*?flex-wrap: nowrap;/, "Footer navigation should stay on one line");
assert.doesNotMatch(styles, /\.footer-page-nav\s*{\s*display: grid;/, "Footer navigation should not use a wrapping grid");
assert.doesNotMatch(styles, /\.footer-page-nav\s*{\s*grid-template-columns:/, "Footer navigation should not use grid columns");

assert.doesNotMatch(app, /protectedWorkDispersalScene|Efforts Vanishing|स्मृती विखुरणे/, "Approach A should not keep the old protected Efforts Vanishing wording");
assert.doesNotMatch(app, /ग्रामीण ऑपरेटर|मुखादम/, "v2 standardized spelling/persona should be used");
assert.doesNotMatch(app, /पहिल्या गटात नाव जोडा/, "Old CTA should not remain");
assert.doesNotMatch(app, /नोंद ठेवण्याचं अॅप|दैनिक कामकाजाची शिस्त घडवणारी प्रणाली|तुम्ही बोलता|Voice Log|00:/, "Pre-reveal copy should not read like a product demo");

// Founder decision 2026-10-03: English is the default because the prerendered
// HTML is what search and answer engines index; Marathi is offered by a
// first-visit prompt. This replaced `lang="mr"`.
assert.match(html, /<html lang="en">/, "Document language should be English (the indexed copy)");
assert.match(read("src/i18n.ts"), /defaultLanguage: LanguageCode = "en"/, "Default language should be English");
assert.match(read("scripts/prerender.mjs"), /setItem\("shramsafal\.language", "en"\)/, "Prerender must freeze the English copy");
assert.match(app, /function LanguagePrompt/, "First-time visitors must be offered Marathi");

console.log("Static_V2 v2 trust-infrastructure contract checks passed");
