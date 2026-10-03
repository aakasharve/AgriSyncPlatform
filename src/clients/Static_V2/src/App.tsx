import { type CSSProperties, type FormEvent, type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import dailyImage from "../assets/generated/scene-02-daily-work-memory.webp";
import workDispersingImage from "../assets/generated/scene-02-work-dispersing.webp";
import visionReflectionImage from "../assets/generated/scene-04-belief-field-reflection.webp";
import welcomeFarmerImage from "../assets/generated/scene-01-hero-farm-operator.webp";
import homeHeroImage from "../assets/review/visual-prompts-v1-20260617/01-home-hero-farmer-card.webp";
import homeSoilImage from "../assets/review/visual-prompts-v1-20260617/05-home-soil-wisdom.webp";
import homeBusinessImage from "../assets/review/visual-prompts-v1-20260617/06-home-land-vs-business.webp";
import homeAudienceImage from "../assets/review/visual-prompts-v1-20260617/08-home-audience-group.webp";
import homeCtaImage from "../assets/review/visual-prompts-v1-20260617/09-home-cta-seed.webp";
import farmersHeroImage from "../assets/review/visual-prompts-v1-20260617/farmers-hero-operator-square.webp";
import joinGroupImage from "../assets/review/visual-prompts-v1-20260617/join-first-responsible-group.webp";
import privacyTrustImage from "../assets/review/visual-prompts-v1-20260617/privacy-trust-seedling.webp";
import markLogo from "../assets/brand/ss-mark.webp";
import wordmarkLogo from "../assets/brand/ss-wordmark.webp";
// Header lockup. shram-safal-wordmark-wide.svg is 1.8MB and uses its raster
// as a LUMINANCE MASK filled by two radial gradients — extracting the raster
// alone gives white-on-black, not the artwork. ss-wordmark.webp is that SVG
// as the browser actually renders it, rebuilt at header size: 1.8MB -> 9KB.
import arveLogo from "../assets/brand/arve-logo.png";
import {
  defaultLanguage,
  getStoredLanguage,
  languageUi,
  localizedSeo,
  saveStoredLanguage,
  setRenderLanguage,
  type LanguageCode,
} from "./i18n";

declare global {
  interface Window {
    gtag?: (command: string, ...args: unknown[]) => void;
  }
}

type RouteKey = "home" | "vision" | "farmers" | "join" | "privacy";

type PillarDefinition = {
  title: string;
  detail: string;
};

type PageDefinition = {
  eyebrow: string;
  href: string;
  key: RouteKey;
  label: string;
  title: string;
  description: string;
  philosophy: string;
  pillars: PillarDefinition[];
};

const easeOut = [0.22, 1, 0.36, 1] as const;
const consequenceThesisMarathi =
  "सुरुवात छोटी दिसते. पण परिणाम शेताच्या संपूर्ण कामकाजावर जातो.";

const workDispersalScene = {
  imageAlt: "नष्ट होणारे कष्ट",
  imageLabel: "नष्ट होणारे कष्ट",
  kicker: "नष्ट होणारे कष्ट",
  headline: "नष्ट होणारे कष्ट",
  paragraphs: [
    "दिवसभर उन्हातान्हात राबता. मजूर सांभाळता. हजारोंचं औषध-पाणी करता.",
    "पण काही दिवसांनी — कोणतं काम कसं झालं आणि पैसा नेमका कुठे गेला, याचा एकही स्पष्ट पुरावा उरत नाही.",
    "मेहनत रोज होते. पण तिचा स्पष्ट हिशोब राहिला नाही, तर ती काळाच्या धुक्यात विरून जाते.",
  ],
  quote:
    "आणि जे आज स्पष्ट राहत नाही, ते उद्याच्या निर्णयात कधीच कामी येत नाही.",
} as const;

const icons = {
  home: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  vision: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  scope: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="9" x2="15" y2="9" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </svg>
  ),
  farmers: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21c4-7 14-7 18 0" />
      <path d="M7 10c2.8-3.5 7.2-3.5 10 0" />
      <path d="M12 3v18" />
      <path d="M4 15c5-2 11-2 16 0" />
    </svg>
  ),
  join: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
      <path d="M5 4h6" />
      <path d="M5 20h6" />
    </svg>
  ),
  privacy: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-5" />
    </svg>
  ),
  about: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  // Step icons for business shift
  farmer: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  manager: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <line x1="9" y1="9" x2="15" y2="9" />
      <line x1="9" y1="13" x2="15" y2="13" />
    </svg>
  ),
  responsible: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  builder: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  ),
  // Proof node icons
  voice: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  ),
  structure: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" />
      <rect x="14" y="3" width="7" height="5" />
      <rect x="14" y="12" width="7" height="9" />
      <rect x="3" y="16" width="7" height="5" />
    </svg>
  ),
  proof: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  memory: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  ),
};

const pages: PageDefinition[] = [
  {
    key: "home",
    href: "/",
    label: "मुख्यपृष्ठ",
    eyebrow: "ShramSafal",
    title: "शेतीला व्यवसायासारखं चालवणाऱ्या शेतकऱ्यांसाठी",
    description:
      "जमीन असणं वेगळं, शेती उभी करणं वेगळं. रोजच्या शेतकामाला दिशा, हिशोब आणि जबाबदारीचा कणा.",
    philosophy: "पहिल्या जबाबदार गटात नाव जोडा.",
    pillars: [],
  },
  {
    key: "vision",
    href: "/vision",
    label: "दृष्टी व विचार",
    eyebrow: "दृष्टी व विचार",
    title: "श्रमसफलची दृष्टी",
    description:
      "शेतातली रोजची मेहनत हरवू नये; ती स्पष्टतेत, विश्वासात आणि चांगल्या निर्णयांत बदलावी.",
    philosophy: "शेतीचं रोजचं सत्य — श्रमसफलची दृष्टी.",
    pillars: [
      { title: "शाश्वत शिस्त", detail: "अंदाजावर नाही, तर मोजता येण्याजोग्या कामाच्या नोंदींवर शेती चालवणे." },
      { title: "स्थानिक शहाणपण", detail: "मातीचा पोत, पिकांचा इतिहास आणि अनुभवाचे शास्त्रीय वर्गीकरण." },
      { title: "वैज्ञानिक दिशा", detail: "अचूक हवामान आणि पाण्याची समज घेऊन वेळेवर अंमलबजावणी करणे." },
      { title: "पुढची पिढी", detail: "शेतीला नवी तांत्रिक प्रतिष्ठा मिळवून देऊन तरुणांना आकर्षित करणे." }
    ],
  },
  {
    key: "farmers",
    href: "/farmers",
    label: "शेतकरी / कामकाज",
    eyebrow: "शेतकरी व कामकाज सांभाळणाऱ्यांसाठी",
    title: "१० गुंठे असो किंवा १०० एकर — शेती चालवण्यासाठी स्पष्टता लागतेच.",
    description:
      "ShramSafal त्या लोकांसाठी आहे जे शेतीकडे फक्त जमीन म्हणून नाही, तर रोज चालणारी जबाबदारी म्हणून पाहतात.",
    philosophy: "लहान शेतकरी, प्रगतिशील शेतकरी, शेतमालक, मुकादम आणि कुटुंबातील शेती व्यवस्थापक यांना एकाच स्पष्ट कामकाजाच्या सत्यावर आणणे.",
    pillars: [
      { title: "लहान शेतकरी", detail: "जे स्वतः काम पाहतात, पण अंदाजापेक्षा स्पष्टता हवी आहे." },
      { title: "शेतमालक", detail: "जे प्रत्येक वेळी शेतात नसतात, पण कामाचा विश्वासार्ह मागोवा हवा आहे." },
      { title: "मुकादम / सुपरवायझर", detail: "जे काम, माणसं आणि जबाबदारी यांना स्पष्ट पुराव्यात आणू इच्छितात." }
    ],
  },
  {
    key: "join",
    href: "/join",
    label: "पहिला जबाबदार गट",
    eyebrow: "पहिला जबाबदार गट",
    title: "पहिल्या जबाबदार गटात नाव जोडा",
    description:
      "रोजच्या शेतकामाला दिशा, हिशोब आणि जबाबदारी हवी असेल, तर पहिल्या जबाबदार गटात सामील व्हा.",
    philosophy: "आम्ही आधी कमी शेतकऱ्यांसोबत खोलवर काम करणार आहोत, कारण विश्वास घाईत तयार होत नाही.",
    pillars: [
      { title: "नाव आणि मोबाईल", detail: "सुरुवातीच्या संपर्कासाठी आवश्यक माहिती." },
      { title: "गाव आणि शेती", detail: "तुमच्या शेतीचा संदर्भ समजण्यासाठी." },
      { title: "सध्याची अडचण", detail: "ShramSafal तुमच्यासाठी योग्य आहे का हे समजण्यासाठी." }
    ],
  },
  {
    key: "privacy",
    href: "/privacy-trust",
    label: "विश्वास",
    eyebrow: "विश्वास हाच कणा",
    title: "विश्वास हाच कणा",
    description:
      "शेतीत सगळ्यात कमी पडतो तो विश्वास. तुमच्या खऱ्या कामातून तुमचा स्वतःचा विश्वास उभा करा.",
    philosophy: "तुमच्या कामाचा पुरावा — हीच उद्या तुमची खरी ओळख.",
    pillars: [
      { title: "तुमची माहिती तुमचीच", detail: "ती फक्त तुमच्याच संमतीने वापरली जाते." },
      { title: "खोटे दावे नाहीत", detail: "ShramSafal उत्पन्न वाढीची जादू सांगत नाही; तो रोजच्या कामाला स्पष्टता देण्यापासून सुरू होतो." },
      { title: "विश्वास आधी", detail: "म्हणूनच आम्ही पहिल्या गटात कमी लोकांसोबत, पण खोलवर काम करतो." }
    ],
  },
];

const pageIndexLabels = ["०१", "०२", "०३", "०४", "०५"];

const pageByPath = new Map(pages.map((page) => [page.href, page]));

const seoByPage: Record<RouteKey, { title: string; description: string }> = {
  home: {
    title: "ShramSafal — शेतीला व्यवसायासारखं चालवणाऱ्या शेतकऱ्यांसाठी",
    description:
      "जमीन असणं वेगळं, शेती उभी करणं वेगळं. रोजच्या शेतकामाला दिशा, हिशोब आणि जबाबदारीचा कणा. पहिल्या जबाबदार गटात नाव जोडा.",
  },
  vision: {
    title: "दृष्टी व विचार — श्रमसफल | ShramSafal",
    description:
      "शेतातली रोजची मेहनत हरवू नये; ती स्पष्टतेत, विश्वासात आणि चांगल्या निर्णयांत बदलावी. शेतीचं रोजचं सत्य — श्रमसफलची दृष्टी.",
  },
  farmers: {
    title: "शेतकरी व कामकाज सांभाळणाऱ्यांसाठी — ShramSafal",
    description:
      "१० गुंठे असो किंवा १०० एकर — शेती चालवायला स्पष्टता लागतेच. काम, खर्च, मजुरी आणि जबाबदारीचा विश्वासार्ह मागोवा. हे कोणासाठी आहे ते पाहा.",
  },
  join: {
    title: "पहिल्या जबाबदार गटात नाव जोडा — ShramSafal",
    description:
      "रोजच्या शेतकामाला दिशा, हिशोब आणि जबाबदारी हवी असेल, तर पहिल्या जबाबदार गटात सामील व्हा. आधी कमी शेतकऱ्यांसोबत खोलवर काम.",
  },
  privacy: {
    title: "विश्वास हाच कणा — ShramSafal",
    description:
      "शेतीत सगळ्यात कमी पडतो तो विश्वास. शेतकऱ्याला विश्वासार्ह ठरवणारी व्यवस्थाच नाही. तुमच्या खऱ्या कामातून तुमचा स्वतःचा विश्वास उभा करा.",
  },
};

const memoryCards = [
  {
    title: "जे आठवतं, ते खरं वाटतं.",
    detail: "तोंडी अपडेट, वही आणि अंदाज यांच्यात कामाची खरी स्थिती हरवते.",
  },
  {
    title: "काम झालं असं वाटतं.",
    detail: "पण कोण, कुठे, किती आणि ठरल्याप्रमाणे झालं का — हे पुन्हा तपासलं जात नाही.",
  },
  {
    title: "खर्च वहीत लिहिला जातो.",
    detail: "पण रोग, पाणी, मजूर आणि बाजार बदलला, की त्या खर्चाचा अर्थही बदलतो.",
  },
  {
    title: "शेती चालू राहते.",
    detail: "पण “चालू राहणं” आणि “नफ्यात चालणं” या दोन वेगळ्या गोष्टी आहेत.",
  },
];

const illusionTriggers = [
  "हवामानातला बदल",
  "अचानक आलेला रोग",
  "ऐनवेळी मजूर न येणं",
  "बाजारभावानुसार बदलणारा खर्च",
  "गृहीत न धरलेला अचानक खर्च",
  "नियोजनाबाहेर गेलेला वेळ",
];

const soilSignals = [
  "कोणाच्या शेतात पाणी लवकर धरतं",
  "कुठे खत लगेच परिणाम दाखवतं",
  "कोणत्या वाफ्यात पीक वेगळं वागतं",
  "कोणत्या हंगामात जमीन वेगळी प्रतिक्रिया देते",
];

const businessShiftSteps = [
  {
    label: "शेतकरी",
    detail: "मेहनत आणि अनुभवातून उभी राहिलेली ओळख.",
    icon: "farmer" as const,
  },
  {
    label: "शेती व्यवस्थापक",
    detail: "रोजच्या कामाचं नियोजन आणि मागोवा ठेवणारी भूमिका.",
    icon: "manager" as const,
  },
  {
    label: "जबाबदार शेतकरी",
    detail: "खर्च, माणसं, वेळ आणि पुरावा यांना स्पष्ट जबाबदारी देणारा दृष्टिकोन.",
    icon: "responsible" as const,
  },
  {
    label: "शेती व्यवसाय उभारणारा",
    detail: "नियोजन, मोजमाप, जबाबदारी आणि सुधारणा यावर शेतीचा कणा उभा करणारा.",
    icon: "builder" as const,
  },
];

const revealChips = ["काम", "मजुरी", "खर्च", "वेळ", "निरीक्षण", "पुरावा"];

const revealProofs = [
  {
    label: "स्पष्टता",
    value: "आजचं काम",
    detail: "आज काय झालं, काय राहिलं आणि कुठे अडलं हे स्पष्ट करणं.",
    icon: "structure" as const,
  },
  {
    label: "पुरावा",
    value: "कामाचा पुरावा",
    detail: "जे काम स्पष्ट होतं, त्याचा पुरावा राहतो.",
    icon: "builder" as const,
  },
  {
    label: "विश्वास",
    value: "स्वतःचा विश्वास",
    detail: "तोच पुरावा हळूहळू तुमचा विश्वास बनतो.",
    icon: "proof" as const,
  },
  {
    label: "ओळख",
    value: "तुमची ओळख",
    detail: "तुमच्या खऱ्या कामातून तुमची ओळख उभी राहते.",
    icon: "memory" as const,
  },
];

const audienceCards = [
  {
    role: "शेतकरी",
    line: "ज्यांना रोजच्या कामात स्पष्टता हवी आहे.",
  },
  {
    role: "मुकादम",
    line: "ज्यांना काम, माणसं आणि जबाबदारी याचा विश्वासार्ह मागोवा हवा आहे.",
  },
  {
    role: "कुटुंबातील शेती व्यवस्थापक",
    line: "ज्यांना घरातील शेती अंदाजावर नाही, तर स्पष्टतेवर चालवायची आहे.",
  },
  {
    role: "ग्रामीण उद्योजक",
    line: "ज्यांना शेतीकडे कामकाज, व्यवस्थापन आणि जबाबदारीच्या नजरेने पाहायचं आहे.",
  },
];

const waitlistFields = ["नाव", "मोबाईल नंबर", "जिल्हा", "तुमची भूमिका", "मुख्य पीक / शेती प्रकार"];

const launchAudienceCards = [
  {
    title: "लहान शेतकरी",
    detail: "जे स्वतः रोज काम पाहतात, पण काय झालं आणि काय बाकी आहे याची स्पष्टता हवी आहे.",
  },
  {
    title: "प्रगतिशील शेतकरी",
    detail: "जे शेतीला अंदाजावर नाही, तर शिस्त, हिशोब आणि सुधारणा यावर चालवू इच्छितात.",
  },
  {
    title: "शेतमालक",
    detail: "जे प्रत्येक वेळी शेतात नसतात, पण काम, खर्च आणि जबाबदारीचा विश्वासार्ह मागोवा हवा आहे.",
  },
  {
    title: "मुकादम / सुपरवायझर",
    detail: "जे मजूर, वेळ आणि कामाचा पुरावा स्पष्ट ठेवून विश्वास वाढवू इच्छितात.",
  },
  {
    title: "कुटुंबाने चालवलेली शेती",
    detail: "जिथे निर्णय, खर्च आणि काम अनेक लोकांमध्ये विभागलेले असतात.",
  },
  {
    title: "भविष्यातील ग्रामीण उद्योजक",
    detail: "जे गावात विश्वासार्ह शेती-कामकाज सांभाळणारे म्हणून उभे राहू इच्छितात.",
  },
];

const valueLadderItems = [
  {
    period: "७ दिवस",
    title: "दररोज काय होतंय ते दिसू लागतं.",
    detail: "काम, माणसं आणि खर्च आठवणीऐवजी स्पष्टपणे समोर येतात.",
  },
  {
    period: "३० दिवस",
    title: "पॅटर्न दिसू लागतात.",
    detail: "कुठे खर्च वाढतो, कोणती कामं राहतात आणि कुठे पुनरावृत्ती होते हे स्पष्ट होतं.",
  },
  {
    period: "१ हंगाम",
    title: "शेताचा वापरता येणारा इतिहास तयार होतो.",
    detail: "कुटुंब चर्चा, मजूर नियोजन आणि पुढच्या निर्णयांसाठी जमिनीचा अनुभव हाताशी राहतो.",
  },
];

const joinProblems = [
  "दैनिक काम स्पष्ट नाही",
  "मजुरी / कामाचा पुरावा नाही",
  "खर्चाचा मागोवा राहत नाही",
  "कुटुंबात समन्वय अवघड आहे",
  "शेतमालकाला स्पष्टता कमी आहे",
  "मुकादम समन्वय",
];

const privacyPrinciples = [
  {
    title: "तुमची माहिती तुमचीच",
    detail: "ती फक्त तुमच्याच संमतीने वापरली जाते.",
  },
  {
    title: "खोटे दावे नाहीत",
    detail: "ShramSafal उत्पन्न वाढीची जादू सांगत नाही; तो रोजच्या कामाला स्पष्टता देण्यापासून सुरू होतो.",
  },
  {
    title: "विश्वास आधी",
    detail: "म्हणूनच आम्ही पहिल्या गटात कमी लोकांसोबत, पण खोलवर काम करतो.",
  },
];

const getCurrentPage = (): PageDefinition => {
  if (typeof window === "undefined") return pages[0];
  return pageByPath.get(window.location.pathname) ?? pages[0];
};

const isMotionPreviewForced = () =>
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("motion") === "on";

function useMotionMode() {
  const reduceMotion = useReducedMotion();
  return isMotionPreviewForced() || !reduceMotion;
}

function AppLink({
  children,
  className,
  href,
  onBeforeNavigate,
  onNavigate,
  tabIndex,
}: {
  children: React.ReactNode;
  className?: string;
  href: string;
  onBeforeNavigate?: () => void;
  onNavigate: (href: string) => void;
  tabIndex?: number;
}) {
  return (
    <a
      className={className}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onBeforeNavigate?.();
        onNavigate(href);
      }}
      tabIndex={tabIndex}
    >
      {children}
    </a>
  );
}

function HoverField({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const motionOn = useMotionMode();

  return (
    <motion.div
      className={`hover-field ${className}`}
      whileHover={
        motionOn
          ? {
              y: -6,
              transition: { duration: 0.22, ease: easeOut },
            }
          : undefined
      }
    >
      {children}
    </motion.div>
  );
}

function LanguageSwitch({
  language,
  onLanguageChange,
}: {
  language: LanguageCode;
  onLanguageChange: (language: LanguageCode) => void;
}) {
  const copy = languageUi[language];

  // Two states, both always visible, with the live one carried by a sliding
  // marker rather than a filled pill. The third "भाषा" button is gone with
  // the gate it used to open.
  return (
    <div
      className="language-switch"
      data-i18n-static="true"
      data-active={language}
      role="group"
      aria-label={copy.switchLabel}
    >
      <span className="language-switch-marker" aria-hidden="true" />
      <button
        aria-pressed={language === "mr"}
        className={language === "mr" ? "is-active" : undefined}
        onClick={() => onLanguageChange("mr")}
        type="button"
      >
        मराठी
      </button>
      <button
        aria-pressed={language === "en"}
        className={language === "en" ? "is-active" : undefined}
        onClick={() => onLanguageChange("en")}
        type="button"
      >
        English
      </button>
    </div>
  );
}

/**
 * First-visit offer to switch to Marathi. Shown only while no language has
 * been chosen, so it never appears in the prerendered HTML (prerender stores
 * "en" first) and never nags a returning visitor. Position is fixed, so it
 * cannot shift the page layout (CLS).
 */
function LanguagePrompt({ onChoose }: { onChoose: (language: LanguageCode) => void }) {
  // Decided after mount, never during the first render: the prerendered HTML
  // has no prompt, and hydration needs the first render to match it.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(getStoredLanguage() === null);
    } catch {
      // storage blocked: stay quiet rather than ask on every page
    }
  }, []);
  if (!open) return null;

  const choose = (language: LanguageCode, method: string) => {
    setOpen(false);
    onChoose(language);
    window.gtag?.("event", "language_choice", { language, method });
  };

  return (
    <div className="language-prompt" data-i18n-static="true" role="dialog" aria-labelledby="language-prompt-title" lang="mr">
      <p className="language-prompt-title" id="language-prompt-title">
        मराठीत वाचायचं आहे?
      </p>
      <p className="language-prompt-sub" lang="en">
        This site is also available in Marathi.
      </p>
      <div className="language-prompt-actions">
        <button className="language-prompt-primary" type="button" onClick={() => choose("mr", "prompt_marathi")}>
          मराठीत वाचा
        </button>
        <button className="language-prompt-secondary" type="button" lang="en" onClick={() => choose("en", "prompt_english")}>
          Continue in English
        </button>
      </div>
      <button className="language-prompt-close" type="button" aria-label="Close" onClick={() => choose("en", "prompt_close")}>
        ×
      </button>
    </div>
  );
}

function NavShell({
  active,
  language,
  onLanguageChange,
  onNavigate,
}: {
  active: RouteKey;
  language: LanguageCode;
  onLanguageChange: (language: LanguageCode) => void;
  onNavigate: (href: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = "page-navigation-panel";

  useEffect(() => {
    setMenuOpen(false);
  }, [active]);

  useEffect(() => {
    if (!menuOpen) return;

    const handleDocumentMouseDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => document.removeEventListener("mousedown", handleDocumentMouseDown);
  }, [menuOpen]);

  const closeMenuAndClearFocus = () => {
    setMenuOpen(false);

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    setMenuOpen(false);
    triggerRef.current?.focus();
  };

  const handleMouseLeave = () => {
    const activeElement = document.activeElement;

    if (
      activeElement &&
      activeElement !== triggerRef.current &&
      menuRef.current?.contains(activeElement)
    ) {
      return;
    }

    setMenuOpen(false);
  };

  return (
    <header className="nav-shell">
      <a
        className="brand-lockup"
        href="/"
        onClick={(event) => {
          event.preventDefault();
          onNavigate("/");
        }}
      >
        <img className="brand-mark" src={markLogo} alt="" width={376} height={480} />
        <img className="brand-wordmark" src={wordmarkLogo} alt="ShramSafal" width={1600} height={220} />
      </a>

      <div className="header-silence">
        <span>{consequenceThesisMarathi}</span>
      </div>

      <LanguageSwitch language={language} onLanguageChange={onLanguageChange} />

      <div
        className={`page-menu${menuOpen ? " is-open" : ""}`}
        onBlur={(event) => {
          const nextTarget = event.relatedTarget;
          if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
            setMenuOpen(false);
          }
        }}
        onFocus={() => setMenuOpen(true)}
        onKeyDown={handleMenuKeyDown}
        onMouseEnter={() => setMenuOpen(true)}
        onMouseLeave={handleMouseLeave}
        ref={menuRef}
      >
        <button
          aria-controls={panelId}
          aria-expanded={menuOpen}
          aria-label="पानांची दिशा उघडा"
          className="page-menu-trigger"
          onClick={() => setMenuOpen((open) => !open)}
          ref={triggerRef}
          type="button"
        >
          <span className="grain-constellation" aria-hidden="true">
            <span className="grain-line grain-line-a" />
            <span className="grain-line grain-line-b" />
            <span className="grain-dot grain-dot-a" />
            <span className="grain-dot grain-dot-b" />
            <span className="grain-dot grain-dot-c" />
            <span className="grain-dot grain-dot-d" />
          </span>
        </button>

        <nav
          aria-hidden={!menuOpen}
          aria-label="पानांची दिशा"
          className="page-menu-panel"
          id={panelId}
        >
          <div className="route-index-caption" aria-hidden="true">
            <span>०१-०५</span>
            <strong>विभाग</strong>
          </div>
          {pages.map((page) => (
            <AppLink
              className={`page-menu-link${active === page.key ? " is-active" : ""}`}
              href={page.href}
              key={page.key}
              onBeforeNavigate={closeMenuAndClearFocus}
              onNavigate={onNavigate}
              tabIndex={menuOpen ? 0 : -1}
            >
              <span>{icons[page.key]}</span>
              <strong>{page.label}</strong>
              <small>{page.eyebrow}</small>
            </AppLink>
          ))}
        </nav>
      </div>
    </header>
  );
}

function MobileLogoRevealMockup() {
  const motionOn = useMotionMode();

  return (
    <div className="logo-reveal-mockup seal-reveal-device" aria-label="श्रमसफल लोगो उलगडणे">
      <div className="seal-reveal-stage">
        <span className="field-grid" aria-hidden="true" />
        <span className="seed-spine seed-spine-a" aria-hidden="true" />
        <span className="seed-spine seed-spine-b" aria-hidden="true" />
        <motion.div
          className="seal-core"
          initial={motionOn ? { opacity: 0, scale: 0.82, rotate: -2 } : false}
          whileInView={{ opacity: 1, scale: 1, rotate: 0 }}
          viewport={{ once: true, margin: "-18%" }}
          transition={{ duration: 0.82, ease: easeOut }}
        >
          <span className="seal-halo halo-a" aria-hidden="true" />
          <span className="seal-halo halo-b" aria-hidden="true" />
          <img className="seal-mark" src={markLogo} alt="" loading="lazy" decoding="async" />
          <img className="seal-wordmark" src={wordmarkLogo} alt="ShramSafal" loading="lazy" decoding="async" />
        </motion.div>
        <div className="proof-constellation" aria-hidden="true">
          {revealChips.map((_, index) => (
            <motion.span
              className={`proof-grain proof-grain-${index + 1}`}
              key={index}
              initial={motionOn ? { opacity: 0, scale: 0.52 } : false}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true, margin: "-18%" }}
              transition={{ duration: 0.42, delay: index * 0.06, ease: easeOut }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}


function HomeSkeleton({ onNavigate }: { onNavigate: (href: string) => void }) {
  const motionOn = useMotionMode();
  const { scrollYProgress } = useScroll();
  const heroImageY = useTransform(scrollYProgress, [0, 0.22], [0, -72]);

  return (
    <div className="home-story">
      <section className="story-scene story-hero" id="top">
        <div className="story-hero-grid">
          <motion.div
            className="story-hero-copy"
            initial={motionOn ? { opacity: 0, y: 30 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: easeOut }}
          >
            <div className="story-lines">
              <span>तुम्ही शेतात मेहनत करता.</span>
              <span>रोज करता.</span>
              <span>वर्षानुवर्षे करत आला आहात.</span>
            </div>
            <motion.div
              className="hero-provocation"
              initial={motionOn ? { opacity: 0, y: 16 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.68, delay: 0.18, ease: easeOut }}
            >
              <strong>पण कधी स्वतःला हा प्रश्न विचारलात का —</strong>
            </motion.div>
            <h1
              className="hero-identity-question"
              aria-label="मी शेतजमीन आहे म्हणून शेतकरी आहे, की शेती एक व्यवसाय म्हणून, नियोजनाने आणि नफ्याच्या दिशेने चालवतो म्हणून शेतकरी आहे?"
            >
              <span className="question-part">मी <span className="hero-highlight-green">शेतजमीन आहे म्हणून</span> शेतकरी आहे,</span>
              <span className="question-divider">की</span>
              <span className="question-part question-part-strong">
                शेती एक <span className="hero-highlight-green">व्यवसाय म्हणून, नियोजनाने आणि नफ्याच्या दिशेने</span>{" "}
                चालवतो म्हणून शेतकरी आहे?
              </span>
            </h1>
            <p>
              शेतीतली खरी ताकद फक्त कष्टात नाही. ती आहे — योग्य वेळी, योग्य ठिकाणी,
              योग्य काम करून घेण्याच्या शिस्तीत.
            </p>
            <div className="hero-actions">
              <AppLink className="primary-link" href="/join" onNavigate={onNavigate}>
                पहिल्या जबाबदार गटात नाव जोडा
                <span aria-hidden="true">→</span>
              </AppLink>
              <AppLink className="secondary-link" href="/farmers" onNavigate={onNavigate}>
                हे कोणासाठी आहे?
              </AppLink>
            </div>
          </motion.div>

          <div className="story-hero-visual">
            <div className="hero-photo-wrapper">
              <motion.img
                src={homeHeroImage}
                alt="दबंग शेतकरी"
                className="hero-photo-card"
                initial={motionOn ? { scale: 1.05, opacity: 0 } : false}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 1, ease: easeOut }}
              />
            </div>

            <motion.div
              className="discipline-spine-card"
              initial={motionOn ? { opacity: 0, y: 28, rotate: -1.2 } : false}
              animate={{ opacity: 1, y: 0, rotate: 0 }}
              transition={{ duration: 0.8, delay: 0.18, ease: easeOut }}
              whileHover={motionOn ? { y: -8, rotate: 0.6 } : undefined}
            >
              <span>शिस्त · मोजमाप</span>
              <strong>तुमच्या शेतीत अशी शिस्त मोजणारी व्यवस्था आहे का?</strong>
              <div className="spine-mini">
                {["काम", "मजुरी", "खर्च", "पुरावा"].map((item) => (
                  <i key={item}>{item}</i>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      <section className="story-scene comfort-lie">
        <div className="scene-copy centered-copy">
          <h2>शेतीत "वाटतं" आणि "खरंच झालं" यात मोठं अंतर असतं.</h2>
          <p>
            जमीन आहे म्हणून शेती करायची असेल, तर अंदाज पुरेसा वाटतो.
            पण रोजचा पगार, वहीतला खर्च आणि नुसती आठवण — यातून काम खरंच
            पूर्ण झालं का, हे कधीच स्पष्ट होत नाही.
          </p>
          <strong className="scene-punch">
            प्रश्न "खर्च झाला का" हा नाही. प्रश्न आहे — तो खर्च समजला का?
          </strong>
        </div>

        <div className="comfort-lie-grid">
          <div className="bento-photo-card bento-span-2">
            <img src={dailyImage} alt="दैनिक वास्तव" loading="lazy" decoding="async" />
            <div className="bento-card-label">दैनिक वास्तव</div>
          </div>

          {memoryCards.map((card, idx) => (
            <HoverField className="bento-text-card" key={card.title}>
              <div className="bento-card-header">
                <span className="bento-card-number">०{idx + 1}</span>
              </div>
              <h3>{card.title}</h3>
              <p>{card.detail}</p>
            </HoverField>
          ))}
        </div>
      </section>

      <section className="story-scene memory-dispersal-hero">
        <div className="dispersal-grid">
          <div className="dispersal-visual">
            <motion.div
              className="dispersal-photo-wrapper"
              initial={motionOn ? { opacity: 0, scale: 0.96 } : false}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true, margin: "-12%" }}
              transition={{ duration: 0.8, ease: easeOut }}
            >
              <img src={workDispersingImage} alt={workDispersalScene.imageAlt} loading="lazy" decoding="async" />
            </motion.div>
          </div>
          
          <div className="dispersal-copy">
            <span className="scene-kicker">{workDispersalScene.kicker}</span>
            <h2>{workDispersalScene.headline}</h2>
            {workDispersalScene.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            <div className="dispersal-quote">
              <strong>{workDispersalScene.quote}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="story-scene illusion-scene">
        <div className="scene-copy">
          <h2>"प्रत्येक शेतकरी म्हणतो — मी माझं १००% दिलं."</h2>
          <p>
            पण प्रत्येकाचं १००% वेगळं असतं. कोणाचं १००% म्हणजे दिवसभर शेतात
            उभं राहणं. कोणाचं म्हणजे जास्तीत जास्त खर्च करणं. कोणाचं म्हणजे
            योग्य वेळी योग्य निर्णय घेणं.
          </p>
          <p>
            आणि शेतीतलं हे १००% पूर्णपणे तुमच्या हातात नसतं — ते रोज बदलणाऱ्या
            गोष्टींवर ठरतं. आणि याच गोष्टींवर तुमचे रोजचे निर्णय अवलंबून असतात.
          </p>
          <p>
            म्हणून खरा प्रश्न "मी १००% दिलं का" हा नाही. खरा प्रश्न आहे —
            <strong> माझं १००% पुरेसं होतं का, हे सांगणारं माप तरी माझ्याकडे आहे का?</strong>
          </p>
          <strong className="scene-punch">
            ते मोजणारं काहीच नसेल, तर "१००%" ही फक्त भावना राहते — पुरावा नाही.
            आणि न मोजलेलं, चुकीच्या दिशेने दिलेलं १००% — ते १००% नसतं, ते नुकसान असतं.
          </strong>
        </div>

        <div className="illusion-visual-radar effort-trial-stage">
          <div className="trial-caption">
            १००% मेहनत तर असते — पण ती पुरेशी होती का, हे ठरवणाऱ्या या गोष्टी आपल्या हातात नसतात:
          </div>
          <div className="trial-radar-field">
            <span className="trial-grain-bed" aria-hidden="true" />
            <span className="trial-pressure-line line-1" aria-hidden="true" />
            <span className="trial-pressure-line line-2" aria-hidden="true" />
            <span className="trial-pressure-line line-3" aria-hidden="true" />
            <motion.div
              className="radar-core effort-claim-card"
              initial={motionOn ? { opacity: 0, scale: 0.9, rotate: -5 } : false}
              whileInView={{ opacity: 1, scale: 1, rotate: -2 }}
              viewport={{ once: true, margin: "-16%" }}
              transition={{ duration: 0.72, ease: easeOut }}
              whileHover={motionOn ? { rotate: 0, scale: 1.03 } : undefined}
            >
              <span className="core-percent">१००%</span>
              <span className="core-label">मेहनत</span>
            </motion.div>
            <span className="trial-verdict-ring" aria-hidden="true" />
            {illusionTriggers.map((trigger, idx) => (
              <motion.div
                key={trigger}
                className={`radar-factor factor-${idx + 1}`}
                style={{ "--factor": idx } as CSSProperties}
                initial={motionOn ? { opacity: 0, x: idx % 2 === 0 ? -18 : 18, y: 10 } : false}
                whileInView={{ opacity: 1, x: 0, y: 0 }}
                viewport={{ once: true, margin: "-16%" }}
                transition={{ duration: 0.48, delay: idx * 0.06, ease: easeOut }}
                whileHover={motionOn ? { y: -5, scale: 1.04 } : undefined}
              >
                <i aria-hidden="true" />
                <span>{trigger}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="story-scene soil-wisdom">
        <div className="soil-wisdom-grid">
          <div className="soil-visual">
            <div className="soil-photo-wrapper">
              <img src={homeSoilImage} alt="हातातली माती आणि उगवणारं रोप" loading="lazy" decoding="async" />
            </div>
            <div className="soil-note-card">
              <span>स्थानिक शहाणपण</span>
              <strong>आपल्या जमिनीचं शहाणपण बाजूला सारून नाही.</strong>
            </div>
          </div>
          
          <div className="scene-copy">
            <h2>प्रत्येक जण शेतकऱ्याला सल्ला द्यायला तयार असतो.</h2>
            <p>
              सल्ला ऐकावाही — पण फक्त "कोणीतरी सांगतंय" म्हणून नाही, तर आपल्या
              जमिनीचं शहाणपण लक्षात घेऊन.
            </p>
            <p>
              प्रत्येक जमिनीचा स्वतःचा स्वभाव असतो. बाहेरचं मार्गदर्शन उपयोगी
              असतं. पण तुमच्या जमिनीचा स्वभाव, तुमच्या कामाचा अनुभव आणि तुमच्या
              निर्णयांचा परिणाम — हे एकत्र दिसलं, तरच खरी समज तयार होते.
            </p>
            <div className="soil-signals">
              {soilSignals.map((signal) => (
                <span key={signal}>{signal}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="story-scene identity-split business-shift">
        <h2>जमीन असणं आणि शेती उभी करणं — या दोन वेगळ्या गोष्टी आहेत.</h2>
        <div className="business-shift-layout">
          <div className="business-left-panel">
            <div className="business-copy">
              <p>
                फक्त उत्पन्न घ्यायचं असेल, तर अंदाज पुरेसा वाटतो. पण शेतीला
                व्यवसाय म्हणून उभं करायचं असेल, तर रोजच्या कामाचं नियोजन,
                खर्चाचा मागोवा, वेळेवर अंमलबजावणी आणि प्रत्येकाच्या मेहनतीचा
                हिशोब — हे पर्याय राहत नाहीत, <strong>गरज</strong> बनतात.
              </p>
              <strong className="business-mantra">
                नियोजन · मोजमाप · जबाबदारी · सुधारणा.
              </strong>
            </div>
            <div className="operator-ladder" aria-label="शेतीची ओळख बदलणारा प्रवास">
              {[
                {
                  label: "जमीन आहे म्हणून शेती",
                  detail: "अंदाज पुरेसा वाटतो. काम चालू राहतं. निर्णय आठवणीवर राहतात.",
                  icon: "farmer" as const,
                },
                {
                  label: "शेतीला व्यवसाय म्हणून उभं करणं",
                  detail: "नियोजन, अंमलबजावणी, खर्चाचा मागोवा आणि जबाबदारी हाच कणा बनतो.",
                  icon: "builder" as const,
                },
              ].map((step, index) => (
                <motion.div
                  className="operator-step"
                  key={step.label}
                  initial={motionOn ? { opacity: 0, x: 24 } : false}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: "-12%" }}
                  transition={{ duration: 0.5, delay: index * 0.08, ease: easeOut }}
                >
                  <span className="step-icon-wrapper">{icons[step.icon]}</span>
                  <strong>{step.label}</strong>
                  <p>{step.detail}</p>
                </motion.div>
              ))}
            </div>
          </div>
          <div className="business-image-panel" aria-hidden="true">
            <img src={homeBusinessImage} alt="" loading="lazy" decoding="async" />
          </div>
        </div>
        <div className="split-panels">
          <HoverField className="split-panel is-muted">
            <span>जमीन आहे म्हणून शेती</span>
            <p>अंदाज पुरेसा वाटतो. काम चालू राहतं. निर्णय आठवणीवर राहतात.</p>
          </HoverField>
          <HoverField className="split-panel is-strong">
            <span>शेतीला व्यवसाय म्हणून उभं करणं</span>
            <p>नियोजन, अंमलबजावणी, खर्चाचा मागोवा आणि जबाबदारी हाच कणा बनतो.</p>
          </HoverField>
        </div>
        <strong className="identity-line">
          शेतकरी असणं ही <span>ओळख</span> आहे. शेती व्यवसाय म्हणून उभी करणं ही <span>जबाबदारी</span> आहे.
        </strong>
      </section>

      <section className="story-scene product-reveal logo-introduction">
        <div className="reveal-topology" aria-hidden="true">
          <svg viewBox="0 0 760 460" role="img">
            <path className="topology-line line-a" d="M18 382 C170 258 286 320 412 184 C504 84 630 72 742 34" />
            <path className="topology-line line-b" d="M42 430 C176 348 320 388 430 248 C520 132 622 126 720 94" />
            <path className="topology-line line-c" d="M96 78 C188 178 272 122 378 236 C484 348 612 314 724 402" />
            <circle cx="412" cy="184" r="4" />
            <circle cx="430" cy="248" r="4" />
            <circle cx="378" cy="236" r="4" />
          </svg>
        </div>

        <div className="scene-copy reveal-copy">
          <h2 className="reveal-heading">याच विचारातून उभं राहत आहे.</h2>
          <motion.div
            className="brand-reveal logo-orbit"
            initial={motionOn ? { opacity: 0, scale: 0.92, y: 18 } : false}
            whileInView={{ opacity: 1, scale: 1, y: 0 }}
            viewport={{ once: true, margin: "-16%" }}
            transition={{ duration: 0.74, ease: easeOut }}
          >
            <span className="orbit-ring ring-a" aria-hidden="true" />
            <span className="orbit-ring ring-b" aria-hidden="true" />
            <span className="orbit-dot dot-a" aria-hidden="true" />
            <span className="orbit-dot dot-b" aria-hidden="true" />
            <img className="reveal-mark" src={markLogo} alt="" loading="lazy" decoding="async" />
            <img className="reveal-wordmark" src={wordmarkLogo} alt="ShramSafal" loading="lazy" decoding="async" />
          </motion.div>
          <p>
            रोजच्या शेतकामाला दिशा, हिशोब आणि जबाबदारीचा कणा देणारी एक व्यवस्था.
            काम, मजुरी, खर्च, वेळ, निरीक्षण आणि पुरावा — या सगळ्याला रोज एका
            स्पष्ट नोंदीत आणणारी.
          </p>
          <p>
            ShramSafal ची सुरुवात रोजच्या कामाच्या स्पष्टतेपासून होते. आणि तीच
            स्पष्टता पुढे शेतीचा कणा बनत जाते.
          </p>
          <p>
            जे काम स्पष्ट होतं, त्याचा पुरावा राहतो. आणि तोच पुरावा हळूहळू
            तुमचा विश्वास — तुमची ओळख बनतो.
          </p>
          <p className="future-hint-copy">
            हीच स्पष्टता सातत्याने तयार होत राहिली, तर याच आधारावर
            उद्या — <strong>मजूर नियोजन, कामाची कार्यक्षमता, शेतमालकाची नजर,
            गावातील कामाची मागणी आणि बाजाराशी जोडणी</strong> — यांचे नवे मार्ग
            उघडू शकतात.
          </p>
          <strong className="scene-punch">आजच्या कामाची स्पष्टता उद्याच्या मोठ्या निर्णयांचा पाया बनू शकते.</strong>
          <div className="reveal-principles" aria-label="श्रमसफल उलगडण्याची तत्त्वे">
            {["आजच्या कामासाठी", "पुढच्या निर्णयासाठी", "पुढच्या हंगामासाठी", "पुढच्या पिढीसाठी"].map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>

        <motion.div
          className="reveal-machine"
          initial={motionOn ? { opacity: 0, y: 36 } : false}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-14%" }}
          transition={{ duration: 0.72, delay: 0.12, ease: easeOut }}
          whileHover={motionOn ? { y: -8, rotateX: 1.2 } : undefined}
        >
          <MobileLogoRevealMockup />

          <div className="reveal-details-column">
            <div className="system-flow-strip" aria-label="श्रमसफलचा दैनिक कामकाज प्रवाह">
              {revealChips.map((chip, index) => (
                <span key={chip} style={{ "--chip": index } as CSSProperties}>{chip}</span>
              ))}
            </div>

            <div className="proof-spine" aria-label="श्रमसफलचा कामकाज कणा">
              <span className="spine-light" aria-hidden="true" />
              {revealProofs.map((proof, index) => (
                <div className="proof-node" key={proof.label} style={{ "--node": index } as CSSProperties}>
                  <div className="node-icon-header">
                    {icons[proof.icon]}
                    <small>{proof.label}</small>
                  </div>
                  <strong>{proof.value}</strong>
                  <p>{proof.detail}</p>
                </div>
              ))}
            </div>

            <div className="memory-seal">
              <span>स्पष्टता → पुरावा → विश्वास → ओळख</span>
              <strong>आजच्या कामाची स्पष्टता उद्याच्या मोठ्या निर्णयांचा पाया बनू शकते.</strong>
            </div>
          </div>
        </motion.div>
      </section>

      <section className="story-scene audience-scene">
        <div className="scene-copy centered-copy">
          <h2>हे प्रत्येकासाठी नाही.</h2>
          <p>
            हे त्यांच्यासाठी आहे जे शेतीकडे फक्त जमीन म्हणून नाही, तर जबाबदारी
            म्हणून पाहतात.
          </p>
        </div>
        <div className="audience-grid">
          <div className="audience-image-panel" aria-hidden="true">
            <img src={homeAudienceImage} alt="" loading="lazy" decoding="async" />
          </div>
          <div className="audience-cards-container">
            {audienceCards.map((card) => (
              <HoverField className="audience-card" key={card.role}>
                <span>{card.role}</span>
                <p>{card.line}</p>
              </HoverField>
            ))}
          </div>
        </div>
      </section>

      <section className="story-scene final-commitment" id="waitlist">
        <div className="waitlist-card">
          <div className="waitlist-image-column" aria-hidden="true">
            <img src={homeCtaImage} alt="मातीत रुजणारी नवी सुरुवात" loading="lazy" decoding="async" />
          </div>
          
          <div className="waitlist-content-column">
            <div className="commitment-copy">
              <h2>तुम्ही शेती करता. पण ती व्यवसायासारखी चालवता का?</h2>
              <p>
                हा प्रश्न मनात अडकला असेल, तर ShramSafal तुमच्यासाठी आहे. पहिल्या
                जबाबदार गटात तुमचं नाव जोडा.
              </p>
              <strong>
                जमीन वारशाने मिळते. पण शेतीला व्यवसाय बनवणारी रोजची शिस्त — आणि
                स्वतःचा विश्वास — स्वतः उभा करावा लागतो.
              </strong>
            </div>
            
            <div className="visual-waitlist" aria-label="फॉर्मची दृश्य झलक">
              {waitlistFields.map((field) => (
                <div className="visual-field" key={field}>
                  <span>{field}</span>
                </div>
              ))}
              <AppLink className="visual-button" href="/join" onNavigate={onNavigate}>
                पहिल्या जबाबदार गटात नाव जोडा
              </AppLink>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function VisionPhilosophyPage({ onNavigate }: { onNavigate: (href: string) => void }) {
  const motionOn = useMotionMode();
  const visionQuestions = [
    "कोणतं काम झालं?",
    "कोणी केलं?",
    "किती खर्च झाला?",
    "कुठे अडचण आली?",
    "काय बाकी आहे?",
    "पुढच्या निर्णयावर परिणाम काय?",
  ];
  const beliefLines = [
    "मालक, कुटुंब, मुकादम आणि कामगार — सगळ्यांना एकाच सत्यावर आणण्यासाठी.",
    "दिवसाचं काम विसरू नये म्हणून.",
    "खर्चाचा अर्थ समजावा म्हणून.",
    "कामाचा पुरावा राहावा म्हणून.",
    "शेत पुढच्या पिढीसाठी केवळ जमीन न राहता, शिकलेला अनुभव बनावा म्हणून.",
  ];

  return (
    <main className="vision-page">
      <section className="vision-hero">
        <motion.div
          className="vision-hero-copy"
          initial={motionOn ? { opacity: 0, y: 24 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.72, ease: easeOut }}
        >
          <span className="vision-kicker">दृष्टी व विचार</span>
          <h1>श्रमसफलची दृष्टी</h1>
          <p>
            आपल्या देशातला शेतकरी मेहनतीला कधीच कमी पडत नाही. कमी पडते ती —
            त्या मेहनतीला मिळणारी <strong>दिशा, स्पष्टता आणि पुरावा.</strong>
          </p>
          <strong>
            श्रमसफलची दृष्टी एकच आहे — शेतातली रोजची मेहनत हरवू नये; ती स्पष्ट
            नोंदीत, विश्वासात आणि चांगल्या निर्णयांत बदलावी.
          </strong>
        </motion.div>

        <motion.div
          className="vision-proof-panel"
          initial={motionOn ? { opacity: 0, scale: 0.96, y: 20 } : false}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.82, delay: 0.08, ease: easeOut }}
        >
          <span className="vision-field-grid" aria-hidden="true" />
          <div className="vision-proof-core">
            <span>मेहनत</span>
            <strong>स्पष्टता</strong>
            <span>निर्णय</span>
          </div>
          <div className="vision-proof-flow">
            {["काम", "खर्च", "मजुरी", "अडचण", "पुरावा", "इतिहास"].map((item) => (
              <i key={item}>{item}</i>
            ))}
          </div>
        </motion.div>
      </section>

      <section className="vision-narrative">
        <div className="vision-copy-block">
          <span className="vision-kicker">मूळ विचार</span>
          <h2>शेतकऱ्याला कष्टाची कमी नाही. कमी आहे — शेतीची <strong>विश्वासार्ह स्मृती.</strong></h2>
          <p>
            रोज काम होतं. मजूर येतात. खर्च होतो. फवारणी होते. पाणी दिलं जातं.
            निर्णय घेतले जातात.
          </p>
          <p>
            पण दिवस संपला, की त्यातला बराचसा भाग आठवणीतून हळूहळू पुसतो.
          </p>
          <strong>शेतीचं भविष्य बदलायचं असेल, तर <span>आधी रोजचं हे सत्य स्पष्ट करावं लागतं.</span></strong>
        </div>
        <div className="vision-owner-card">
          <span>आभाळ आणि जमीन</span>
          <strong>सॅटेलाइट आभाळातून शेत दाखवतो. पण शेताची खरी नाडी आभाळातून समजत नाही — ती समजते रोज मातीत राबणाऱ्या हातांना.</strong>
          <p>
            आज काय झालं, काय राहिलं आणि कुठे अडलं — हे जमिनीवरच, रोजच्या कामातूनच
            कळतं. म्हणून आधी गरज मोठ्या तंत्रज्ञानाची नाही, स्पष्टतेची आहे. आणि
            एकदा ती स्पष्टता तयार झाली, की तंत्रज्ञान नेमकं कुठे वापरायचं, हेही
            तीच सांगते.
          </p>
        </div>
      </section>

      <motion.figure
        className="vision-memory-interlude"
        initial={motionOn ? { opacity: 0, y: 28, scale: 0.985 } : false}
        whileInView={{ opacity: 1, y: 0, scale: 1 }}
        viewport={{ once: true, margin: "-14%" }}
        transition={{ duration: 0.78, ease: easeOut }}
      >
        <img src={visionReflectionImage} alt="शेतातील रोजच्या कामाची नोंद पाहणारा शेतकरी" />
        <span aria-hidden="true" />
      </motion.figure>

      <section className="vision-philosophy-section">
        <div className="vision-section-heading">
          <span>खालचा थर आधी</span>
          <h2>शेतीचे प्रश्न नेहमी "बाजाराशी जोडणी" इथून सुरू होतात असं म्हटलं जातं.</h2>
        </div>
        <div className="vision-philosophy-layout">
          <div className="vision-philosophy-copy">
            <p>
              पण बाजाराशी जोडणी हा <strong>वरचा थर</strong> आहे. त्याच्या खाली एक
              मूलभूत प्रश्न आहे — <strong>कामाचं सत्य.</strong>
            </p>
            <p>
              नक्की काय काम झालं, कधी झालं, कोणी केलं, किती खर्च आला, ते नीट
              पूर्ण झालं का, आणि काय राहिलं — याचं स्पष्ट उत्तर कोणाकडेच नसतं.
            </p>
            <p>
              श्रमसफल इथून सुरू होतं — सगळ्यात <strong>खालच्या थरापासून:
              रोजच्या कामाच्या सत्यापासून.</strong> हा थर एकदा उभा
              राहिला, की त्यावर पुढचे अनेक थर शक्य होतात.
            </p>
            <strong>
              आणि या सगळ्याखालचा सगळ्यात खोल थर म्हणजे — <span>विश्वास.</span>
              कामाचं सत्य स्पष्ट झालं, की शेतकऱ्याच्या कष्टाला पुरावा मिळतो;
              आणि तोच पुरावा त्याची खरी ओळख बनतो.
            </strong>
          </div>
          <div className="vision-operating-strip" aria-label="कामाच्या सत्याचे थर">
            {["सत्य", "स्पष्टता", "पुरावा", "विश्वास"].map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="vision-question-grid" aria-label="शेतीच्या स्पष्टतेचे प्रश्न">
        {visionQuestions.map((question, index) => (
          <HoverField className="vision-question-card" key={question}>
            <span>०{index + 1}</span>
            <strong>{question}</strong>
          </HoverField>
        ))}
      </section>

      <section className="vision-narrative">
        <div className="vision-owner-card">
          <span>शेतकरी म्हणजे</span>
          <strong>मालक. निर्णय घेणारा. जोखीम उचलणारा. खर्च करणारा. भविष्य घडवणारा.</strong>
          <p>म्हणून शेतीला केवळ कष्टाची नाही, <strong>स्पष्टतेची</strong> गरज आहे.</p>
        </div>
      </section>

      <section className="vision-philosophy-section">
        <div className="vision-section-heading">
          <span>आमची विचारसरणी</span>
          <h2>श्रमसफल रोजच्या शेतकामाला <strong>स्पष्टता</strong> देतं.</h2>
        </div>
        <div className="vision-philosophy-layout">
          <div className="vision-philosophy-copy">
            <p>
              दिवसभरातलं विखुरलेलं काम एकत्र, समजेल अशा रूपात.
            </p>
            <p>
              दिवसभराचं काम स्पष्ट झालं, की त्याची आठवण टिकते, कामाचा पुरावा
              राहतो — आणि त्यावर पुढचा योग्य निर्णय घेता येतो.
            </p>
            <strong>
              खरी ताकद लिहिण्यात नाही. ती आहे — त्या स्पष्टतेतून मिळणाऱ्या
              <span> समजुतीत आणि विश्वासात.</span>
            </strong>
          </div>
          <div className="vision-operating-strip" aria-label="कामापासून विश्वासापर्यंत">
            {["काम", "स्पष्टता", "पुरावा", "विश्वास"].map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="vision-belief-section">
        <div className="vision-belief-lead">
          <span>आम्ही काय मानतो</span>
          <h2>दिशेविना केलेली मेहनत म्हणजे हरवलेली मेहनत.</h2>
          <p>
            शेतीतला नफा फक्त जास्त उत्पादनातून येत नाही. तो येतो — योग्य वेळी
            योग्य निर्णय घेतल्याने, चुकीचा खर्च टाळल्याने, कामाची पुनरावृत्ती
            थांबवल्याने आणि शेतात नेमकं काय चाललंय याची स्पष्टता मिळाल्याने.
          </p>
        </div>
        <div className="vision-belief-list">
          {beliefLines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      </section>

      <section className="vision-trust-section">
        <div>
          <span>श्रमसफलचा विश्वास</span>
          <h2>शेत चालतं मेहनतीवर. पण शेती वाढते स्पष्टतेवर.</h2>
          <p>पण शेती वाढते स्पष्टतेवर — आणि टिकते विश्वासावर.</p>
          <strong>श्रमसफल ही त्याच स्पष्टतेची, आणि त्या विश्वासाची, सुरुवात आहे.</strong>
        </div>
        <AppLink href="/" onNavigate={onNavigate} className="back-link vision-back-link">
          ← मुख्यपृष्ठ
        </AppLink>
      </section>
    </main>
  );
}

function FarmersOperatorsPage({ onNavigate }: { onNavigate: (href: string) => void }) {
  const motionOn = useMotionMode();

  return (
    <main className="launch-page farmers-launch-page">
      <section className="launch-hero">
        <motion.div
          className="launch-hero-copy"
          initial={motionOn ? { opacity: 0, y: 24 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.72, ease: easeOut }}
        >
          <span className="launch-kicker">शेतकरी व कामकाज सांभाळणाऱ्यांसाठी</span>
          <h1>१० गुंठे असो किंवा १०० एकर — शेती चालवण्यासाठी स्पष्टता लागतेच.</h1>
          <p>
            ShramSafal प्रत्येकासाठी नाही. हे त्यांच्यासाठी आहे जे शेतीकडे फक्त
            जमीन म्हणून नाही, तर रोज चालणारी जबाबदारी म्हणून पाहतात.
          </p>
          <strong>
            शेतकरी फक्त उत्पादन घेत नाही. तो रोज एक जिवंत व्यवस्था चालवतो.
          </strong>
          <div className="launch-actions">
            <AppLink className="primary-link" href="/join" onNavigate={onNavigate}>
              पहिल्या जबाबदार गटात नाव जोडा
              <span aria-hidden="true">→</span>
            </AppLink>
            <AppLink className="secondary-link" href="/privacy-trust" onNavigate={onNavigate}>
              विश्वास कसा ठेवतो?
            </AppLink>
          </div>
        </motion.div>

        <motion.div
          className="launch-image-panel field-operator-panel"
          initial={motionOn ? { opacity: 0, scale: 0.96, y: 22 } : false}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.82, delay: 0.06, ease: easeOut }}
          aria-hidden="true"
        >
          <img src={farmersHeroImage} alt="" />
          <div className="field-proof-orbit">
            {["काम", "माणसं", "खर्च", "जबाबदारी"].map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </motion.div>
      </section>

      <section className="vision-belief-section">
        <div className="vision-belief-lead">
          <span>रोजची तफावत</span>
          <h2>काम होतं. पण रात्री त्यातलं अर्धं आठवणीतच राहतं.</h2>
          <p>प्रश्न मेहनतीचा नाही. प्रश्न आहे — ती मेहनत स्पष्ट पुराव्यात उरते का?</p>
        </div>
        <div className="vision-belief-list">
          {[
            "०१ · काम झालं, पण नोंद कच्ची राहिली. कोणतं काम, कुठल्या वाफ्यात, कोणी केलं — नंतर नीट आठवत नाही.",
            "०२ · खर्च झाला, पण कारण अस्पष्ट. पैसा गेला हे कळतं; कशावर आणि तेवढाच का — हे लागत नाही.",
            "०३ · मजूर आले, पण खरं काम किती? हजेरी लागते; प्रत्यक्ष किती काम झालं याचा मागोवा राहत नाही.",
            "०४ · कामं राहिली, पण एकत्र चित्र नाही. काय राहिलं, काय तातडीचं — एका नजरेत कुठेच दिसत नाही.",
          ].map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      </section>

      <section className="scene-copy centered-copy">
        <h2>हे कोणासाठी आहे</h2>
      </section>

      <section className="audience-launch-grid" aria-label="ShramSafal कोणासाठी आहे">
        {launchAudienceCards.map((card, index) => (
          <HoverField className="launch-audience-card" key={card.title}>
            <span>०{index + 1}</span>
            <strong>{card.title}</strong>
            <p>{card.detail}</p>
          </HoverField>
        ))}
      </section>

      <section className="vision-philosophy-section">
        <div className="vision-section-heading">
          <span>मुकादमपासून ग्रामीण उद्योजकापर्यंत</span>
          <h2>मुकादम म्हणजे फक्त मजूर पुरवणारा दुवा नाही.</h2>
        </div>
        <div className="vision-philosophy-layout">
          <div className="vision-philosophy-copy">
            <p>
              ज्याच्याकडे माणसं जोडण्याची क्षमता आहे, काम उभं करण्याची जबाबदारी
              आहे आणि गावात विश्वास आहे — त्याच्यासाठी ShramSafal उद्या
              <strong> गावातलं शेती-कामकाज जबाबदारीने सांभाळणारा उद्योजक</strong>
              बनण्याचा पाया ठरू शकतो.
            </p>
            <p>
              रोजच्या कामाच्या स्पष्ट हिशोबातून उद्या — कोणत्या मजूर
              गटाचं काम चांगलं आहे, कोणत्या भागात कोणतं काम येणार आहे, आणि कोणत्या
              शेताला कधी माणसांची गरज भासणार आहे — हे समजण्याची दिशा तयार होऊ शकते.
            </p>
            <strong>
              आज ही फक्त रोजची स्पष्टता आहे. पण याच स्पष्टतेवर उद्याची व्यवस्था —
              आणि तुमची स्वतःची विश्वासार्ह ओळख — उभी राहू शकते.
            </strong>
          </div>
          <div className="vision-operating-strip" aria-label="मुकादम ते ग्रामीण उद्योजक">
            {["माणसं", "काम", "जबाबदारी", "विश्वास"].map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="value-ladder-section">
        <div className="value-ladder-heading">
          <span className="launch-kicker">रोजची स्पष्टता, हंगामभराचा फरक</span>
          <h2>ShramSafal एका दिवसात चमत्कार करत नाही. तो दररोज स्पष्टता तयार करतो.</h2>
          <p>तो रोज थोडी थोडी स्पष्टता तयार करतो.</p>
        </div>
        <div className="value-ladder-grid">
          {valueLadderItems.map((item) => (
            <HoverField className="value-ladder-card" key={item.period}>
              <span>{item.period}</span>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
            </HoverField>
          ))}
        </div>
      </section>

      <section className="official-identity" aria-label="अधिकृत ओळख">
        <span className="launch-kicker">अधिकृत ओळख</span>

        <div className="official-identity-card">
          <img
            className="official-identity-mark"
            src={arveLogo}
            alt="Agriryot Value Enterprises Private Limited"
            loading="lazy"
            decoding="async"
          />
          <dl className="official-identity-facts">
            <div>
              <dt>कंपनी</dt>
              <dd>Agriryot Value Enterprises Private Limited</dd>
            </div>
            <div>
              <dt>CIN</dt>
              <dd className="is-mono">U62099PN2026PTC256337</dd>
            </div>
            <div>
              <dt>नोंदणी</dt>
              <dd>Maharashtra, India</dd>
            </div>
            <div>
              <dt>संपर्क</dt>
              <dd>
                <a href="mailto:arvesystems@gmail.com">arvesystems@gmail.com</a>
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="privacy-cta-strip">
        <div>
          <span className="launch-kicker">सुरुवात</span>
          <h2>रोजची छोटी स्पष्टता, हंगामाच्या शेवटी मोठा फरक दाखवते.</h2>
          <p><strong>पुढची शेती अंदाजावर नाही, नोंदीवर चालणार आहे.</strong></p>
        </div>
        <AppLink className="primary-link" href="/join" onNavigate={onNavigate}>
          पहिल्या जबाबदार गटात नाव जोडा
          <span aria-hidden="true">→</span>
        </AppLink>
      </section>
    </main>
  );
}

// Google Apps Script web app that appends each submission to the
// "Web Inbound" sheet. Public by necessity — any browser-submitted form
// exposes its endpoint. Spam is handled by the honeypot field below, and
// the script itself rejects anything without a name and mobile.
const WAITLIST_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbz46TEB86d8PIv1ovonsQlICEzMe21sbxuNYmyUPrGKYkNsMhsMPXM_RPZXte17Ey9J/exec";

type SubmitState = "idle" | "sending" | "sent" | "error";

function JoinEarlyAccessPage({ onNavigate }: { onNavigate: (href: string) => void }) {
  const motionOn = useMotionMode();
  const [status, setStatus] = useState<SubmitState>("idle");
  const submitted = status === "sent";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === "sending") return;

    const form = event.currentTarget;
    const payload: Record<string, string> = {
      language: document.documentElement.lang || "mr",
    };
    new FormData(form).forEach((value, key) => {
      payload[key] = typeof value === "string" ? value : "";
    });

    setStatus("sending");
    try {
      // text/plain, not application/json: a JSON content-type triggers a CORS
      // preflight (OPTIONS) that Apps Script does not answer, so the request
      // would never arrive. The body is still JSON; the script parses it.
      const response = await fetch(WAITLIST_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
        redirect: "follow",
      });
      const result = (await response.json()) as { ok?: boolean };
      if (!response.ok || !result?.ok) throw new Error("not saved");

      // Only now — the row exists.
      setStatus("sent");
      form.reset();
    } catch {
      // Never show a thank-you we cannot stand behind.
      setStatus("error");
    }
  };

  return (
    <main className="launch-page join-launch-page">
      <section className="join-layout">
        <motion.div
          className="join-copy-panel"
          initial={motionOn ? { opacity: 0, y: 24 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.72, ease: easeOut }}
        >
          <span className="launch-kicker">पहिला जबाबदार गट</span>
          <h1>जर हा प्रश्न मनात अडकला असेल, तर ShramSafal तुमच्यासाठी आहे.</h1>
          <p>
            तुम्हाला रोजच्या शेतीकामाला दिशा, हिशोब, निरीक्षण आणि जबाबदारी
            द्यायची असेल, तर पहिल्या जबाबदार गटात तुमचं नाव जोडा.
          </p>
          <div className="join-commitment-line">
            आम्ही आधी कमी शेतकऱ्यांसोबत खोलवर काम करणार आहोत, कारण विश्वास
            घाईत तयार होत नाही.
          </div>
          <div className="join-commitment-line">
            <strong>हा गट लहान का</strong>
            <span>
              आम्हाला फक्त वापरकर्ते नकोत. आम्हाला असे शेतकरी, मुकादम आणि
              ग्रामीण उद्योजक हवेत — जे शेतीला शिस्त, स्पष्टता आणि जबाबदारीने
              चालवू इच्छितात.
            </span>
          </div>
          <div className="vision-belief-list">
            {[
              "जवळून काम — तुमची शेती आणि तुमची पद्धत समजून घेऊन सुरुवात.",
              "तुमचं म्हणणं ऐकलं जातं — पहिल्या गटातल्या अनुभवातून ShramSafal घडत जातं.",
              "थेट संपर्क — टीम स्वतः तुमच्याशी बोलते; तुम्ही गर्दीतला एक नंबर नाही.",
            ].map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
          <div className="join-commitment-line">
            इथली सुरुवात म्हणजे फक्त एक सुविधा वापरणं नाही — तुमच्या रोजच्या
            खऱ्या कामातून स्वतःची विश्वासार्ह ओळख घडवायला सुरुवात करणं.
          </div>
          <div className="join-image-slab" aria-hidden="true">
            <img src={joinGroupImage} alt="" />
          </div>
        </motion.div>

        <motion.div
          className="early-access-panel"
          initial={motionOn ? { opacity: 0, y: 28 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.76, delay: 0.08, ease: easeOut }}
        >
          <form className="early-access-form" onSubmit={handleSubmit}>
            {/* Honeypot: hidden from people, irresistible to bots. A filled
                value makes the script discard the submission silently. */}
            <input
              aria-hidden="true"
              autoComplete="off"
              className="hp-field"
              name="company_website"
              tabIndex={-1}
            />
            <div className="form-row two-col">
              <label>
                नाव
                <input name="name" required autoComplete="name" placeholder="तुमचं नाव" />
              </label>
              <label>
                मोबाईल नंबर
                <input name="mobile" required inputMode="tel" autoComplete="tel" placeholder="मोबाईल नंबर" />
              </label>
            </div>
            <div className="form-row two-col">
              <label>
                जिल्हा / तालुका
                <input name="district" required placeholder="उदा. नाशिक / दिंडोरी" />
              </label>
              <label>
                गावाचे नाव
                <input name="village" required placeholder="गाव" />
              </label>
            </div>
            <div className="form-row two-col">
              <label>
                शेतीचा आकार
                <input name="farm-size" placeholder="उदा. २ एकर / २० गुंठे" />
              </label>
              <label>
                मुख्य पीक / शेती प्रकार
                <input name="crop" required placeholder="द्राक्ष, कांदा, भाजीपाला..." />
              </label>
            </div>
            <div className="form-row two-col">
              <label>
                तुमची भूमिका
                <select name="role" required defaultValue="">
                  <option value="" disabled>भूमिका निवडा</option>
                  <option>शेतकरी</option>
                  <option>शेतमालक</option>
                  <option>मुकादम / सुपरवायझर</option>
                  <option>कुटुंबातील शेती व्यवस्थापक</option>
                  <option>ग्रामीण उद्योजक</option>
                </select>
                <span className="field-help">
                  शेतकरी / शेतमालक / मुकादम / सुपरवायझर / कुटुंबातील शेती व्यवस्थापक / ग्रामीण उद्योजक
                </span>
              </label>
              <label>
                मजूर व्यवस्थापन करता का?
                <select name="labour" required defaultValue="">
                  <option value="" disabled>निवडा</option>
                  <option>हो</option>
                  <option>नाही</option>
                  <option>कधी कधी</option>
                </select>
              </label>
            </div>
            <label>
              सध्याची सर्वात मोठी अडचण
              <select name="problem" required defaultValue="">
                <option value="" disabled>अडचण निवडा</option>
                {joinProblems.map((problem) => (
                  <option key={problem}>{problem}</option>
                ))}
              </select>
            </label>
            <label>
              थोडक्यात सांगा
              <textarea name="note" rows={4} placeholder="आज शेतीकामाचा मागोवा कुठे अडकतो?" />
            </label>
            <button
              className="early-submit-button"
              type="submit"
              disabled={status === "sending"}
            >
              {status === "sending" ? "पाठवत आहे..." : "ShramSafal प्रवेश विनंती पाठवा"}
            </button>

            {status === "error" ? (
              <p className="form-error-note" role="alert">
                पाठवता आलं नाही. पुन्हा प्रयत्न करा.
              </p>
            ) : null}
          </form>

          <div className="form-trust-note">
            फॉर्म भरताना अडलात तर काळजी नको — फक्त नाव आणि नंबर द्या, बाकीचं आपण बोलताना ठरवू.
          </div>

          <section className="value-ladder-section join-value-ladder">
            <div className="value-ladder-heading">
              <span className="launch-kicker">तुम्हाला काय मिळेल</span>
              <h2>रोजची छोटी स्पष्टता, हंगामभरात मोठा फरक.</h2>
            </div>
            <div className="value-ladder-grid">
              {[
                { period: "७ दिवसांत", title: "आजचं आणि राहिलेलं काम वेगळं दिसू लागतं.", detail: "" },
                { period: "३० दिवसांत", title: "खर्च कुठे वाढतो आणि कुठे पुनरावृत्ती होते हे स्पष्ट होतं.", detail: "" },
                { period: "१ हंगामात", title: "शेताचा स्वतःचा वापरता येणारा इतिहास तयार होतो; पुढचे निर्णय अंदाजावर नाही, नोंदीवर.", detail: "" },
              ].map((item) => (
                <HoverField className="value-ladder-card" key={item.period}>
                  <span>{item.period}</span>
                  <strong>{item.title}</strong>
                </HoverField>
              ))}
            </div>
          </section>

          <section className="vision-belief-section join-promise-section">
            <div className="vision-belief-lead">
              <span>प्रामाणिक वचन</span>
              <h2>जे करू शकतो ते सांगतो. जे करू शकत नाही, तेही सांगतो.</h2>
            </div>
            <div className="vision-belief-list">
              <div><strong>आम्ही देतो</strong> — रोजच्या कामाची स्पष्ट, विश्वासार्ह नोंद. खर्चाचा मागोवा. राहिलेल्या कामाचा पाठपुरावा. आणि ते सगळं, पूर्णपणे तुमचंच.</div>
              <div><strong>आम्ही देत नाही</strong> — "वापरा आणि नफा वाढेल" असं खोटं वचन नाही. नफा हमीने मिळत नाही. पण रोजचं काम, खर्च आणि पाठपुरावा स्पष्ट असला, की चांगला निर्णय घेणं सोपं होतं — आणि तीच नफ्याच्या दिशेने पहिली पायरी आहे.</div>
            </div>
          </section>

          <section className="vision-question-grid" aria-label="नाव दिल्यानंतर पुढे काय">
            {[
              "टीम तुम्हाला फोन करते. घाई नाही, विक्रीचा दबाव नाही.",
              "तुमची शेती, तुमची पद्धत आणि सध्याची अडचण समजून घेतली जाते.",
              "तुम्हाला सोयीचं असेल तेव्हा, प्रत्यक्ष बघून पुढचं ठरवू — आधी बघा, मग ठरवा.",
            ].map((step, index) => (
              <HoverField className="vision-question-card" key={step}>
                <span>{index + 1}</span>
                <strong>{step}</strong>
              </HoverField>
            ))}
          </section>

          <AnimatePresence>
            {submitted ? (
              <motion.div
                className="form-success-note"
                role="status"
                aria-live="polite"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
              >
                <strong>धन्यवाद.</strong>
                <span>
                  ShramSafal टीम तुमच्याशी संपर्क करेल. आम्ही आधी कमी
                  शेतकऱ्यांसोबत खोलवर काम करणार आहोत, कारण विश्वास घाईत तयार
                  होत नाही.
                </span>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <p className="form-trust-note">
            तुमच्या शेताची माहिती तुमची आहे. ShramSafal ती जबाबदारीने आणि
            संमतीनेच वापरेल.
          </p>
          <AppLink className="privacy-inline-link" href="/privacy-trust" onNavigate={onNavigate}>
            विश्वासाचा कणा वाचा →
          </AppLink>
        </motion.div>
      </section>
    </main>
  );
}

function PrivacyTrustPage({ onNavigate }: { onNavigate: (href: string) => void }) {
  const motionOn = useMotionMode();

  return (
    <main className="launch-page privacy-launch-page">
      <section className="privacy-hero">
        <motion.div
          className="privacy-hero-copy"
          initial={motionOn ? { opacity: 0, y: 24 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.72, ease: easeOut }}
        >
          <span className="launch-kicker">विश्वास हाच कणा</span>
          <h1>शेतीत सगळ्यात जास्त कमी पडतो तो एकच — विश्वास.</h1>
          <p>
            शेतकरी वर्षानुवर्षे खरं काम करतो, मेहनत करतो, प्रामाणिक व्यवहार करतो.
            पण त्या कष्टाला आणि त्या प्रामाणिकपणाला विश्वासार्ह ठरवणारं कोणतंच
            माप त्याच्याकडे नाही.
          </p>
          <strong>
            ShramSafal ची सुरुवातच इथून होते — तुमच्या खऱ्या कामातून तुमचा
            स्वतःचा विश्वास उभा करण्यापासून.
          </strong>
        </motion.div>

        <motion.div
          className="trust-ledger-visual"
          initial={motionOn ? { opacity: 0, scale: 0.96 } : false}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.08, ease: easeOut }}
          aria-hidden="true"
        >
          <img src={privacyTrustImage} alt="" fetchPriority="high" />
          <div className="trust-seal">
            <span>पुरावा</span>
            <strong>विश्वास</strong>
            <span>ओळख</span>
          </div>
        </motion.div>
      </section>

      <section className="vision-belief-section">
        <div className="vision-belief-lead">
          <span>विश्वास का उभा राहत नाही</span>
          <h2>व्यवसायात विश्वास सहज मिळत नाही — तो कमवावा लागतो.</h2>
          <p>
            मोठ्या व्यापारी वर्तुळात ठरावीक लोकांनाच प्रवेश असतो. कारण तिथे
            प्रत्येकाच्या कामाची, व्यवहाराची आणि शब्दाची एक पाठराखण असते —
            कोणीतरी खात्रीने सांगू शकतं, "हा माणूस विश्वासार्ह आहे."
          </p>
        </div>
        <div className="vision-belief-list">
          <div>पण शेतकऱ्याच्या बाजूला अशी पाठराखण कोणाचीच नसते.</div>
          <div>ना बँकेसमोर, ना व्यापाऱ्यासमोर, ना बाजारासमोर — शेतकऱ्याला विश्वासार्ह ठरवणारी कोणतीच व्यवस्था नाही.</div>
          <div>शेतीतली ही सगळ्यात मोठी पोकळी आहे. आणि याच पोकळीमुळे खरं काम करूनही शेतकरी अनेक ठिकाणी मागे राहतो.</div>
        </div>
      </section>

      <section className="vision-philosophy-section">
        <div className="vision-section-heading">
          <span>म्हणूनच विश्वास हाच कणा</span>
          <h2>विश्वास हाच ShramSafal चा कणा आहे.</h2>
        </div>
        <div className="vision-philosophy-copy">
          <p>
            आणि हा विश्वास कोणी बाहेरून आणून देणार नाही — तो तुम्ही, शेतकरी,
            स्वतःच्या रोजच्या खऱ्या कामातून उभा कराल.
          </p>
          <strong>तुमच्या कामाचा पुरावा — हीच उद्या तुमची खरी ओळख.</strong>
          <p>आम्ही फक्त त्या विश्वासाला जागा देतो, आणि तो प्रामाणिकपणे जपतो.</p>
        </div>
      </section>

      <section className="scene-copy centered-copy">
        <h2>तुमचं ते तुमचंच</h2>
      </section>

      <section className="privacy-principle-grid">
        {privacyPrinciples.map((principle, index) => (
          <HoverField className="privacy-principle-card" key={principle.title}>
            <span>०{index + 1}</span>
            <strong>{principle.title}</strong>
            <p>{principle.detail}</p>
          </HoverField>
        ))}
      </section>

      <section className="privacy-cta-strip">
        <div>
          <span className="launch-kicker">जबाबदार सुरुवात</span>
          <h2>विश्वास कमवायचा असतो. आणि तो तुमच्या रोजच्या खऱ्या कामातून उभा राहतो.</h2>
        </div>
        <AppLink className="primary-link" href="/join" onNavigate={onNavigate}>
          पहिल्या जबाबदार गटात नाव जोडा
          <span aria-hidden="true">→</span>
        </AppLink>
      </section>

      <section className="privacy-policy" aria-label="गोपनीयता धोरण">
        <div className="policy-head">
          <span className="launch-kicker">गोपनीयता धोरण</span>
          <p className="policy-updated">शेवटचा बदल — २ ऑक्टोबर २०२६</p>
        </div>
        <dl className="policy-list">
            <div className="policy-row">
              <dt>कोण जबाबदार आहे</dt>
              <dd>ShramSafal हे Agriryot Value Enterprises Private Limited (CIN U62099PN2026PTC256337) चं उत्पादन आहे. तुम्ही दिलेल्या माहितीसाठी हीच कंपनी जबाबदार आहे. संपर्क — arvesystems@gmail.com</dd>
            </div>
            <div className="policy-row">
              <dt>आम्ही काय गोळा करतो</dt>
              <dd>तुम्ही फॉर्ममध्ये स्वतः भरता तेवढंच — नाव, मोबाईल नंबर, जिल्हा, गाव, शेतीचा आकार, पीक, तुमची भूमिका, मजूर व्यवस्थापन करता का, आणि तुम्ही लिहिलेली अडचण. तुम्ही निवडलेली भाषा फक्त तुमच्याच ब्राउझरमध्ये साठवली जाते. वेबसाइट कशी वापरली जाते हे समजण्यासाठी आम्ही Google Analytics वापरतो.</dd>
            </div>
            <div className="policy-row">
              <dt>का गोळा करतो</dt>
              <dd>एकाच कारणासाठी — पहिल्या जबाबदार गटाबद्दल तुमच्याशी संपर्क करण्यासाठी. दुसऱ्या कशासाठीही नाही.</dd>
            </div>
            <div className="policy-row">
              <dt>ही माहिती कुठे जाते</dt>
              <dd>ShramSafal च्या स्वतःच्या नोंदीत. ती विकली जात नाही, जाहिरातीसाठी वापरली जात नाही, आणि तुमच्या संमतीशिवाय कोणालाही दिली जात नाही.</dd>
            </div>
            <div className="policy-row">
              <dt>किती काळ ठेवली जाते</dt>
              <dd>तुम्ही हटवायला सांगेपर्यंत, किंवा शेवटच्या संपर्कानंतर २४ महिने — यापैकी जे आधी येईल.</dd>
            </div>
            <div className="policy-row">
              <dt>तुमचे हक्क</dt>
              <dd>तुमची माहिती पाहणे, त्यात दुरुस्ती करणे, किंवा ती पूर्णपणे हटवणे — हे तुम्ही कधीही मागू शकता. arvesystems@gmail.com वर कळवा.</dd>
            </div>
            <div className="policy-row">
              <dt>तक्रार असेल तर</dt>
              <dd>arvesystems@gmail.com वर लिहा. आम्ही ३० दिवसांच्या आत उत्तर देऊ.</dd>
            </div>
            <div className="policy-row">
              <dt>कुकीज</dt>
              <dd>Google Analytics वेबसाइटच्या वापराची आकडेवारी गोळा करण्यासाठी कुकीज वापरतं. तुम्ही तुमच्या ब्राउझरमधून त्या बंद करू शकता.</dd>
            </div>
        </dl>
      </section>
    </main>
  );
}

function PageShell({
  page,
  onNavigate,
}: {
  page: PageDefinition;
  onNavigate: (href: string) => void;
}) {
  return (
    <section className="page-shell skeleton-page-shell">
      <div className="page-shell-copy">
        <span className="structure-only-badge">केवळ रचना आराखडा</span>
        <h1>{page.label}</h1>
        <p className="page-sub-status">ShramSafal च्या प्रगतीसोबत हा विभाग विकसित केला जात आहे.</p>
      </div>

      <div className="page-structure-grid">
        <div className="structure-block skeleton-block">
          <div className="skeleton-header-line" />
          <div className="skeleton-body-line" />
          <div className="skeleton-body-line" style={{ width: "80%" }} />
        </div>
        <div className="structure-block skeleton-block">
          <div className="skeleton-header-line" />
          <div className="skeleton-body-line" />
          <div className="skeleton-body-line" style={{ width: "60%" }} />
        </div>
        <div className="structure-block skeleton-block">
          <div className="skeleton-header-line" />
          <div className="skeleton-body-line" />
          <div className="skeleton-body-line" style={{ width: "70%" }} />
        </div>
      </div>

      <div className="page-back-nav">
        <AppLink href="/" onNavigate={onNavigate} className="back-link">
          ← मुख्यपृष्ठ
        </AppLink>
      </div>
    </section>
  );
}

function FooterShell({
  active,
  onNavigate,
}: {
  active: RouteKey;
  onNavigate: (href: string) => void;
}) {
  return (
    <footer className="footer-shell">
      <div className="footer-particle-haze" aria-hidden="true" />
      <div className="footer-wordmark footer-corporate-lockup">
        <img className="footer-mark" src={markLogo} alt="" loading="lazy" decoding="async" />
        <div className="footer-nameplate">
          <img className="footer-name" src={wordmarkLogo} alt="ShramSafal" loading="lazy" decoding="async" />
        </div>
      </div>

      <nav className="footer-page-nav" aria-label="तळातील पानांची दिशा">
        {pages.map((page, index) => (
          <AppLink
            className={active === page.key ? "is-active" : undefined}
            href={page.href}
            key={page.key}
            onNavigate={onNavigate}
          >
            <span>{pageIndexLabels[index]}</span>
            {page.label}
          </AppLink>
        ))}
      </nav>
    </footer>
  );
}

export default function App() {
  const [page, setPage] = useState<PageDefinition>(() => getCurrentPage());
  const [language, setLanguage] = useState<LanguageCode>(() => {
    try {
      return getStoredLanguage() ?? defaultLanguage;
    } catch {
      return defaultLanguage;
    }
  });
  // Must run before any child renders: the JSX runtime translates as elements
  // are created (src/i18n-jsx/jsx-runtime.ts).
  setRenderLanguage(language);
  const motionOn = useMotionMode();
  // Glow position in viewport pixels. It is moved with a transform, which the
  // compositor handles alone — repainting a full-screen gradient on every
  // pointer move (the old approach) is what made the page lag.
  const mouseX = useMotionValue(typeof window === "undefined" ? 0 : window.innerWidth * 0.5);
  const mouseY = useMotionValue(typeof window === "undefined" ? 0 : window.innerHeight * 0.28);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, {
    stiffness: 90,
    damping: 26,
    mass: 0.25,
  });
  const progressOpacity = useTransform(scrollYProgress, [0, 0.018], [0, 0.82]);

  useEffect(() => {
    const seo = localizedSeo[language][page.key] ?? seoByPage[page.key];
    document.title = seo.title;
    document.documentElement.lang = language === "mr" ? "mr" : "en";

    const setMeta = (selector: string, attr: "name" | "property", key: string, value: string) => {
      let el = document.head.querySelector<HTMLMetaElement>(selector);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute("content", value);
    };

    setMeta('meta[name="description"]', "name", "description", seo.description);

    // Canonical and social tags must follow the route. index.html ships one
    // set written for the homepage, and prerendering freezes whatever is in
    // the DOM — so without this every page would claim to be the homepage and
    // tell search engines to ignore the other four.
    const canonicalUrl = new URL(page.href, "https://shramsafal.in").toString();
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = canonicalUrl;

    setMeta('meta[property="og:url"]', "property", "og:url", canonicalUrl);
    setMeta('meta[property="og:title"]', "property", "og:title", seo.title);
    setMeta('meta[property="og:description"]', "property", "og:description", seo.description);
    setMeta('meta[property="og:locale"]', "property", "og:locale", language === "mr" ? "mr_IN" : "en_IN");
    setMeta('meta[name="twitter:title"]', "name", "twitter:title", seo.title);
    setMeta('meta[name="twitter:description"]', "name", "twitter:description", seo.description);

    // One page_view per route. index.html sets send_page_view:false because
    // pushState navigation fires no page load, so without this every route
    // after the first would go uncounted.
    window.gtag?.("event", "page_view", {
      page_title: seo.title,
      page_location: window.location.href,
      page_path: window.location.pathname,
      language,
    });
  }, [language, page.key]);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".site-shell");
    if (root) root.dataset.language = language;
  }, [language, page.key]);

  const updateLanguage = (nextLanguage: LanguageCode) => {
    setLanguage(nextLanguage);
    try {
      saveStoredLanguage(nextLanguage);
    } catch {
      // private mode / blocked storage: the choice still applies this visit
    }
  };

  const navigate = (href: string) => {
    if (typeof window === "undefined") return;
    const [path, hash] = href.split("#");
    const nextPath = path || "/";
    const nextPage = pageByPath.get(nextPath) ?? pages[0];
    const query = window.location.search;
    window.history.pushState(null, "", `${nextPath}${query}${hash ? `#${hash}` : ""}`);
    setPage(nextPage);
    requestAnimationFrame(() => {
      if (hash) {
        document.getElementById(hash)?.scrollIntoView({ behavior: motionOn ? "smooth" : "auto" });
      } else {
        window.scrollTo({ top: 0, behavior: motionOn ? "smooth" : "auto" });
      }
    });
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!motionOn) return;
    mouseX.set(event.clientX);
    mouseY.set(event.clientY);
  };

  return (
    <motion.main
      className={`site-shell ${motionOn ? "motion-allowed" : "motion-reduced"}`}
      style={{ "--mouse-x": "50%", "--mouse-y": "28%" } as CSSProperties}
      onPointerMove={handlePointerMove}
    >
      <motion.div className="global-glow" style={{ x: mouseX, y: mouseY }} />

      <motion.div
        className="top-progress"
        style={{ opacity: motionOn ? progressOpacity : 0, scaleX: motionOn ? progress : 1 }}
      />

      <NavShell
        active={page.key}
        language={language}
        onLanguageChange={updateLanguage}
        onNavigate={navigate}
      />

      {page.key === "home" ? (
        <HomeSkeleton onNavigate={navigate} />
      ) : page.key === "vision" ? (
        <VisionPhilosophyPage onNavigate={navigate} />
      ) : page.key === "farmers" ? (
        <FarmersOperatorsPage onNavigate={navigate} />
      ) : page.key === "join" ? (
        <JoinEarlyAccessPage onNavigate={navigate} />
      ) : page.key === "privacy" ? (
        <PrivacyTrustPage onNavigate={navigate} />
      ) : (
        <PageShell page={page} onNavigate={navigate} />
      )}

      <FooterShell active={page.key} onNavigate={navigate} />
      <LanguagePrompt onChoose={updateLanguage} />
    </motion.main>
  );
}
