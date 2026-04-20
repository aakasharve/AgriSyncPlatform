# ShramSafal — Cinematic Farm Experience Vision

> **Reference**: [jeskojets.com](https://jeskojets.com/) — continuous ambient motion, layered depth, immersive storytelling
> **Context**: 100% Indian Maharashtrian farming. Semi-literate audience. Emotional, not corporate.
> **Stack**: Astro 5 + GSAP 3.12 + ScrollTrigger + Web Audio API + Canvas/WebGL

---

## 1. THE LIVING WIND SYSTEM (Site-Wide Ambient Layer)

### Concept
Just like Jesko has perpetual cloud marquees suggesting flight, ShramSafal has **perpetual wind** flowing across the entire site — a warm Deccan breeze that never stops. This single system ties the whole page together.

### Implementation Layers

#### Layer 1: Wind Particle Field (Canvas Overlay)
- A full-viewport `<canvas>` sits behind all content at `z-index: -1`
- Hundreds of tiny particles (dust motes, pollen, dried leaf fragments, small seeds) drift **right-to-left** continuously
- Particles have varying:
  - **Size**: 1px–6px (dust) to 12px–20px (leaf fragments)
  - **Opacity**: 0.03–0.15 (subtle, never distracting)
  - **Speed**: Base speed + sine wave oscillation (gusts)
  - **Rotation**: Slow tumble for leaf fragments
  - **Vertical drift**: Gentle sine wave (floating, not falling)
- **Wind speed variable** (`--wind-speed: 0.0–1.0`): Controlled by scroll velocity
  - Scrolling fast = stronger wind gusts = particles accelerate + more turbulence
  - Stopped scrolling = gentle breeze settles = particles slow to lazy drift
  - This creates a visceral connection: **you are the wind moving through the farm**

#### Layer 2: CSS Leaf Sprites (Foreground Decoration)
- 8–12 actual leaf SVGs (mango leaf, neem leaf, sugarcane blade, grape leaf) positioned at screen edges
- CSS `@keyframes` with `translateX` + `rotate` + `translateY(sine)`
- Each leaf has a different duration (15s–30s), creating organic non-repeating feel
- On scroll, leaves accelerate via GSAP `timeScale()` adjustment
- Some leaves **enter from the right edge and exit left** (crossing the viewport like the Jesko clouds)
- Others are anchored to section edges and just sway/whisper

#### Layer 3: Audio Wind (Optional, User-Activated)
- Web Audio API: Looping wind ambience (brown noise + occasional bird chirps + distant bullock bells)
- **Volume mapped to scroll speed**: Scroll faster → wind howls subtly louder
- A small "sound on/off" toggle styled as a **conch shell** (शंख) icon in the corner
- When audio is ON, the wind particles react more dramatically
- Sound files: wind-base.mp3 (30s loop), sparrow-chirp.mp3, bullock-bell.mp3 (triggered randomly every 20–40s)

#### Layer 4: Grass/Crop Edge Sway
- At the **bottom edge of the hero section** and **between major sections**: a strip of illustrated grass/wheat stalks
- These are SVG paths with GSAP `morphSVG` or simple `rotate` on individual blades
- Wind speed variable controls sway amplitude:
  - Light breeze: ±3° gentle rock
  - Strong scroll-gust: ±12° with follow-through delay (stagger from right-to-left, simulating wind traveling across the field)
- Colors shift per section (green paddy → golden wheat → brown harvested stubble) matching the time-of-day narrative

---

## 2. THE PLOUGH NAVIGATION (Vertical Nav Bar)

### Concept
A **traditional Maharashtrian wooden plough** (नांगर / nāngar) is placed vertically along the left edge of the viewport. It serves as both decoration AND functional navigation.

### Visual Design
```
    ╭── Handle (हातोडा) ── top of viewport
    │
    │   ○ Section 1 dot (active = glowing green)
    │
    │   ○ Section 2 dot
    │
    │   ○ Section 3 dot
    ├── Beam (दांडा) ── long wooden shaft
    │
    │   ○ Section 4 dot
    │
    │   ○ Section 5 dot
    │
    │   ○ Section 6 dot
    │
    ╰── Blade (फाळ) ── pointed iron tip at bottom
```

### Details
- **Fixed position** on left edge, spans full viewport height
- The plough is a detailed SVG illustration — weathered teak wood texture, iron blade with forge marks, rope binding at joints
- **Section indicators** are embedded as **nail heads** or **rope knots** along the beam
- Active section: nail head glows warm amber + subtle pulse
- Hover on any knot: tooltip shows section name in Devanagari (e.g., "समस्या" for Problem section)
- Click: smooth scroll to that section
- **The blade at the bottom** subtly "ploughs" — when user reaches the last section, the blade tip gets a soil-particle burst animation
- **On mobile**: Plough collapses into a minimal dot-nav, with the blade tip visible as a tiny fixed icon at bottom-left
- **Scroll progress**: A thin **furrow line** (brown) fills along the plough beam from top to bottom as you scroll, like the plough is carving through the page

### The Furrow Trail
- As the user scrolls, a **soil furrow texture** appears behind the scroll progress
- This is a thin (3px) brown line with a subtle inner shadow and tiny clod particles
- The furrow represents: "You are ploughing through knowledge"

---

## 3. FERTILIZER BAG SECTION DIVIDERS

### Concept
Between major page sections, instead of generic wave dividers, use **Indian fertilizer/seed bags** (खत/बियाणे पिशव्या) as decorative transitions.

### Bag Types (Real Indian Brands, Stylized)
Each divider uses a different bag type, contextual to the section it introduces:

| Transition | Bag Design | Symbolism |
|---|---|---|
| Hero → Problem | Torn, spilling bag (red stripes) | Knowledge spilling, chaos |
| Problem → Solution | Neatly stacked bags (green/white) | Organization, structure |
| Solution → Workflow | Open bag with golden grain pouring | Input → Output transformation |
| Workflow → Value | Bag stamped with "₹" symbol | Cost tracking, financial awareness |
| Value → Trust | Bag with government seal/certification mark | Verified, trusted |
| Trust → CTA | Empty bag, folded neatly | Ready to be filled (by user's journey) |

### Visual Treatment
- Bags are **hand-illustrated SVGs** in a slightly stylized-realistic style
- Classic Indian fertilizer bag aesthetic:
  - Woven HDPE texture (crosshatch pattern)
  - Bold Devanagari + English text (e.g., "ज्ञान खत" / "Knowledge Fertilizer")
  - Red/green/blue stripe borders (like real Kisan/IFFCO bags)
  - Stitched top seam with jute thread detail
- Bags sit at the section boundary, slightly overlapping both sections
- **Parallax**: Bags move at 0.7× scroll speed (slight depth offset)
- **On hover**: Bag rustles (slight rotation + scale wiggle)
- Some bags have small **ants walking across them** (SVG path animation, 2-3 ants, very subtle)

---

## 4. TOOL SHOWCASE (The Farmer's Workspace)

### Concept
As the user scrolls through the site, **farm tools appear and interact** with the content, as if the content is laid out on a farmer's work surface.

### Tools That Appear

#### 4a. The Sickle (विळा / Vilha) — Content Reveal
- When a text block enters the viewport, a curved sickle blade **sweeps across** from right to left
- The text is revealed behind the sweep (clip-path animation following the sickle curve)
- The sickle then rests at the left margin as a decorative element
- Used for: Section headlines

#### 4b. The Rope (दोरी) — Connection Lines
- Between related content cards (e.g., Before → After), instead of arrows/lines, use a **jute rope** SVG
- The rope has realistic twist texture and slight catenary droop
- On scroll, the rope **tautens** (straightens) as the cards come into final position
- Loose rope = chaos state, taut rope = clarity state

#### 4c. The Basket (टोपली) — Data Collection Visual
- In the Workflow section where voice input gets parsed into categories
- Each parsed tag (spray, fertilizer, labor, etc.) drops into a **woven bamboo basket**
- The basket has realistic weave pattern SVG
- Tags bounce slightly on landing (GSAP `bounce.out` ease)
- Basket fills up visually as more tags are parsed
- When full, basket glows with satisfaction (soft amber light from within)

#### 4d. The Weighing Scale (तराजू / Taraju) — Value Comparison
- In the Before/After or Value section
- An old-fashioned beam balance scale appears
- One side holds "chaos" items (scattered papers, stress icons)
- Other side holds "clarity" items (organized logs, green checkmarks)
- As user scrolls, the clarity side **weighs down** (tips the scale)
- The beam rotates with GSAP physics (slight overshoot + settle)

#### 4e. The Hand Pump (हातपंप) — Loading/Progress
- Instead of a circular spinner or progress bar for any loading states
- A hand pump illustration where the handle goes up and down
- Water (data) flows out into a channel
- Used for: Section loading, waitlist form submission

#### 4f. The Bullock Cart Wheel (बैलगाडीचे चाक) — Scroll Indicator
- At the very top of the page, a decorative bullock cart wheel is half-visible
- As user scrolls, the wheel **rotates proportionally**
- Rotation = (scrollPercent × 360°) × 3 (so it spins multiple times through the page)
- The wheel has detailed wooden spoke SVG with iron rim
- Positioned at top-right corner, 60% off-screen, just showing the lower arc

---

## 5. THE FIELD DEPTH SYSTEM (Parallax Reimagined)

### Concept
Instead of generic parallax layers, create a **literal farm field depth** system where content exists at different distances in a Maharashtrian landscape.

### Depth Layers (Back to Front)

```
Layer 0 (Sky):     Gradient sky, cloud wisps, time-of-day color
Layer 1 (Hills):   Western Ghat silhouette, very slow parallax (5%)
Layer 2 (Trees):   Mango/Neem tree canopy outlines, medium parallax (12%)
Layer 3 (Field):   The actual crop field, main parallax (20%)
Layer 4 (Content): Text, cards, UI elements — standard scroll
Layer 5 (Foreground): Crop stalks, tool decorations, leaves — fast parallax (30%)
Layer 6 (Wind):    Particles, dust, floating seeds — fastest (40%)
```

### Time-of-Day Progression (Already Conceptualized, Now Enhanced)
The sky gradient in Layer 0 shifts as user scrolls through the page:

| Scroll % | Time | Sky Colors | Ambient Light | Mood |
|---|---|---|---|---|
| 0–15% | Dawn (पहाट) | Deep purple → rose → gold | Warm orange rim light | Hope, beginning |
| 15–35% | Morning (सकाळ) | Gold → sky blue | Bright, clear | Energy, work begins |
| 35–55% | Midday (दुपार) | Bright blue, white clouds | Harsh, high contrast | Problem/tension sections |
| 55–75% | Afternoon (दुपारनंतर) | Blue → warm amber | Golden hour | Solution, clarity |
| 75–90% | Sunset (संध्याकाळ) | Amber → deep orange → purple | Dramatic long shadows | Legacy, reflection |
| 90–100% | Night (रात्र) | Deep indigo → star-speckled | Cool moonlight | CTA, trust, future |

### Western Ghat Silhouette
- A continuous SVG mountain range silhouette runs along Layer 1
- Based on actual Sahyadri mountain profiles
- In dawn sections: silhouette is pure black against colorful sky
- In day sections: becomes blue-gray with subtle texture
- In night: deep navy with occasional flickering light (distant village)

---

## 6. THE MARKETPLACE TICKER (Mandi Rates Marquee)

### Concept
Like Jesko's cloud marquee but **agricultural** — a continuously scrolling ticker of fictional/realistic mandi (market) rates, creating the feeling of a living agricultural economy.

### Visual Design
- Positioned just below the navbar or at the bottom edge of hero
- Scrolls right-to-left continuously (30s loop)
- Styled like an LED board at a real APMC market:
  - Dark green/black background
  - Amber/orange LED-style text
  - Slight glow effect on characters

### Content Examples
```
🍇 द्राक्षे ₹45/kg ↑₹3  |  🧅 कांदा ₹22/kg ↓₹5  |  🫘 सोयाबीन ₹4,850/क्विंटल ↑₹120  |
🌾 गहू ₹2,275/क्विंटल →  |  💧 ऊस ₹3,100/टन ↑₹50  |  🍊 संत्रा ₹35/kg ↓₹2
```

- Green arrows for price up, red for down, gray for stable
- Prices are **realistic Maharashtra mandi ranges** (not random numbers)
- The ticker **pauses on hover** (like Jesko clouds)
- On mobile: ticker is thinner, single line, faster scroll
- **Purpose**: Subconsciously communicates "this is a REAL agricultural tool, not a tech toy"

---

## 7. THE SOIL TEXTURE SYSTEM

### Concept
The page background isn't flat white — it's **textured like different soil types** that change per section, matching the Maharashtrian geography.

### Soil Types Per Section

| Section | Soil Texture | CSS Implementation |
|---|---|---|
| Hero | Rich black cotton soil (काळी माती) | Dark SVG noise pattern, warm brown tint |
| Problem | Cracked dry earth (कोरडी जमीन) | Tessellated crack pattern SVG, gray-brown |
| Solution | Tilled soil with furrow lines | Parallel line pattern, medium brown |
| Workflow | Wet irrigated soil (ओली माती) | Smooth dark surface with slight sheen |
| Value | Laterite soil (जांभा दगड) | Red-brown stipple pattern |
| Trust | Fertile alluvial soil | Rich dark brown, slight grain |
| CTA/Night | Moonlit soil | Very dark with subtle blue highlight |

### Implementation
- Each texture is a tiny (200×200) repeating SVG pattern applied via `background-image`
- Opacity: 0.03–0.06 (extremely subtle, felt more than seen)
- Blended with section background colors using `mix-blend-mode: multiply`
- Transitions between soil types happen at section boundaries with a 200px CSS gradient fade

---

## 8. THE WELL (विहीर) — Scroll Depth Indicator

### Concept
A **stone well** illustration on the right side of the page shows scroll depth — the deeper you scroll, the deeper you look into the well, and the water level rises.

### Visual
- Fixed position, right edge, 50% vertically centered
- Circular stone well mouth viewed from above (top-down perspective)
- Inside the well: dark gradient that gets lighter as "water rises"
- Water level = scroll percentage
- At 0% scroll: well is dry, you see dark stone bottom
- At 50% scroll: water halfway up, gentle ripple animation
- At 100% scroll: water at the brim, overflowing slightly (tiny droplet particles)

### Details
- Well stones have moss texture on the shaded side
- A rope with a bucket hangs into the well (rope length = inverse of scroll)
- The bucket rises as you scroll down (counterintuitive but visually interesting — you're "drawing knowledge from the well")
- Subtle water reflection ripple (CSS `@keyframes` with `border-radius` morph)
- On mobile: well is hidden (too small to be effective)

---

## 9. THE ALMANAC PAGE TRANSITIONS

### Concept
When sections transition, they don't just fade — they **turn like pages of a farmer's almanac** (पंचांग / शेतीचे डायरी).

### Page Turn Effect
- Each major section is styled with a **slightly yellowed paper edge** on the right side
- When scrolling past a section boundary, the outgoing section's right edge **curls and lifts** (3D CSS transform)
- The incoming section slides in from beneath, like turning a page
- The curl reveals a brief glimpse of the next section's soil texture underneath
- Paper edge has:
  - Torn/deckled edge texture (SVG filter)
  - Slight shadow on the curl
  - The paper is tinted tea-stained (warm cream, not pure white)

### Technical Implementation
- CSS `perspective` + `rotateY` on section wrapper
- ScrollTrigger scrub: maps scroll position to rotation (0° → 15° curl at midpoint → section swap → new section at 0°)
- `backface-visibility` handling for smooth flip
- Fallback for low-power devices: simple crossfade

---

## 10. INTERACTIVE CROP ROWS (Guided Questions Section)

### Concept
Instead of abstract question chips, questions are **planted in crop rows** — literally styled as planted seedlings in a field that the user walks through.

### Visual
- Top-down view of a field with 5 furrow rows
- Each row has a planted seedling marker with a question label
- The "path" between rows is a dirt track that the user walks along (scroll position = position on path)
- As user approaches each row:
  - Seedling grows (scale 0.5 → 1.0)
  - Leaves unfurl (SVG morph)
  - Question text appears as a **hand-written label on a wooden stake** stuck in the ground
- Active question row has:
  - Brighter green
  - Gentle sway animation
  - Butterflies hovering nearby (2-3 SVG butterflies with figure-8 flight path)

### The Walking Path
- A dotted footprint trail shows the user's progress along the field path
- Footprints appear behind the scroll position (not ahead)
- Footprint SVG: chappal/sandal print (not shoe — farmer context)

---

## 11. THE HARVEST COUNTER (Trust/Value Section)

### Concept
Instead of abstract number counters, show **harvested crop piles** that grow as numbers increase.

### Visual Elements
- **Onion pile**: Mesh bag fills up as "days logged" count increases
- **Grape crate**: Purple clusters appear one by one in a wooden crate as "tasks completed" increases
- **Sugarcane bundle**: Stalks added to a tied bundle as "costs tracked" increases
- **Grain sack**: Golden grain level rises inside a jute sack as "trust score" increases

### Animation
- Each item has a satisfying "plop" micro-animation when it appears
- Subtle jiggle on the pile/container when new item is added
- A farmer's hand (illustrated) occasionally pushes items to settle them
- Final state: overflowing abundance → triggers a golden shimmer

---

## 12. THE WATER CHANNEL FLOW (Section Connections)

### Concept
A **irrigation channel** (पाट / pāṭ) runs along the left or right margin of the page, carrying water that flows with scroll momentum.

### Visual
- Thin (40px) illustrated water channel with stone/mud banks
- Water texture: animated CSS gradient (blue → dark blue → blue) scrolling in flow direction
- Small floating elements in the water:
  - Marigold flowers (गेंदा फूल) — orange dots with petal detail
  - Neem leaves — small green ovals
  - Occasional paper boat (कागदी होडी) — white triangle
- Water flow speed matches scroll velocity
- At section boundaries, the channel has small **gates/weirs** (बंधारा) that open when you reach that section
- Water splashes slightly at each weir (particle burst)

### Symbolism
- Water = knowledge/data flowing through the farm
- Gates opening = unlocking new insights section by section
- Marigold flowers = auspicious, Maharashtrian wedding/pooja connection (trust)

---

## 13. THE RANGOLI LOADING SCREEN

### Concept
Instead of a spinner or blank screen while the page loads, show a **rangoli being drawn** in real-time.

### Animation Sequence (2-3 seconds)
1. A hand (henna-decorated, feminine — acknowledging women farmers) appears
2. The hand draws a traditional **Maharashtrian rangoli** pattern dot by dot
3. Dots connect with flowing lines (SVG stroke-dashoffset animation)
4. Pattern fills with color (powdered rangoli palette: red, yellow, white, green)
5. The complete rangoli morphs into the ShramSafal logo
6. Logo settles, rangoli fades, page content appears

### Pattern Choice
- **Swastik with leaves** (शुभ चिन्ह) — traditional Maharashtrian door rangoli
- Or **Ashta-dal padma** (8-petal lotus) — universal auspicious symbol
- The pattern subtly incorporates farm elements: wheat stalk, water drop, sun

---

## 14. THE CHULHA SMOKE (Footer/CTA Zone)

### Concept
The final CTA section (dark night theme) has a **chulha (clay stove)** in the corner with smoke rising.

### Visual
- Illustrated clay chulha with glowing embers (orange particle glow)
- Smoke rises from the chulha as **CSS/Canvas particles**
- Smoke particles drift upward and **form words momentarily** before dispersing:
  - "शेतकर्यांसाठी" (For farmers)
  - "विश्वास" (Trust)
  - "आमचे शेत, आमचा हिशोब" (Our farm, our account)
- The smoke catches the wind system (drifts right-to-left like all other wind elements)
- Embers occasionally pop out (orange spark particles, 1-2 at a time)
- **The warmth**: A radial gradient around the chulha gives a warm glow to nearby content
- This creates the feeling of **sitting around a fire at night, discussing the farm's future**

---

## 15. THE CROW/SPARROW AMBIENT LIFE

### Concept
Add **living creatures** that exist in the page environment, reacting to scroll and content.

### Creatures

#### Sparrows (चिमण्या)
- 2-3 small sparrow SVGs perched on section headers or tool illustrations
- When user scrolls near them: they **flutter away** (GSAP motion path along a bezier curve to another perch)
- After 3-5 seconds: they return to a different perch
- Occasionally one sparrow pecks at something (head bob animation)
- Sound (if audio enabled): quick chirp when they flutter

#### Crow (कावळा)
- A single crow sits on the plough navigation handle
- When user clicks the plough nav: crow caws and flies away, returns after navigation completes
- The crow acts as a **mascot/guide** — it sits near the current active section

#### Butterflies (फुलपाखरे)
- In the solution/clarity sections (positive mood)
- 2-3 butterflies with realistic flutter wing animation (CSS transform)
- They follow lazy figure-8 paths around content cards
- Orange/black pattern (Monarch-style, common in Maharashtra)

#### Ants (मुंग्या)
- In the workflow section (representing organized labor)
- A line of ants walks along the bottom edge of the workflow cards
- Each ant carries a tiny data icon (leaf = log, grain = task, seed = cost)
- The ant line is an SVG path with `offset-path` animation
- 6-8 ants, evenly spaced, walking left to right

---

## 16. THE HAND-WRITTEN ANNOTATIONS

### Concept
Throughout the page, **hand-written Marathi notes** appear in the margins, as if a farmer has annotated the website like they'd annotate their diary.

### Visual Style
- Font: Custom handwriting font OR SVG traced paths (for authenticity)
- Written with **blue ballpoint pen** aesthetic (thin strokes, slight pressure variation)
- Positioned in page margins or as overlays on images
- Slightly rotated (2-5°) for organic feel

### Examples
- Next to the hero stat "10 सेकंदात": A circled note "वा! इतकं लवकर?" (Wow! That fast?)
- Next to the problem section: An underline with "हे तर माझ्याच बाबतीत!" (This is exactly my situation!)
- Next to the value section: A margin star "★" with "हा भाग महत्त्वाचा" (This part is important)
- Next to the CTA: A drawn arrow pointing to the form with "इथे नाव टाका" (Put name here)

### Animation
- Notes appear with a **writing animation** (stroke-dashoffset, as if being written in real-time)
- Triggered by ScrollTrigger when the nearby content enters viewport
- Speed: matches realistic handwriting pace (~1.5s for a short note)
- Some notes have **cross-outs and rewrites** (showing revision, human imperfection)

---

## 17. THE MONSOON EASTER EGG

### Concept
If the user stays on the page for >60 seconds OR scrolls past the Trust section, a **gentle monsoon shower** begins.

### Visual
- Dark clouds gather at the top of the viewport (CSS gradient overlay, 3s transition)
- Rain begins: Canvas-based rain particles, diagonal from wind direction
- Rain is gentle (not dramatic) — 50-80 drops visible at a time
- Crop illustrations in the background **respond to rain**:
  - Dry brown field gradually turns green
  - Flowers bloom (SVG morph)
  - Soil texture darkens (wet soil)
- A rainbow appears briefly after 10 seconds, then fades
- The whole sequence lasts ~20 seconds, then sky clears

### Audio (if enabled)
- Gentle rain + distant thunder rumble
- The famous "मातीचा वास" (petrichor) can't be conveyed, but the visuals should **evoke** it

### Trigger
- Can also be triggered by clicking a small cloud icon hidden in the footer
- Shows a tooltip: "पावसाळा अनुभवा" (Experience the monsoon)

---

## 18. MICRO-INTERACTIONS GLOSSARY

| Element | Interaction | Animation |
|---|---|---|
| **CTA Button** | Hover | Seed sprouts from button edge, magnetic pull |
| **Card hover** | Mouse enter | Dewdrop forms on card corner, slides down edge |
| **Image load** | Lazy load | Unfurls like a banana leaf unrolling |
| **Link hover** | Mouse over | Underline grows like a vine |
| **Form input focus** | Click | Border turns into growing seedling stem |
| **Checkbox** | Check | Tick mark drawn like farmer's chalk mark |
| **Number counter** | Scroll in | Abacus beads slide (wooden beads on wire) |
| **Section enter** | Scroll trigger | Rooster crows (very subtle audio cue) |
| **Nav hover** | Mouse over | Rope knot on plough tightens |
| **Language toggle** | Click | Pages flip like almanac (EN → MR) |
| **Scroll to top** | Click | Bullock cart wheel spins backward rapidly |
| **Error state** | Validation fail | Withered plant droops momentarily |
| **Success state** | Form submit | Flower blooms from the submit button |

---

## 19. THE FESTIVE OVERLAY SYSTEM

### Concept
During Maharashtrian festivals, the site automatically applies festive overlays:

| Festival | Overlay | Period |
|---|---|---|
| **Makar Sankranti** | Kite strings across sky layer, til-gul colored accents | Jan 14-15 |
| **Holi / Rang Panchami** | Color splashes on section boundaries, gulal particles in wind | Mar (date varies) |
| **Gudi Padwa** | Gudi pole on the plough nav top, mango leaf garland on navbar | Mar/Apr |
| **Pola** | Decorated bullock replaces cart wheel, garland on plough | Aug |
| **Diwali** | Diya lamps replace section indicators on plough nav, rangoli expanded | Oct/Nov |
| **Bhogi** | Bonfire replaces chulha, sugarcane stalks as dividers | Jan 13 |

### Implementation
- Date-based CSS class on `<body>`: `festival-diwali`, `festival-pola`, etc.
- Festival assets lazy-loaded only during active period
- A small banner: "शुभ [festival name]!" with traditional greeting

---

## 20. CURSOR TRANSFORMS

### Concept
The default cursor transforms based on which section the user is in:

| Section Zone | Cursor Style |
|---|---|
| **Hero / Sky area** | Tiny kite (पतंग) trailing a string |
| **Problem section** | Wilted leaf |
| **Solution section** | Seedling sprout |
| **Workflow section** | Microphone icon (voice input context) |
| **Value section** | Small ₹ coin |
| **Trust section** | Handshake |
| **CTA section** | Pointed pen (for signing up) |
| **Default / Between** | Small green leaf that rotates with movement |

### Implementation
- Custom cursor SVGs (24×24 or 32×32)
- CSS `cursor: url('...'), auto` per section
- The cursor glow system (already exists) adds context-appropriate color:
  - Hero: golden glow
  - Problem: red glow
  - Solution: green glow
  - Night/CTA: cool blue glow

---

## 21. CONTENT LAYOUT — THE FIELD GRID

### Concept
Instead of standard card grids, content cards are laid out like **plots in a farm field** viewed from a slight aerial angle.

### Visual
- Cards have a subtle **isometric tilt** (CSS `perspective: 1000px; rotateX(2deg)`)
- Between cards: dirt paths (brown lines) with occasional footprints
- Card borders look like **boundary stones** (rough edges, not rounded rectangles)
- Each card has a tiny crop icon indicating its "type":
  - 🌱 for introductory content
  - 🌾 for mature/detailed content
  - 🌻 for highlight/feature content
  - 🍇 for result/outcome content

### The Farmer's Path
- A suggested reading path winds between the cards (dotted brown line)
- The path glows section by section as the user scrolls past
- Creates a sense of walking through a farm, stopping at each plot to learn

---

## PERFORMANCE GUARDRAILS

| System | Perf Budget | Fallback |
|---|---|---|
| Wind particles (Canvas) | Max 200 particles, 30fps cap | Disable below 30fps, use CSS-only leaf sway |
| Audio | Lazy load, <200KB total | Silent by default, opt-in only |
| Tool SVGs | Max 5 visible at once, lazy load | Static illustrations, no animation |
| Soil textures | Base64 inline tiny patterns | Flat color backgrounds |
| Parallax layers | 6 max | Reduce to 3 on mobile, 0 on `prefers-reduced-motion` |
| Creature animations | Max 3 active creatures | Disable on mobile |
| Page turn effect | Only on desktop >1024px | Simple crossfade on mobile |
| Monsoon easter egg | Desktop only, >4GB RAM detected | Skip entirely on mobile |
| Festive overlays | Lazy load, <50KB per festival | CSS-only color accents |

### Mobile Strategy
On mobile (<768px), the experience simplifies to:
- Wind: CSS-only leaf sway (no canvas)
- Navigation: Dot nav (no plough)
- Dividers: Simple bag illustrations (no parallax)
- Tools: Static decorations only
- Creatures: Disabled
- Soil: Flat colors with subtle gradient
- Audio: Disabled by default
- Depth: 2 layers max (background + content)

### `prefers-reduced-motion`
- ALL animations → `animation: none`
- Parallax → flat
- Wind → disabled
- Creatures → static perched positions
- Counters → show final value immediately
- Page turns → instant section swap
- Content reveals → immediate opacity: 1

---

## IMPLEMENTATION PRIORITY

### Phase 1 — Foundation (Week 1)
1. Wind particle canvas + CSS leaf sprites
2. Plough vertical navigation SVG
3. Soil texture backgrounds per section
4. Time-of-day sky gradient system

### Phase 2 — Storytelling (Week 2)
5. Fertilizer bag section dividers
6. Sickle text reveal + rope connections
7. Mandi rates ticker
8. Hand-written Marathi annotations

### Phase 3 — Life (Week 3)
9. Creature system (sparrows, crow, butterflies, ants)
10. Basket filling + weighing scale
11. Water channel flow
12. Harvest counter crop piles

### Phase 4 — Polish (Week 4)
13. Rangoli loading screen
14. Chulha smoke CTA zone
15. Monsoon easter egg
16. Cursor transforms + micro-interactions
17. Audio wind system
18. Festive overlay system

---

## THE FEELING

When someone lands on this site, they should feel:

> "मला वाटलं मी शेतात आहे."
> (I felt like I was in the field.)

Not a tech website. Not a SaaS landing page.
**A walk through a living Maharashtrian farm at golden hour**,
where the wind carries the scent of soil,
where tools tell stories,
where every scroll ploughs a new furrow of understanding.

The Jesko Jets site makes you feel the thrill of flight without leaving your chair.
**ShramSafal should make you feel the earth under your feet without leaving your screen.**
