export type LanguageCode = "en" | "mr";

type SeoPageKey = "home" | "vision" | "farmers" | "join" | "privacy";

type LanguageUiCopy = {
  switchLabel: string;
  gateAriaLabel: string;
  gateKicker: string;
  gateTitle: string;
  gateLead: string;
  gateHint: string;
  farmerNote: string;
  continueLabel: string;
  selectedLabel: string;
  choices: Record<
    LanguageCode,
    {
      eyebrow: string;
      title: string;
      detail: string;
      micro: string;
    }
  >;
};

const languageStorageKey = "shramsafal.language";

// English is the default so the prerendered HTML — the only copy search and
// answer engines read — is English (founder decision 2026-10-03). A first-time
// visitor is offered Marathi by LanguagePrompt in App.tsx; once they choose,
// the stored choice wins on every later visit.
export const defaultLanguage: LanguageCode = "en";

export const languageUi: Record<LanguageCode, LanguageUiCopy> = {
  en: {
    switchLabel: "Change language",
    gateAriaLabel: "Choose your preferred language",
    gateKicker: "Welcome to ShramSafal",
    gateTitle: "Choose the language your farm speaks in.",
    gateLead:
      "ShramSafal is built for serious farm work. Pick a language once; the same site will shift without opening a separate page.",
    gateHint: "No /en or /mr route. One experience. Two languages.",
    farmerNote: "Start in the language that feels natural to your decisions.",
    continueLabel: "Enter ShramSafal",
    selectedLabel: "Selected",
    choices: {
      en: {
        eyebrow: "Start with English",
        title: "English",
        detail: "Best for review, sharing, and investor-facing reading.",
        micro: "Use English",
      },
      mr: {
        eyebrow: "मराठीत सुरू करा",
        title: "मराठी",
        detail: "शेतकरी, मुकादम आणि कुटुंबासाठी नैसर्गिक वाचन.",
        micro: "मराठी वापरा",
      },
    },
  },
  mr: {
    switchLabel: "भाषा बदला",
    gateAriaLabel: "तुमची भाषा निवडा",
    gateKicker: "ShramSafal मध्ये स्वागत",
    gateTitle: "तुमच्या शेतीला जी भाषा जवळची वाटते, ती निवडा.",
    gateLead:
      "ShramSafal गंभीर शेतीकामासाठी आहे. एकदा भाषा निवडा; हीच साइट वेगळं पान न उघडता त्या भाषेत बदलेल.",
    gateHint: "/en किंवा /mr नाही. एकच अनुभव. दोन भाषा.",
    farmerNote: "निर्णय ज्या भाषेत स्पष्ट वाटतात, त्या भाषेत सुरुवात करा.",
    continueLabel: "ShramSafal मध्ये जा",
    selectedLabel: "निवडलेली",
    choices: {
      en: {
        eyebrow: "Start with English",
        title: "English",
        detail: "Review, sharing आणि investor-facing reading साठी.",
        micro: "English वापरा",
      },
      mr: {
        eyebrow: "मराठीत सुरू करा",
        title: "मराठी",
        detail: "शेतकरी, मुकादम आणि कुटुंबासाठी नैसर्गिक वाचन.",
        micro: "मराठी वापरा",
      },
    },
  },
};

export const localizedSeo: Record<LanguageCode, Record<SeoPageKey, { title: string; description: string }>> = {
  en: {
    home: {
      title: "ShramSafal — For farmers who run farming like a business",
      description:
        "Owning land is one thing. Building farming as an operation is another. ShramSafal brings direction, accounts, and responsibility to daily farm work.",
    },
    vision: {
      title: "Vision and Philosophy — ShramSafal",
      description:
        "ShramSafal is built so daily farm effort does not disappear. It turns work into clarity, trust, and better decisions.",
    },
    farmers: {
      title: "For Farmers and Farm Operators — ShramSafal",
      description:
        "Whether 10 guntha or 100 acres, farming needs clarity. See who ShramSafal is for and how daily work becomes visible.",
    },
    join: {
      title: "Join the First Responsible Group — ShramSafal",
      description:
        "If daily farm work needs direction, accounts, observation, and responsibility, join the first responsible ShramSafal group.",
    },
    privacy: {
      title: "Trust Is the Spine — ShramSafal",
      description:
        "The one thing farming lacks most is trust. ShramSafal starts by helping farmers build trust from their real daily work.",
    },
  },
  mr: {
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
  },
};

const englishTranslations: Record<string, string> = {
  "सुरुवात छोटी दिसते. पण परिणाम शेताच्या संपूर्ण कामकाजावर जातो.":
    "It starts small. But the consequence reaches the entire farm operation.",
  "मुख्यपृष्ठ": "Home",
  "दृष्टी व विचार": "Vision and Philosophy",
  "शेतकरी / कामकाज": "Farmers / Operations",
  "पहिला जबाबदार गट": "First Responsible Group",
  "विश्वास": "Trust",
  "विश्वास हाच कणा": "Trust Is the Spine",
  "विभाग": "Sections",
  "पानांची दिशा उघडा": "Open page navigation",
  "पानांची दिशा": "Page navigation",
  "तळातील पानांची दिशा": "Footer navigation",
  "शेतीला व्यवसायासारखं चालवणाऱ्या शेतकऱ्यांसाठी":
    "For farmers who run farming like a business",
  "जमीन असणं वेगळं, शेती उभी करणं वेगळं. रोजच्या शेतकामाला दिशा, हिशोब आणि जबाबदारीचा कणा.":
    "Owning land is one thing. Building farming as an operation is another. A spine of direction, accounts, and responsibility for daily farm work.",
  "पहिल्या जबाबदार गटात नाव जोडा.": "Join the first responsible group.",
  "श्रमसफलची दृष्टी": "ShramSafal's Vision",
  "शेतातली रोजची मेहनत हरवू नये; ती स्पष्टतेत, विश्वासात आणि चांगल्या निर्णयांत बदलावी.":
    "Daily effort in the field should not disappear; it should turn into clarity, trust, and better decisions.",
  "शेतीचं रोजचं सत्य — श्रमसफलची दृष्टी.":
    "The daily truth of farming — ShramSafal's vision.",
  "शेतकरी व कामकाज सांभाळणाऱ्यांसाठी": "For farmers and farm operators",
  "१० गुंठे असो किंवा १०० एकर — शेती चालवण्यासाठी स्पष्टता लागतेच.":
    "Whether 10 guntha or 100 acres — farming needs clarity to operate well.",
  "ShramSafal त्या लोकांसाठी आहे जे शेतीकडे फक्त जमीन म्हणून नाही, तर रोज चालणारी जबाबदारी म्हणून पाहतात.":
    "ShramSafal is for people who see farming not only as land, but as a daily responsibility.",
  "लहान शेतकरी, प्रगतिशील शेतकरी, शेतमालक, मुकादम आणि कुटुंबातील शेती व्यवस्थापक यांना एकाच स्पष्ट कामकाजाच्या सत्यावर आणणे.":
    "Bringing small farmers, progressive farmers, landowners, supervisors, and family farm managers onto one clear operational truth.",
  "पहिल्या जबाबदार गटात नाव जोडा":
    "Join the first responsible group",
  "रोजच्या शेतकामाला दिशा, हिशोब आणि जबाबदारी हवी असेल, तर पहिल्या जबाबदार गटात सामील व्हा.":
    "If daily farm work needs direction, accounts, and responsibility, join the first responsible group.",
  "आम्ही आधी कमी शेतकऱ्यांसोबत खोलवर काम करणार आहोत, कारण विश्वास घाईत तयार होत नाही.":
    "We will first work deeply with fewer farmers, because trust is not built in a hurry.",
  "शेतीत सगळ्यात कमी पडतो तो विश्वास. तुमच्या खऱ्या कामातून तुमचा स्वतःचा विश्वास उभा करा.":
    "The thing farming lacks most is trust. Build your own trust from your real work.",
  "तुमच्या कामाचा पुरावा — हीच उद्या तुमची खरी ओळख.":
    "Proof of your work — that is your real identity tomorrow.",

  "तुम्ही शेतात मेहनत करता.": "You work hard in the field.",
  "रोज करता.": "You do it every day.",
  "वर्षानुवर्षे करत आला आहात.": "You have done it for years.",
  "पण कधी स्वतःला हा प्रश्न विचारलात का —":
    "But have you ever asked yourself this uncomfortable question —",
  "मी": "Am I",
  "शेतजमीन आहे म्हणून": "a farmer because I have farmland",
  "शेतकरी आहे,": ",",
  "की": "or",
  "शेती एक": "am I a farmer because I run farming as",
  "व्यवसाय म्हणून, नियोजनाने आणि नफ्याच्या दिशेने":
    "a business, with planning and a path toward profit",
  "चालवतो म्हणून शेतकरी आहे?": "?",
  "शेतीतली खरी ताकद फक्त कष्टात नाही. ती आहे — योग्य वेळी, योग्य ठिकाणी, योग्य काम करून घेण्याच्या शिस्तीत.":
    "The real strength in farming is not effort alone. It is the discipline of getting the right work done at the right time, in the right place.",
  "हे कोणासाठी आहे?": "Who is this for?",
  "दबंग शेतकरी": "Serious farmer",
  "शिस्त · मोजमाप": "Discipline · Measurement",
  "तुमच्या शेतीत अशी शिस्त मोजणारी व्यवस्था आहे का?":
    "Does your farm have a system that measures this discipline?",
  "काम": "Work",
  "मजुरी": "Labour",
  "खर्च": "Cost",
  "पुरावा": "Proof",
  "वेळ": "Time",
  "निरीक्षण": "Observation",
  "जबाबदारी": "Responsibility",
  "हिशोब": "Accounts",
  "शेतीत \"वाटतं\" आणि \"खरंच झालं\" यात मोठं अंतर असतं.":
    "In farming, there is a large gap between what feels done and what actually happened.",
  "जमीन आहे म्हणून शेती करायची असेल, तर अंदाज पुरेसा वाटतो. पण रोजचा पगार, वहीतला खर्च आणि नुसती आठवण — यातून काम खरंच पूर्ण झालं का, हे कधीच स्पष्ट होत नाही.":
    "If farming is only because land exists, guesswork feels enough. But wages, notebook expenses, and memory alone never make it clear whether the work was truly completed.",
  "प्रश्न \"खर्च झाला का\" हा नाही. प्रश्न आहे — तो खर्च समजला का?":
    "The question is not whether money was spent. The question is whether that cost was understood.",
  "दैनिक वास्तव": "Daily reality",
  "जे आठवतं, ते खरं वाटतं.": "What is remembered starts feeling true.",
  "तोंडी अपडेट, वही आणि अंदाज यांच्यात कामाची खरी स्थिती हरवते.":
    "Between verbal updates, notebooks, and guesses, the real state of work gets lost.",
  "काम झालं असं वाटतं.": "It feels like the work is done.",
  "पण कोण, कुठे, किती आणि ठरल्याप्रमाणे झालं का — हे पुन्हा तपासलं जात नाही.":
    "But who did it, where, how much, and whether it happened as planned is not checked again.",
  "खर्च वहीत लिहिला जातो.": "Expenses are written in a notebook.",
  "पण रोग, पाणी, मजूर आणि बाजार बदलला, की त्या खर्चाचा अर्थही बदलतो.":
    "But when disease, water, labour, or market conditions change, the meaning of that expense changes too.",
  "शेती चालू राहते.": "Farming keeps running.",
  "पण “चालू राहणं” आणि “नफ्यात चालणं” या दोन वेगळ्या गोष्टी आहेत.":
    "But simply continuing and running profitably are two different things.",
  "दिवसभर उन्हातान्हात राबता. मजूर सांभाळता. हजारोंचं औषध-पाणी करता.":
    "You work through the day in heat and dust. You manage labour. You spend thousands on inputs and water.",
  "पण काही दिवसांनी — कोणतं काम कसं झालं आणि पैसा नेमका कुठे गेला, याचा एकही स्पष्ट पुरावा उरत नाही.":
    "But a few days later, there is no clear proof of how a task was done or where the money actually went.",
  "मेहनत रोज होते. पण तिचा स्पष्ट हिशोब राहिला नाही, तर ती काळाच्या धुक्यात विरून जाते.":
    "Effort happens every day. But without clear accounting, it dissolves into the fog of time.",
  "आणि जे आज स्पष्ट राहत नाही, ते उद्याच्या निर्णयात कधीच कामी येत नाही.":
    "And what is not clear today never becomes useful in tomorrow's decision.",
  "\"प्रत्येक शेतकरी म्हणतो — मी माझं १००% दिलं.\"":
    "\"Every farmer says — I gave my 100%.\"",
  "पण प्रत्येकाचं १००% वेगळं असतं. कोणाचं १००% म्हणजे दिवसभर शेतात उभं राहणं. कोणाचं म्हणजे जास्तीत जास्त खर्च करणं. कोणाचं म्हणजे योग्य वेळी योग्य निर्णय घेणं.":
    "But everyone's 100% is different. For someone it means standing in the field all day. For someone it means spending more. For someone it means making the right decision at the right time.",
  "आणि शेतीतलं हे १००% पूर्णपणे तुमच्या हातात नसतं — ते रोज बदलणाऱ्या गोष्टींवर ठरतं. आणि याच गोष्टींवर तुमचे रोजचे निर्णय अवलंबून असतात.":
    "And in farming, this 100% is never completely in your hands. It depends on things that change every day, and your daily decisions depend on those same things.",
  "म्हणून खरा प्रश्न \"मी १००% दिलं का\" हा नाही. खरा प्रश्न आहे —":
    "So the real question is not \"Did I give 100%?\" The real question is —",
  "माझं १००% पुरेसं होतं का, हे सांगणारं माप तरी माझ्याकडे आहे का?":
    "do I even have a measure that tells me whether my 100% was enough?",
  "ते मोजणारं काहीच नसेल, तर \"१००%\" ही फक्त भावना राहते — पुरावा नाही. आणि न मोजलेलं, चुकीच्या दिशेने दिलेलं १००% — ते १००% नसतं, ते नुकसान असतं.":
    "If nothing measures it, \"100%\" remains only a feeling, not proof. And unmeasured effort in the wrong direction is not 100%; it is loss.",
  "१००% मेहनत तर असते — पण ती पुरेशी होती का, हे ठरवणाऱ्या या गोष्टी आपल्या हातात नसतात:":
    "The effort may be 100% — but the things that decide whether it was enough are not fully in our hands:",
  "मेहनत": "Effort",
  "हवामानातला बदल": "Weather shift",
  "अचानक आलेला रोग": "Sudden disease",
  "ऐनवेळी मजूर न येणं": "Labour not arriving on time",
  "बाजारभावानुसार बदलणारा खर्च": "Costs changing with market rates",
  "गृहीत न धरलेला अचानक खर्च": "Unplanned sudden expense",
  "नियोजनाबाहेर गेलेला वेळ": "Time slipping beyond plan",
  "हातातली माती आणि उगवणारं रोप": "Soil in hand and a growing seedling",
  "स्थानिक शहाणपण": "Local wisdom",
  "आपल्या जमिनीचं शहाणपण बाजूला सारून नाही.":
    "Not by pushing aside your land's own wisdom.",
  "प्रत्येक जण शेतकऱ्याला सल्ला द्यायला तयार असतो.":
    "Everyone is ready to advise the farmer.",
  "सल्ला ऐकावाही — पण फक्त \"कोणीतरी सांगतंय\" म्हणून नाही, तर आपल्या जमिनीचं शहाणपण लक्षात घेऊन.":
    "Advice can be useful, but not just because someone says it. It must be weighed against your land's own wisdom.",
  "प्रत्येक जमिनीचा स्वतःचा स्वभाव असतो. बाहेरचं मार्गदर्शन उपयोगी असतं. पण तुमच्या जमिनीचा स्वभाव, तुमच्या कामाचा अनुभव आणि तुमच्या निर्णयांचा परिणाम — हे एकत्र दिसलं, तरच खरी समज तयार होते.":
    "Every land has its own nature. Outside guidance can help. But real understanding forms only when your land's behaviour, your work experience, and the result of your decisions are seen together.",
  "कोणाच्या शेतात पाणी लवकर धरतं": "Where water holds quickly",
  "कुठे खत लगेच परिणाम दाखवतं": "Where fertilizer shows effect quickly",
  "कोणत्या वाफ्यात पीक वेगळं वागतं": "Which bed behaves differently",
  "कोणत्या हंगामात जमीन वेगळी प्रतिक्रिया देते": "Which season changes the soil response",
  "जमीन असणं आणि शेती उभी करणं — या दोन वेगळ्या गोष्टी आहेत.":
    "Owning land and building farming are two different things.",
  "फक्त उत्पन्न घ्यायचं असेल, तर अंदाज पुरेसा वाटतो. पण शेतीला व्यवसाय म्हणून उभं करायचं असेल, तर रोजच्या कामाचं नियोजन, खर्चाचा मागोवा, वेळेवर अंमलबजावणी आणि प्रत्येकाच्या मेहनतीचा हिशोब — हे पर्याय राहत नाहीत, गरज बनतात.":
    "If the aim is only to take produce, guesswork may feel enough. But if farming must be built as a business, daily planning, expense tracking, timely execution, and accounting for everyone's effort stop being optional and become necessary.",
  "नियोजन · मोजमाप · जबाबदारी · सुधारणा.":
    "Planning · Measurement · Responsibility · Improvement.",
  "शेतीची ओळख बदलणारा प्रवास": "The journey that changes the identity of farming",
  "जमीन आहे म्हणून शेती": "Farming because land exists",
  "अंदाज पुरेसा वाटतो. काम चालू राहतं. निर्णय आठवणीवर राहतात.":
    "Guesswork feels enough. Work continues. Decisions stay in memory.",
  "शेतीला व्यवसाय म्हणून उभं करणं": "Building farming as a business",
  "नियोजन, अंमलबजावणी, खर्चाचा मागोवा आणि जबाबदारी हाच कणा बनतो.":
    "Planning, execution, expense tracking, and responsibility become the spine.",
  "शेतकरी असणं ही ओळख आहे. शेती व्यवसाय म्हणून उभी करणं ही जबाबदारी आहे.":
    "Being a farmer is an identity. Building farming as a business is a responsibility.",
  "याच विचारातून उभं राहत आहे.": "This is the thought ShramSafal is rising from.",
  "रोजच्या शेतकामाला दिशा, हिशोब आणि जबाबदारीचा कणा देणारी एक व्यवस्था. काम, मजुरी, खर्च, वेळ, निरीक्षण आणि पुरावा — या सगळ्याला रोज एका स्पष्ट नोंदीत आणणारी.":
    "A system that gives daily farm work a spine of direction, accounts, and responsibility. It brings work, labour, cost, time, observation, and proof into one clear daily record.",
  "ShramSafal ची सुरुवात रोजच्या कामाच्या स्पष्टतेपासून होते. आणि तीच स्पष्टता पुढे शेतीचा कणा बनत जाते.":
    "ShramSafal begins with daily clarity of work. That clarity slowly becomes the spine of farming.",
  "जे काम स्पष्ट होतं, त्याचा पुरावा राहतो. आणि तोच पुरावा हळूहळू तुमचा विश्वास — तुमची ओळख बनतो.":
    "Work that becomes clear leaves proof. That proof slowly becomes your trust and your identity.",
  "आजच्या कामासाठी": "For today's work",
  "पुढच्या निर्णयासाठी": "For the next decision",
  "पुढच्या हंगामासाठी": "For the next season",
  "पुढच्या पिढीसाठी": "For the next generation",
  "हे प्रत्येकासाठी नाही.": "This is not for everyone.",
  "हे त्यांच्यासाठी आहे जे शेतीकडे फक्त जमीन म्हणून नाही, तर जबाबदारी म्हणून पाहतात.":
    "It is for those who see farming not just as land, but as responsibility.",
  "शेतकरी": "Farmer",
  "ज्यांना रोजच्या कामात स्पष्टता हवी आहे.": "Those who want clarity in daily work.",
  "मुकादम": "Supervisor",
  "ज्यांना काम, माणसं आणि जबाबदारी याचा विश्वासार्ह मागोवा हवा आहे.":
    "Those who need reliable tracking of work, people, and responsibility.",
  "कुटुंबातील शेती व्यवस्थापक": "Family farm manager",
  "ज्यांना घरातील शेती अंदाजावर नाही, तर स्पष्टतेवर चालवायची आहे.":
    "Those who want the family farm to run on clarity, not guesswork.",
  "ग्रामीण उद्योजक": "Rural operator",
  "ज्यांना शेतीकडे कामकाज, व्यवस्थापन आणि जबाबदारीच्या नजरेने पाहायचं आहे.":
    "Those who view farming through operations, management, and responsibility.",
  "मातीत रुजणारी नवी सुरुवात": "A new beginning rooted in soil",
  "तुम्ही शेती करता. पण ती व्यवसायासारखी चालवता का?":
    "You farm. But do you run it like a business?",
  "हा प्रश्न मनात अडकला असेल, तर ShramSafal तुमच्यासाठी आहे. पहिल्या जबाबदार गटात तुमचं नाव जोडा.":
    "If this question stayed in your mind, ShramSafal is for you. Add your name to the first responsible group.",
  "जमीन वारशाने मिळते. पण शेतीला व्यवसाय बनवणारी रोजची शिस्त — आणि स्वतःचा विश्वास — स्वतः उभा करावा लागतो.":
    "Land can be inherited. But the daily discipline that turns farming into a business, and your own trust, must be built by you.",
  "फॉर्मची दृश्य झलक": "Form preview",
  "नाव": "Name",
  "मोबाईल नंबर": "Mobile number",
  "जिल्हा": "District",
  "तुमची भूमिका": "Your role",
  "मुख्य पीक / शेती प्रकार": "Main crop / farming type",

  "आपल्या देशातला शेतकरी मेहनतीला कधीच कमी पडत नाही. कमी पडते ती — त्या मेहनतीला मिळणारी दिशा, स्पष्टता आणि पुरावा.":
    "The farmer in our country never lacks effort. What is missing is the direction, clarity, and proof that effort deserves.",
  "दिशा, स्पष्टता आणि पुरावा.": "direction, clarity, and proof.",
  "श्रमसफलची दृष्टी एकच आहे — शेतातली रोजची मेहनत हरवू नये; ती स्पष्ट नोंदीत, विश्वासात आणि चांगल्या निर्णयांत बदलावी.":
    "ShramSafal's vision is simple: daily effort in the field should not disappear; it should turn into clear records, trust, and better decisions.",
  "निर्णय": "Decision",
  "अडचण": "Problem",
  "इतिहास": "History",
  "मूळ विचार": "Core thought",
  "शेतकऱ्याला कष्टाची कमी नाही. कमी आहे — शेतीची विश्वासार्ह स्मृती.":
    "The farmer does not lack effort. What is missing is farming's reliable memory.",
  "रोज काम होतं. मजूर येतात. खर्च होतो. फवारणी होते. पाणी दिलं जातं. निर्णय घेतले जातात.":
    "Work happens every day. Labour comes. Money is spent. Spraying happens. Water is given. Decisions are made.",
  "पण दिवस संपला, की त्यातला बराचसा भाग आठवणीतून हळूहळू पुसतो.":
    "But when the day ends, much of it slowly fades from memory.",
  "शेतीचं भविष्य बदलायचं असेल, तर आधी रोजचं हे सत्य स्पष्ट करावं लागतं.":
    "To change farming's future, the daily truth must first become clear.",
  "आधी रोजचं हे सत्य स्पष्ट करावं लागतं.": "this daily truth must first become clear.",
  "आभाळ आणि जमीन": "Sky and soil",
  "सॅटेलाइट आभाळातून शेत दाखवतो. पण शेताची खरी नाडी आभाळातून समजत नाही — ती समजते रोज मातीत राबणाऱ्या हातांना.":
    "A satellite can show a field from the sky. But the true pulse of a farm is not understood from the sky; it is understood by the hands that work in the soil every day.",
  "आज काय झालं, काय राहिलं आणि कुठे अडलं — हे जमिनीवरच, रोजच्या कामातूनच कळतं. म्हणून आधी गरज मोठ्या तंत्रज्ञानाची नाही, स्पष्टतेची आहे. आणि एकदा ती स्पष्टता तयार झाली, की तंत्रज्ञान नेमकं कुठे वापरायचं, हेही तीच सांगते.":
    "What happened today, what remains, and where things got stuck are understood on the ground through daily work. So the first need is not bigger technology; it is clarity. Once that clarity exists, it also tells us where technology should be used.",
  "शेतातील रोजच्या कामाची नोंद पाहणारा शेतकरी":
    "A farmer reviewing the record of daily farm work",
  "खालचा थर आधी": "The lower layer first",
  "शेतीचे प्रश्न नेहमी \"बाजाराशी जोडणी\" इथून सुरू होतात असं म्हटलं जातं.":
    "Farm problems are often said to begin with market linkage.",
  "पण बाजाराशी जोडणी हा वरचा थर आहे. त्याच्या खाली एक मूलभूत प्रश्न आहे — कामाचं सत्य.":
    "But market linkage is an upper layer. Beneath it is a more basic question: the truth of work.",
  "वरचा थर": "upper layer",
  "कामाचं सत्य.": "the truth of work.",
  "नक्की काय काम झालं, कधी झालं, कोणी केलं, किती खर्च आला, ते नीट पूर्ण झालं का, आणि काय राहिलं — याचं स्पष्ट उत्तर कोणाकडेच नसतं.":
    "No one has a clear answer to what exactly was done, when it was done, who did it, what it cost, whether it was completed properly, and what remains.",
  "श्रमसफल इथून सुरू होतं — सगळ्यात खालच्या थरापासून: रोजच्या कामाच्या सत्यापासून. हा थर एकदा उभा राहिला, की त्यावर पुढचे अनेक थर शक्य होतात.":
    "ShramSafal starts here, from the lowest layer: the truth of daily work. Once this layer stands, many other layers become possible.",
  "खालच्या थरापासून: रोजच्या कामाच्या सत्यापासून.":
    "lowest layer: the truth of daily work.",
  "आणि या सगळ्याखालचा सगळ्यात खोल थर म्हणजे — विश्वास. कामाचं सत्य स्पष्ट झालं, की शेतकऱ्याच्या कष्टाला पुरावा मिळतो; आणि तोच पुरावा त्याची खरी ओळख बनतो.":
    "And the deepest layer beneath all of this is trust. When the truth of work becomes clear, the farmer's effort gets proof; that proof becomes his real identity.",
  "विश्वास.": "trust.",
  "कामाच्या सत्याचे थर": "Layers of work truth",
  "सत्य": "Truth",
  "स्पष्टता": "Clarity",
  "शेतीच्या स्पष्टतेचे प्रश्न": "Questions of farm clarity",
  "कोणतं काम झालं?": "What work was done?",
  "कोणी केलं?": "Who did it?",
  "किती खर्च झाला?": "How much did it cost?",
  "कुठे अडचण आली?": "Where did it get stuck?",
  "काय बाकी आहे?": "What remains?",
  "पुढच्या निर्णयावर परिणाम काय?": "What is the impact on the next decision?",
  "शेतकरी म्हणजे": "A farmer is",
  "मालक. निर्णय घेणारा. जोखीम उचलणारा. खर्च करणारा. भविष्य घडवणारा.":
    "Owner. Decision-maker. Risk-taker. Spender. Future-builder.",
  "म्हणून शेतीला केवळ कष्टाची नाही, स्पष्टतेची गरज आहे.":
    "That is why farming needs not only effort, but clarity.",
  "स्पष्टतेची": "clarity",
  "आमची विचारसरणी": "Our philosophy",
  "श्रमसफल रोजच्या शेतकामाला स्पष्टता देतं.":
    "ShramSafal brings clarity to daily farm work.",
  "दिवसभरातलं विखुरलेलं काम एकत्र, समजेल अशा रूपात.":
    "The scattered work of the day, brought together in a form that can be understood.",
  "दिवसभराचं काम स्पष्ट झालं, की त्याची आठवण टिकते, कामाचा पुरावा राहतो — आणि त्यावर पुढचा योग्य निर्णय घेता येतो.":
    "When the day's work becomes clear, its memory stays, proof remains, and the next right decision can be made.",
  "खरी ताकद लिहिण्यात नाही. ती आहे — त्या स्पष्टतेतून मिळणाऱ्या समजुतीत आणि विश्वासात.":
    "The real strength is not in writing things down. It is in the understanding and trust created by that clarity.",
  "समजुतीत आणि विश्वासात.": "understanding and trust.",
  "कामापासून विश्वासापर्यंत": "From work to trust",
  "आम्ही काय मानतो": "What we believe",
  "दिशेविना केलेली मेहनत म्हणजे हरवलेली मेहनत.":
    "Effort without direction is effort that gets lost.",
  "शेतीतला नफा फक्त जास्त उत्पादनातून येत नाही. तो येतो — योग्य वेळी योग्य निर्णय घेतल्याने, चुकीचा खर्च टाळल्याने, कामाची पुनरावृत्ती थांबवल्याने आणि शेतात नेमकं काय चाललंय याची स्पष्टता मिळाल्याने.":
    "Profit in farming does not come only from higher production. It comes from making the right decision at the right time, avoiding wrong costs, stopping repeated work, and knowing clearly what is happening in the field.",
  "मालक, कुटुंब, मुकादम आणि कामगार — सगळ्यांना एकाच सत्यावर आणण्यासाठी.":
    "To bring the owner, family, supervisor, and workers onto the same truth.",
  "दिवसाचं काम विसरू नये म्हणून.": "So the day's work is not forgotten.",
  "खर्चाचा अर्थ समजावा म्हणून.": "So the meaning of cost is understood.",
  "कामाचा पुरावा राहावा म्हणून.": "So proof of work remains.",
  "शेत पुढच्या पिढीसाठी केवळ जमीन न राहता, शिकलेला अनुभव बनावा म्हणून.":
    "So the farm becomes learned experience for the next generation, not only inherited land.",
  "श्रमसफलचा विश्वास": "ShramSafal's belief",
  "शेत चालतं मेहनतीवर. पण शेती वाढते स्पष्टतेवर.":
    "A farm runs on effort. But farming grows on clarity.",
  "पण शेती वाढते स्पष्टतेवर — आणि टिकते विश्वासावर.":
    "But farming grows on clarity and survives on trust.",
  "श्रमसफल ही त्याच स्पष्टतेची, आणि त्या विश्वासाची, सुरुवात आहे.":
    "ShramSafal is the beginning of that clarity and that trust.",
  "← मुख्यपृष्ठ": "← Home",

  "ShramSafal प्रत्येकासाठी नाही. हे त्यांच्यासाठी आहे जे शेतीकडे फक्त जमीन म्हणून नाही, तर रोज चालणारी जबाबदारी म्हणून पाहतात.":
    "ShramSafal is not for everyone. It is for those who see farming not only as land, but as a daily responsibility.",
  "शेतकरी फक्त उत्पादन घेत नाही. तो रोज एक जिवंत व्यवस्था चालवतो.":
    "A farmer does not only produce crops. He runs a living system every day.",
  "विश्वास कसा ठेवतो?": "How do we keep trust?",
  "माणसं": "People",
  "रोजची तफावत": "The daily gap",
  "काम होतं. पण रात्री त्यातलं अर्धं आठवणीतच राहतं.":
    "Work happens. But by night, half of it remains only in memory.",
  "प्रश्न मेहनतीचा नाही. प्रश्न आहे — ती मेहनत स्पष्ट पुराव्यात उरते का?":
    "The question is not effort. The question is whether that effort remains as clear proof.",
  "०१ · काम झालं, पण नोंद कच्ची राहिली. कोणतं काम, कुठल्या वाफ्यात, कोणी केलं — नंतर नीट आठवत नाही.":
    "01 · Work happened, but the record stayed weak. Which work, in which bed, who did it — later it is not remembered clearly.",
  "०२ · खर्च झाला, पण कारण अस्पष्ट. पैसा गेला हे कळतं; कशावर आणि तेवढाच का — हे लागत नाही.":
    "02 · Money was spent, but the reason stayed unclear. You know money went out, but not exactly where and why that much.",
  "०३ · मजूर आले, पण खरं काम किती? हजेरी लागते; प्रत्यक्ष किती काम झालं याचा मागोवा राहत नाही.":
    "03 · Labour came, but how much real work happened? Attendance is marked; actual output is not tracked.",
  "०४ · कामं राहिली, पण एकत्र चित्र नाही. काय राहिलं, काय तातडीचं — एका नजरेत कुठेच दिसत नाही.":
    "04 · Tasks remain, but there is no complete picture. What is pending and what is urgent is not visible at a glance.",
  "हे कोणासाठी आहे": "Who this is for",
  "मुकादमपासून ग्रामीण उद्योजकापर्यंत": "From supervisor to rural operator",
  "मुकादम म्हणजे फक्त मजूर पुरवणारा दुवा नाही.":
    "A supervisor is not just a link who supplies labour.",
  "ज्याच्याकडे माणसं जोडण्याची क्षमता आहे, काम उभं करण्याची जबाबदारी आहे आणि गावात विश्वास आहे — त्याच्यासाठी ShramSafal उद्या गावातलं शेती-कामकाज जबाबदारीने सांभाळणारा उद्योजक बनण्याचा पाया ठरू शकतो.":
    "For someone who can connect people, take responsibility for work, and already has trust in the village, ShramSafal can become the foundation for becoming a responsible rural farm-operations operator tomorrow.",
  "गावातलं शेती-कामकाज जबाबदारीने सांभाळणारा उद्योजक":
    "a responsible rural farm-operations operator",
  "रोजच्या कामाच्या स्पष्ट हिशोबातून उद्या — कोणत्या मजूर गटाचं काम चांगलं आहे, कोणत्या भागात कोणतं काम येणार आहे, आणि कोणत्या शेताला कधी माणसांची गरज भासणार आहे — हे समजण्याची दिशा तयार होऊ शकते.":
    "From clear daily accounting, a direction can form for understanding which labour group works well, what work will arise in which area, and when a farm will need people.",
  "आज ही फक्त रोजची स्पष्टता आहे. पण याच स्पष्टतेवर उद्याची व्यवस्था — आणि तुमची स्वतःची विश्वासार्ह ओळख — उभी राहू शकते.":
    "Today this is only daily clarity. But tomorrow's system, and your own trusted identity, can stand on this clarity.",
  "रोजची स्पष्टता, हंगामभराचा फरक": "Daily clarity, season-long difference",
  "ShramSafal एका दिवसात चमत्कार करत नाही. तो दररोज स्पष्टता तयार करतो.":
    "ShramSafal does not create a miracle in one day. It creates clarity every day.",
  "तो रोज थोडी थोडी स्पष्टता तयार करतो.":
    "It creates a little clarity every day.",
  "७ दिवस": "7 days",
  "दररोज काय होतंय ते दिसू लागतं.": "You begin to see what is happening every day.",
  "काम, माणसं आणि खर्च आठवणीऐवजी स्पष्टपणे समोर येतात.":
    "Work, people, and cost come forward clearly instead of staying in memory.",
  "३० दिवस": "30 days",
  "पॅटर्न दिसू लागतात.": "Patterns begin to appear.",
  "कुठे खर्च वाढतो, कोणती कामं राहतात आणि कुठे पुनरावृत्ती होते हे स्पष्ट होतं.":
    "Where costs rise, which tasks remain, and where repetition happens becomes clear.",
  "१ हंगाम": "1 season",
  "शेताचा वापरता येणारा इतिहास तयार होतो.":
    "A usable history of the farm is created.",
  "कुटुंब चर्चा, मजूर नियोजन आणि पुढच्या निर्णयांसाठी जमिनीचा अनुभव हाताशी राहतो.":
    "The land's experience remains available for family discussions, labour planning, and future decisions.",
  "सुरुवात": "Beginning",
  "रोजची छोटी स्पष्टता, हंगामाच्या शेवटी मोठा फरक दाखवते.":
    "Small daily clarity shows a big difference by the end of the season.",
  "पुढची शेती अंदाजावर नाही, नोंदीवर चालणार आहे.":
    "The next farming will run on records, not guesswork.",

  "जर हा प्रश्न मनात अडकला असेल, तर ShramSafal तुमच्यासाठी आहे.":
    "If this question stayed in your mind, ShramSafal is for you.",
  "तुम्हाला रोजच्या शेतीकामाला दिशा, हिशोब, निरीक्षण आणि जबाबदारी द्यायची असेल, तर पहिल्या जबाबदार गटात तुमचं नाव जोडा.":
    "If you want to give daily farm work direction, accounts, observation, and responsibility, add your name to the first responsible group.",
  "हा गट लहान का": "Why this group is small",
  "आम्हाला फक्त वापरकर्ते नकोत. आम्हाला असे शेतकरी, मुकादम आणि ग्रामीण उद्योजक हवेत — जे शेतीला शिस्त, स्पष्टता आणि जबाबदारीने चालवू इच्छितात.":
    "We do not want only users. We want farmers, supervisors, and rural operators who want to run farming with discipline, clarity, and responsibility.",
  "जवळून काम — तुमची शेती आणि तुमची पद्धत समजून घेऊन सुरुवात.":
    "Close work — beginning by understanding your farm and your method.",
  "तुमचं म्हणणं ऐकलं जातं — पहिल्या गटातल्या अनुभवातून ShramSafal घडत जातं.":
    "Your voice is heard — ShramSafal is shaped from the experience of the first group.",
  "थेट संपर्क — टीम स्वतः तुमच्याशी बोलते; तुम्ही गर्दीतला एक नंबर नाही.":
    "Direct contact — the team speaks with you personally; you are not just a number in a crowd.",
  "इथली सुरुवात म्हणजे फक्त एक सुविधा वापरणं नाही — तुमच्या रोजच्या खऱ्या कामातून स्वतःची विश्वासार्ह ओळख घडवायला सुरुवात करणं.":
    "Starting here is not just using a feature. It is beginning to build a trusted identity from your real daily work.",
  "जिल्हा / तालुका": "District / taluka",
  "गावाचे नाव": "Village name",
  "शेतीचा आकार": "Farm size",
  "भूमिका निवडा": "Select role",
  "शेतमालक": "Landowner",
  "मुकादम / सुपरवायझर": "Supervisor",
  "शेतकरी / शेतमालक / मुकादम / सुपरवायझर / कुटुंबातील शेती व्यवस्थापक / ग्रामीण उद्योजक":
    "Farmer / landowner / supervisor / family farm manager / rural operator",
  "मजूर व्यवस्थापन करता का?": "Do you manage labour?",
  "निवडा": "Select",
  "हो": "Yes",
  "नाही": "No",
  "कधी कधी": "Sometimes",
  "सध्याची सर्वात मोठी अडचण": "Current biggest difficulty",
  "अडचण निवडा": "Select difficulty",
  "दैनिक काम स्पष्ट नाही": "Daily work is not clear",
  "मजुरी / कामाचा पुरावा नाही": "No labour / work proof",
  "खर्चाचा मागोवा राहत नाही": "Expenses are not tracked",
  "कुटुंबात समन्वय अवघड आहे": "Family coordination is difficult",
  "शेतमालकाला स्पष्टता कमी आहे": "The landowner lacks clarity",
  "मुकादम समन्वय": "Supervisor coordination",
  "थोडक्यात सांगा": "Tell us briefly",
  "ShramSafal प्रवेश विनंती पाठवा": "Send ShramSafal access request",
  "फॉर्म भरताना अडलात तर काळजी नको — फक्त नाव आणि नंबर द्या, बाकीचं आपण बोलताना ठरवू.":
    "If the form feels difficult, do not worry. Just share your name and number; we can discuss the rest.",
  "तुम्हाला काय मिळेल": "What you get",
  "रोजची छोटी स्पष्टता, हंगामभरात मोठा फरक.":
    "Small daily clarity, a big difference across the season.",
  "७ दिवसांत": "In 7 days",
  "आजचं आणि राहिलेलं काम वेगळं दिसू लागतं.":
    "Today's work and pending work begin to look separate.",
  "३० दिवसांत": "In 30 days",
  "खर्च कुठे वाढतो आणि कुठे पुनरावृत्ती होते हे स्पष्ट होतं.":
    "Where cost rises and where repetition happens becomes clear.",
  "१ हंगामात": "In 1 season",
  "शेताचा स्वतःचा वापरता येणारा इतिहास तयार होतो; पुढचे निर्णय अंदाजावर नाही, नोंदीवर.":
    "The farm gets its own usable history; future decisions move from guesswork to records.",
  "प्रामाणिक वचन": "Honest promise",
  "जे करू शकतो ते सांगतो. जे करू शकत नाही, तेही सांगतो.":
    "We say what we can do. We also say what we cannot do.",
  "आम्ही देतो": "What we give",
  "आम्ही देत नाही": "What we do not give",
  "आम्ही देतो — रोजच्या कामाची स्पष्ट, विश्वासार्ह नोंद. खर्चाचा मागोवा. राहिलेल्या कामाचा पाठपुरावा. आणि ते सगळं, पूर्णपणे तुमचंच.":
    "What we give — a clear, reliable record of daily work. Expense tracking. Follow-up on pending work. And all of it remains yours.",
  "आम्ही देत नाही — \"वापरा आणि नफा वाढेल\" असं खोटं वचन नाही. नफा हमीने मिळत नाही. पण रोजचं काम, खर्च आणि पाठपुरावा स्पष्ट असला, की चांगला निर्णय घेणं सोपं होतं — आणि तीच नफ्याच्या दिशेने पहिली पायरी आहे.":
    "What we do not give — no false promise that using it will automatically increase profit. Profit is not guaranteed. But when daily work, costs, and follow-up are clear, better decisions become easier, and that is the first step toward profit.",
  "नाव दिल्यानंतर पुढे काय": "What happens after you share your name",
  "टीम तुम्हाला फोन करते. घाई नाही, विक्रीचा दबाव नाही.":
    "The team calls you. No rush, no sales pressure.",
  "तुमची शेती, तुमची पद्धत आणि सध्याची अडचण समजून घेतली जाते.":
    "Your farm, your method, and your current difficulty are understood.",
  "तुम्हाला सोयीचं असेल तेव्हा, प्रत्यक्ष बघून पुढचं ठरवू — आधी बघा, मग ठरवा.":
    "When it is convenient, we can look practically and decide next. First see it, then decide.",
  "धन्यवाद.": "Thank you.",
  "ShramSafal टीम तुमच्याशी संपर्क करेल. आम्ही आधी कमी शेतकऱ्यांसोबत खोलवर काम करणार आहोत, कारण विश्वास घाईत तयार होत नाही.":
    "The ShramSafal team will contact you. We are first working deeply with fewer farmers because trust is not built in a hurry.",
  "तुमच्या शेताची माहिती तुमची आहे. ShramSafal ती जबाबदारीने आणि संमतीनेच वापरेल.":
    "Your farm information is yours. ShramSafal will use it responsibly and only with consent.",
  "विश्वासाचा कणा वाचा →": "Read the trust spine →",

  "शेतीत सगळ्यात जास्त कमी पडतो तो एकच — विश्वास.":
    "The one thing farming lacks most is trust.",
  "शेतकरी वर्षानुवर्षे खरं काम करतो, मेहनत करतो, प्रामाणिक व्यवहार करतो. पण त्या कष्टाला आणि त्या प्रामाणिकपणाला विश्वासार्ह ठरवणारं कोणतंच माप त्याच्याकडे नाही.":
    "A farmer works honestly for years, puts in effort, and deals sincerely. But he has no reliable measure that proves that effort and honesty.",
  "ShramSafal ची सुरुवातच इथून होते — तुमच्या खऱ्या कामातून तुमचा स्वतःचा विश्वास उभा करण्यापासून.":
    "ShramSafal begins here — by helping you build your own trust from your real work.",
  "ओळख": "Identity",
  "विश्वास का उभा राहत नाही": "Why trust does not stand",
  "व्यवसायात विश्वास सहज मिळत नाही — तो कमवावा लागतो.":
    "In business, trust is not received easily. It must be earned.",
  "मोठ्या व्यापारी वर्तुळात ठरावीक लोकांनाच प्रवेश असतो. कारण तिथे प्रत्येकाच्या कामाची, व्यवहाराची आणि शब्दाची एक पाठराखण असते — कोणीतरी खात्रीने सांगू शकतं, \"हा माणूस विश्वासार्ह आहे.\"":
    "In large business circles, only certain people get access. There is backing for each person's work, dealings, and word — someone can confidently say, \"this person is trustworthy.\"",
  "पण शेतकऱ्याच्या बाजूला अशी पाठराखण कोणाचीच नसते.":
    "But the farmer rarely has that kind of backing.",
  "ना बँकेसमोर, ना व्यापाऱ्यासमोर, ना बाजारासमोर — शेतकऱ्याला विश्वासार्ह ठरवणारी कोणतीच व्यवस्था नाही.":
    "Not before a bank, not before a trader, not before the market — there is no system that establishes the farmer as trustworthy.",
  "शेतीतली ही सगळ्यात मोठी पोकळी आहे. आणि याच पोकळीमुळे खरं काम करूनही शेतकरी अनेक ठिकाणी मागे राहतो.":
    "This is farming's largest gap. Because of it, even honest work leaves the farmer behind in many places.",
  "म्हणूनच विश्वास हाच कणा": "That is why trust is the spine",
  "विश्वास हाच ShramSafal चा कणा आहे.":
    "Trust is the spine of ShramSafal.",
  "आणि हा विश्वास कोणी बाहेरून आणून देणार नाही — तो तुम्ही, शेतकरी, स्वतःच्या रोजच्या खऱ्या कामातून उभा कराल.":
    "And no one will bring this trust from outside. You, the farmer, will build it from your real daily work.",
  "आम्ही फक्त त्या विश्वासाला जागा देतो, आणि तो प्रामाणिकपणे जपतो.":
    "We only create space for that trust, and preserve it responsibly.",
  "तुमचं ते तुमचंच": "What is yours stays yours",
  "तुमची माहिती तुमचीच": "Your information is yours",
  "ती फक्त तुमच्याच संमतीने वापरली जाते.": "It is used only with your consent.",
  "खोटे दावे नाहीत": "No false claims",
  "ShramSafal उत्पन्न वाढीची जादू सांगत नाही; तो रोजच्या कामाला स्पष्टता देण्यापासून सुरू होतो.":
    "ShramSafal does not promise magic income growth; it starts by bringing clarity to daily work.",
  "विश्वास आधी": "Trust first",
  "म्हणूनच आम्ही पहिल्या गटात कमी लोकांसोबत, पण खोलवर काम करतो.":
    "That is why we work with fewer people in the first group, but more deeply.",
  "जबाबदार सुरुवात": "Responsible beginning",
  "विश्वास कमवायचा असतो. आणि तो तुमच्या रोजच्या खऱ्या कामातून उभा राहतो.":
    "Trust must be earned. It stands from your real daily work.",

  "केवळ रचना आराखडा": "Structure draft only",
  "ShramSafal च्या प्रगतीसोबत हा विभाग विकसित केला जात आहे.":
    "This section is being developed as ShramSafal progresses.",
  "नाव आणि मोबाईल": "Name and mobile",
  "सुरुवातीच्या संपर्कासाठी आवश्यक माहिती.": "Basic information for initial contact.",
  "गाव आणि शेती": "Village and farm",
  "तुमच्या शेतीचा संदर्भ समजण्यासाठी.": "To understand your farming context.",
  "सध्याची अडचण": "Current difficulty",
  "ShramSafal तुमच्यासाठी योग्य आहे का हे समजण्यासाठी.":
    "To understand whether ShramSafal is right for you.",
  "शाश्वत शिस्त": "Sustained discipline",
  "अंदाजावर नाही, तर मोजता येण्याजोग्या कामाच्या नोंदींवर शेती चालवणे.":
    "Running farming on measurable work records, not guesswork.",
  "मातीचा पोत, पिकांचा इतिहास आणि अनुभवाचे शास्त्रीय वर्गीकरण.":
    "Scientific classification of soil texture, crop history, and experience.",
  "वैज्ञानिक दिशा": "Scientific direction",
  "अचूक हवामान आणि पाण्याची समज घेऊन वेळेवर अंमलबजावणी करणे.":
    "Timely execution based on accurate weather and water understanding.",
  "पुढची पिढी": "Next generation",
  "शेतीला नवी तांत्रिक प्रतिष्ठा मिळवून देऊन तरुणांना आकर्षित करणे.":
    "Giving farming new technical dignity that can attract young people.",
  "लहान शेतकरी": "Small farmer",
  "जे स्वतः काम पाहतात, पण अंदाजापेक्षा स्पष्टता हवी आहे.":
    "Those who see the work themselves, but want more clarity than guesswork.",
  "जे प्रत्येक वेळी शेतात नसतात, पण कामाचा विश्वासार्ह मागोवा हवा आहे.":
    "Those who are not always in the field, but need reliable work tracking.",
  "जे काम, माणसं आणि जबाबदारी यांना स्पष्ट पुराव्यात आणू इच्छितात.":
    "Those who want to turn work, people, and responsibility into clear proof.",
  "नष्ट होणारे कष्ट": "Efforts got vanished",
  "फक्त उत्पन्न घ्यायचं असेल, तर अंदाज पुरेसा वाटतो. पण शेतीला व्यवसाय म्हणून उभं करायचं असेल, तर रोजच्या कामाचं नियोजन, खर्चाचा मागोवा, वेळेवर अंमलबजावणी आणि प्रत्येकाच्या मेहनतीचा हिशोब — हे पर्याय राहत नाहीत,":
    "If the aim is only to take produce, guesswork may feel enough. But if farming must be built as a business, daily planning, expense tracking, timely execution, and accounting for everyone's effort stop being optional;",
  "गरज": "a need",
  "बनतात.": "they become necessary.",
  "शेतकरी असणं ही": "Being a farmer is an",
  "आहे. शेती व्यवसाय म्हणून उभी करणं ही": "identity. Building farming as a business is a",
  "आहे.": "responsibility.",
  "हीच स्पष्टता सातत्याने तयार होत राहिली, तर याच आधारावर उद्या —":
    "If this clarity keeps building consistently, tomorrow it can open new paths for —",
  "मजूर नियोजन, कामाची कार्यक्षमता, शेतमालकाची नजर, गावातील कामाची मागणी आणि बाजाराशी जोडणी":
    "labour planning, work efficiency, landowner visibility, village work demand, and market linkage",
  "— यांचे नवे मार्ग उघडू शकतात.": "— on this same foundation.",
  "आजच्या कामाची स्पष्टता उद्याच्या मोठ्या निर्णयांचा पाया बनू शकते.":
    "Today's work clarity can become the foundation for tomorrow's bigger decisions.",
  "आजचं काम": "Today's work",
  "आज काय झालं, काय राहिलं आणि कुठे अडलं हे स्पष्ट करणं.":
    "Making clear what happened today, what remains, and where work got stuck.",
  "कामाचा पुरावा": "Proof of work",
  "जे काम स्पष्ट होतं, त्याचा पुरावा राहतो.": "Work that becomes clear leaves proof behind.",
  "स्वतःचा विश्वास": "Self-trust",
  "तोच पुरावा हळूहळू तुमचा विश्वास बनतो.": "That proof slowly becomes your trust.",
  "तुमची ओळख": "Your identity",
  "तुमच्या खऱ्या कामातून तुमची ओळख उभी राहते.":
    "Your identity stands from your real work.",
  "स्पष्टता → पुरावा → विश्वास → ओळख": "Clarity → Proof → Trust → Identity",
  "आपल्या देशातला शेतकरी मेहनतीला कधीच कमी पडत नाही. कमी पडते ती — त्या मेहनतीला मिळणारी":
    "The farmer in our country never lacks effort. What is missing is the",
  "शेतकऱ्याला कष्टाची कमी नाही. कमी आहे — शेतीची":
    "The farmer does not lack effort. What is missing is farming's",
  "विश्वासार्ह स्मृती.": "reliable memory.",
  "शेतीचं भविष्य बदलायचं असेल, तर": "To change farming's future,",
  "पण बाजाराशी जोडणी हा": "But market linkage is an",
  "आहे. त्याच्या खाली एक मूलभूत प्रश्न आहे —": "layer. Beneath it is a basic question —",
  "श्रमसफल इथून सुरू होतं — सगळ्यात": "ShramSafal starts here — from the",
  "हा थर एकदा उभा राहिला, की त्यावर पुढचे अनेक थर शक्य होतात.":
    "Once this layer stands, many other layers become possible on top of it.",
  "आणि या सगळ्याखालचा सगळ्यात खोल थर म्हणजे —":
    "And the deepest layer beneath all of this is —",
  "कामाचं सत्य स्पष्ट झालं, की शेतकऱ्याच्या कष्टाला पुरावा मिळतो; आणि तोच पुरावा त्याची खरी ओळख बनतो.":
    "when the truth of work becomes clear, the farmer's effort receives proof; that proof becomes his real identity.",
  "म्हणून शेतीला केवळ कष्टाची नाही,": "That is why farming needs not only effort, but",
  "गरज आहे.": ".",
  "श्रमसफल रोजच्या शेतकामाला": "ShramSafal gives daily farm work",
  "देतं.": ".",
  "खरी ताकद लिहिण्यात नाही. ती आहे — त्या स्पष्टतेतून मिळणाऱ्या":
    "The real strength is not in writing things down. It is in the",
  "ShramSafal कोणासाठी आहे": "Who ShramSafal is for",
  "जे स्वतः रोज काम पाहतात, पण काय झालं आणि काय बाकी आहे याची स्पष्टता हवी आहे.":
    "Those who personally watch daily work, but need clarity on what happened and what remains.",
  "प्रगतिशील शेतकरी": "Progressive farmer",
  "जे शेतीला अंदाजावर नाही, तर शिस्त, हिशोब आणि सुधारणा यावर चालवू इच्छितात.":
    "Those who want farming to run on discipline, accounting, and improvement instead of guesswork.",
  "जे प्रत्येक वेळी शेतात नसतात, पण काम, खर्च आणि जबाबदारीचा विश्वासार्ह मागोवा हवा आहे.":
    "Those who are not always in the field, but need reliable tracking of work, cost, and responsibility.",
  "जे मजूर, वेळ आणि कामाचा पुरावा स्पष्ट ठेवून विश्वास वाढवू इच्छितात.":
    "Those who want to build trust by keeping labour, time, and proof of work clear.",
  "कुटुंबाने चालवलेली शेती": "Family-run farming",
  "जिथे निर्णय, खर्च आणि काम अनेक लोकांमध्ये विभागलेले असतात.":
    "Where decisions, expenses, and work are divided across several people.",
  "भविष्यातील ग्रामीण उद्योजक": "Future rural operator",
  "जे गावात विश्वासार्ह शेती-कामकाज सांभाळणारे म्हणून उभे राहू इच्छितात.":
    "Those who want to stand in the village as trusted handlers of farm operations.",
  "ज्याच्याकडे माणसं जोडण्याची क्षमता आहे, काम उभं करण्याची जबाबदारी आहे आणि गावात विश्वास आहे — त्याच्यासाठी ShramSafal उद्या":
    "For someone who can connect people, take responsibility for work, and has trust in the village, ShramSafal can tomorrow become the foundation for",
  "बनण्याचा पाया ठरू शकतो.": ".",
  "मुकादम ते ग्रामीण उद्योजक": "Supervisor to rural operator",
  "— रोजच्या कामाची स्पष्ट, विश्वासार्ह नोंद. खर्चाचा मागोवा. राहिलेल्या कामाचा पाठपुरावा. आणि ते सगळं, पूर्णपणे तुमचंच.":
    "— a clear, reliable record of daily work. Expense tracking. Follow-up on pending work. And all of it remains completely yours.",
  "— \"वापरा आणि नफा वाढेल\" असं खोटं वचन नाही. नफा हमीने मिळत नाही. पण रोजचं काम, खर्च आणि पाठपुरावा स्पष्ट असला, की चांगला निर्णय घेणं सोपं होतं — आणि तीच नफ्याच्या दिशेने पहिली पायरी आहे.":
    "— no false promise that using it will automatically increase profit. Profit is not guaranteed. But when daily work, costs, and follow-up are clear, better decisions become easier — and that is the first step toward profit.",

  /* --- gap fill: these rendered as Marathi on the English page --- */
  "ShramSafal — शेतीला व्यवसायासारखं चालवणाऱ्या शेतकऱ्यांसाठी":
    "ShramSafal — For farmers who run farming like a business",
  "दृष्टी व विचार — श्रमसफल | ShramSafal": "Vision and Philosophy — ShramSafal",
  "शेतकरी व कामकाज सांभाळणाऱ्यांसाठी — ShramSafal":
    "For Farmers and Farm Operators — ShramSafal",
  "पहिल्या जबाबदार गटात नाव जोडा — ShramSafal": "Join the First Responsible Group — ShramSafal",
  "विश्वास हाच कणा — ShramSafal": "Trust Is the Spine — ShramSafal",
  "जमीन असणं वेगळं, शेती उभी करणं वेगळं. रोजच्या शेतकामाला दिशा, हिशोब आणि जबाबदारीचा कणा. पहिल्या जबाबदार गटात नाव जोडा.":
    "Owning land is one thing. Building farming as an operation is another. A spine of direction, accounts, and responsibility for daily farm work. Join the first responsible group.",
  "शेतातली रोजची मेहनत हरवू नये; ती स्पष्टतेत, विश्वासात आणि चांगल्या निर्णयांत बदलावी. शेतीचं रोजचं सत्य — श्रमसफलची दृष्टी.":
    "Daily effort in the field should not be lost; it should turn into clarity, trust, and better decisions. The daily truth of farming — ShramSafal's vision.",
  "१० गुंठे असो किंवा १०० एकर — शेती चालवायला स्पष्टता लागतेच. काम, खर्च, मजुरी आणि जबाबदारीचा विश्वासार्ह मागोवा. हे कोणासाठी आहे ते पाहा.":
    "Whether 10 guntha or 100 acres — running a farm takes clarity. A reliable record of work, costs, wages, and responsibility. See who this is for.",
  "रोजच्या शेतकामाला दिशा, हिशोब आणि जबाबदारी हवी असेल, तर पहिल्या जबाबदार गटात सामील व्हा. आधी कमी शेतकऱ्यांसोबत खोलवर काम.":
    "If you want direction, accounts, and responsibility for daily farm work, join the first responsible group. Deep work with fewer farmers first.",
  "शेतीत सगळ्यात कमी पडतो तो विश्वास. शेतकऱ्याला विश्वासार्ह ठरवणारी व्यवस्थाच नाही. तुमच्या खऱ्या कामातून तुमचा स्वतःचा विश्वास उभा करा.":
    "What farming lacks most is trust. There is no system that establishes a farmer as trustworthy. Build your own trust from your real work.",
  "नियोजन, मोजमाप, जबाबदारी आणि सुधारणा यावर शेतीचा कणा उभा करणारा.":
    "Building the spine of farming on planning, measurement, responsibility, and improvement.",
  "खर्च, माणसं, वेळ आणि पुरावा यांना स्पष्ट जबाबदारी देणारा दृष्टिकोन.":
    "An approach that gives clear responsibility to costs, people, time, and proof.",
  "मेहनत आणि अनुभवातून उभी राहिलेली ओळख.": "An identity built from effort and experience.",
  "रोजच्या कामाचं नियोजन आणि मागोवा ठेवणारी भूमिका.": "A role that plans and tracks daily work.",
  "जबाबदार शेतकरी": "Responsible farmer",
  "शेती व्यवसाय उभारणारा": "Farm business builder",
  "शेती व्यवस्थापक": "Farm manager",
  "हा माणूस विश्वासार्ह आहे.": "This person is trustworthy.",
  "अधिकृत ओळख": "Official identity",
  "कंपनी": "Company",
  "नोंदणी": "Registered",
  "संपर्क": "Contact",


  /* --- form states --- */
  "पाठवत आहे...": "Sending...",
  "पाठवता आलं नाही. पुन्हा प्रयत्न करा.":
    "Could not send. Please try again.",


  /* --- privacy policy (MR drafted by assistant, pending copy review) --- */
  "गोपनीयता धोरण":
    "Privacy Policy",
  "शेवटचा बदल — २ ऑक्टोबर २०२६":
    "Last updated — 2 October 2026",
  "कोण जबाबदार आहे":
    "Who is responsible",
  "ShramSafal हे Agriryot Value Enterprises Private Limited (CIN U62099PN2026PTC256337) चं उत्पादन आहे. तुम्ही दिलेल्या माहितीसाठी हीच कंपनी जबाबदार आहे. संपर्क — arvesystems@gmail.com":
    "ShramSafal is a product of Agriryot Value Enterprises Private Limited (CIN U62099PN2026PTC256337). That company is responsible for the information you give us. Contact — arvesystems@gmail.com",
  "आम्ही काय गोळा करतो":
    "What we collect",
  "तुम्ही फॉर्ममध्ये स्वतः भरता तेवढंच — नाव, मोबाईल नंबर, जिल्हा, गाव, शेतीचा आकार, पीक, तुमची भूमिका, मजूर व्यवस्थापन करता का, आणि तुम्ही लिहिलेली अडचण. तुम्ही निवडलेली भाषा फक्त तुमच्याच ब्राउझरमध्ये साठवली जाते. वेबसाइट कशी वापरली जाते हे समजण्यासाठी आम्ही Google Analytics वापरतो.":
    "Only what you type into the form yourself — name, mobile number, district, village, farm size, crop, your role, whether you manage labour, and the difficulty you describe. The language you choose is stored only in your own browser. We use Google Analytics to understand how the website is used.",
  "का गोळा करतो":
    "Why we collect it",
  "एकाच कारणासाठी — पहिल्या जबाबदार गटाबद्दल तुमच्याशी संपर्क करण्यासाठी. दुसऱ्या कशासाठीही नाही.":
    "For one reason — to contact you about the first responsible group. For nothing else.",
  "ही माहिती कुठे जाते":
    "Where it goes",
  "ShramSafal च्या स्वतःच्या नोंदीत. ती विकली जात नाही, जाहिरातीसाठी वापरली जात नाही, आणि तुमच्या संमतीशिवाय कोणालाही दिली जात नाही.":
    "Into ShramSafal's own records. It is not sold, not used for advertising, and not given to anyone without your consent.",
  "किती काळ ठेवली जाते":
    "How long we keep it",
  "तुम्ही हटवायला सांगेपर्यंत, किंवा शेवटच्या संपर्कानंतर २४ महिने — यापैकी जे आधी येईल.":
    "Until you ask us to delete it, or 24 months after we last spoke — whichever comes first.",
  "तुमचे हक्क":
    "Your rights",
  "तुमची माहिती पाहणे, त्यात दुरुस्ती करणे, किंवा ती पूर्णपणे हटवणे — हे तुम्ही कधीही मागू शकता. arvesystems@gmail.com वर कळवा.":
    "You can ask to see your information, correct it, or have it deleted entirely, at any time. Write to arvesystems@gmail.com.",
  "तक्रार असेल तर":
    "If you have a complaint",
  "arvesystems@gmail.com वर लिहा. आम्ही ३० दिवसांच्या आत उत्तर देऊ.":
    "Write to arvesystems@gmail.com. We will respond within 30 days.",
  "कुकीज":
    "Cookies",
  "Google Analytics वेबसाइटच्या वापराची आकडेवारी गोळा करण्यासाठी कुकीज वापरतं. तुम्ही तुमच्या ब्राउझरमधून त्या बंद करू शकता.":
    "Google Analytics uses cookies to collect website usage statistics. You can turn these off in your browser.",

};

const englishAttributeTranslations: Record<string, string> = {
  ...englishTranslations,
  "तुमचं नाव": "Your name",
  "उदा. नाशिक / दिंडोरी": "e.g. Nashik / Dindori",
  "गाव": "Village",
  "उदा. २ एकर / २० गुंठे": "e.g. 2 acres / 20 guntha",
  "द्राक्ष, कांदा, भाजीपाला...": "Grapes, onion, vegetables...",
  "आज शेतीकामाचा मागोवा कुठे अडकतो?": "Where does farm-work tracking get stuck today?",
  "मी शेतजमीन आहे म्हणून शेतकरी आहे, की शेती एक व्यवसाय म्हणून, नियोजनाने आणि नफ्याच्या दिशेने चालवतो म्हणून शेतकरी आहे?":
    "Am I a farmer because I own farmland, or because I run farming as a planned business moving toward profit?",
  "श्रमसफल लोगो उलगडणे": "ShramSafal logo reveal",
  "श्रमसफल उलगडण्याची तत्त्वे": "ShramSafal reveal principles",
  "श्रमसफलचा दैनिक कामकाज प्रवाह": "ShramSafal daily operations flow",
  "श्रमसफलचा कामकाज कणा": "ShramSafal operations spine",
};

const originalTextNodes = new WeakMap<Text, string>();
const translatedTextNodes = new WeakMap<Text, string>();

const skipSelector = "[data-i18n-static='true'], script, style, noscript, svg";
const translatableAttributes = ["aria-label", "alt", "placeholder", "title"] as const;

export function getStoredLanguage(): LanguageCode | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(languageStorageKey);
  return stored === "en" || stored === "mr" ? stored : null;
}

export function saveStoredLanguage(language: LanguageCode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(languageStorageKey, language);
}

export function shouldShowLanguageGate() {
  return getStoredLanguage() === null;
}

export function normalizeI18nText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function localizeDigits(value: string, language: LanguageCode) {
  const mrDigits = "०१२३४५६७८९";
  const enDigits = "0123456789";
  const source = language === "en" ? mrDigits : enDigits;
  const target = language === "en" ? enDigits : mrDigits;

  return value.replace(/[०-९0-9]/g, (digit) => {
    const index = source.indexOf(digit);
    return index >= 0 ? target[index] : digit;
  });
}

export function translateText(value: string, language: LanguageCode) {
  if (language === "mr") return value;
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const normalized = normalizeI18nText(value);
  if (!normalized) return value;
  const translated = englishTranslations[normalized] ?? localizeDigits(normalized, language);
  // A segment that translates to bare punctuation ("," / "?") must hug the
  // word before it — Marathi word order leaves a space there that English
  // does not want ("farmland ," -> "farmland,").
  const lead = /^[,.?!;:]/.test(translated) ? "" : leading;
  return `${lead}${translated}${trailing}`;
}

function translateAttributeValue(value: string, language: LanguageCode) {
  if (language === "mr") return value;
  const normalized = normalizeI18nText(value);
  if (!normalized) return value;
  return englishAttributeTranslations[normalized] ?? translateText(value, language);
}

// The language JSX is being rendered in. App sets it at the top of each render
// (before any child renders), and the custom JSX runtime reads it.
let renderLanguage: LanguageCode = defaultLanguage;

export function setRenderLanguage(language: LanguageCode) {
  renderLanguage = language;
}

const translatableProps = ["aria-label", "alt", "placeholder", "title"] as const;

/** Translate a host element's string children and translatable attributes. */
export function translateHostProps(props: Record<string, unknown>): Record<string, unknown> {
  if (renderLanguage === "mr" || !props) return props;
  if (props["data-i18n-static"] === "true") return props;

  let next: Record<string, unknown> | null = null;
  const children = props.children;
  if (typeof children === "string") {
    const t = translateText(children, renderLanguage);
    if (t !== children) next = { ...props, children: t };
  } else if (Array.isArray(children) && children.some((c) => typeof c === "string")) {
    let changed = false;
    const mapped = children.map((c) => {
      if (typeof c !== "string") return c;
      const t = translateText(c, renderLanguage);
      if (t !== c) changed = true;
      return t;
    });
    // A lone {" "} before a segment that became bare punctuation would leave
    // "profit ?" — drop that space.
    for (let i = 1; i < mapped.length; i++) {
      const cur = mapped[i];
      if (typeof cur === "string" && /^\s*[,.?!;:]/.test(cur) && mapped[i - 1] === " ") {
        mapped[i - 1] = "";
        changed = true;
      }
    }
    if (changed) next = { ...props, children: mapped };
  }

  for (const key of translatableProps) {
    const value = props[key];
    if (typeof value !== "string") continue;
    const t = translateAttributeValue(value, renderLanguage);
    if (t !== value) {
      next ??= { ...props };
      next[key] = t;
    }
  }
  return next ?? props;
}

function shouldSkipNode(node: Node) {
  const parent = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return Boolean(parent?.closest(skipSelector));
}

function translateTextNode(node: Text, language: LanguageCode) {
  if (shouldSkipNode(node)) return;
  const current = node.textContent ?? "";
  if (!normalizeI18nText(current)) return;

  const previousOriginal = originalTextNodes.get(node);
  const previousTranslation = translatedTextNodes.get(node);
  if (!previousOriginal || (current !== previousOriginal && current !== previousTranslation)) {
    originalTextNodes.set(node, current);
  }

  const original = originalTextNodes.get(node) ?? current;
  const next = language === "mr" ? original : translateText(original, language);
  if (current !== next) {
    node.textContent = next;
  }
  translatedTextNodes.set(node, next);
}

function translateElementAttributes(element: Element, language: LanguageCode) {
  if (element.closest(skipSelector)) return;

  for (const attribute of translatableAttributes) {
    const value = element.getAttribute(attribute);
    if (!value) continue;

    const dataKey = `i18nOriginal${attribute.replace(/(^|-)(\w)/g, (_, __, char: string) => char.toUpperCase())}`;
    const htmlElement = element as HTMLElement;
    const original = htmlElement.dataset[dataKey] ?? value;
    htmlElement.dataset[dataKey] = original;
    const next = language === "mr" ? original : translateAttributeValue(original, language);
    if (value !== next) {
      element.setAttribute(attribute, next);
    }
  }
}

export function applyI18nTranslations(root: ParentNode, language: LanguageCode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return shouldSkipNode(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }

  textNodes.forEach((node) => translateTextNode(node, language));

  const elementRoot =
    root instanceof Element
      ? [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]
      : Array.from(root.querySelectorAll<HTMLElement>("*"));
  elementRoot.forEach((element) => translateElementAttributes(element, language));
}

export function observeI18nTranslations(root: HTMLElement, language: LanguageCode) {
  if (typeof window === "undefined") return () => undefined;

  const apply = () => applyI18nTranslations(root, language);
  const frame = window.requestAnimationFrame(apply);
  const observer = new MutationObserver((mutations) => {
    if (mutations.every((mutation) => mutation.type === "attributes" && mutation.attributeName?.startsWith("data-i18n-original"))) {
      return;
    }
    window.requestAnimationFrame(apply);
  });

  observer.observe(root, {
    attributes: true,
    attributeFilter: ["aria-label", "alt", "placeholder", "title"],
    childList: true,
    subtree: true,
  });

  return () => {
    window.cancelAnimationFrame(frame);
    observer.disconnect();
  };
}
