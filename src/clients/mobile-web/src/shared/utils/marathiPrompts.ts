/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Marathi Farm Vocabulary & Prompts
 * 
 * This module contains Marathi language mappings for agricultural terms,
 * system prompts for Gemini, and few-shot examples.
 */

import { UnclearReason } from '../../features/logs/logs.types';

// Marathi vocabulary mappings
export const MARATHI_VOCAB = {
    // Labour terms
    labour: ['कामगार', 'माणसे', 'मजूर', 'श्रमिक'],
    male_workers: ['भाऊ', 'पुरुष', 'माणसे'],
    female_workers: ['बायका', 'स्त्रिया', 'महिला'],
    hours: ['तास', 'तासे'],
    work: ['काम', 'कामकाज'],

    // Irrigation terms
    irrigation: ['पाणी', 'सिंचन', 'पाणी देणे'],
    drip: ['ठिबक', 'ड्रिप'],
    flood: ['पूर', 'भरपूर पाणी'],
    sprinkler: ['फुहारा', 'स्प्रिंकलर'],
    hours_water: ['तास पाणी'],

    // Machinery terms
    tractor: ['ट्रॅक्टर', 'ट्रक्टर'],
    diesel: ['डिझेल', 'तेल'],
    fuel: ['इंधन', 'डिझेल'],
    rental: ['भाडे', 'भाड्याचे'],

    // Inputs/Fertilizers
    fertilizer: ['खत', 'सेंद्रिय खत', 'रासायनिक खत'],
    pesticide: ['औषध', 'किडनाशक', 'कीटकनाशक'],
    spray: ['फवारणी', 'फवारा', 'स्प्रे'],
    urea: ['युरिया', 'यूरिया'],
    dap: ['डीएपी', 'DAP'],

    // Units
    litre: ['लिटर', 'लीटर'],
    kg: ['किलो', 'किलोग्राम', 'के.जी'],
    bag: ['पोती', 'बॅग'],

    // Cost terms
    rupees: ['रुपये', 'रुपया', '₹'],
    cost: ['खर्च', 'किंमत', 'लागले'],

    // Time
    morning: ['सकाळ', 'सकाळी'],
    afternoon: ['दुपार', 'दुपारी'],
    evening: ['संध्याकाळ', 'संध्याकाळी'],

    // Actions
    did: ['केले', 'केली', 'केला'],
    used: ['वापरले', 'घातले'],
    gave: ['दिले', 'दिला'],
    ran: ['चालवला', 'चालवले'],

    // Grape Specific (added in Phase 19)
    bunch: ['घड', 'घडे', 'घडा'],
    tying: ['बांधणी', 'बांधणे', 'बांधले'],
    thinning: ['छाटणी', 'विरळणी'],
    petal: ['पाकळी', 'पाकळ्या']
};

export const WORK_DONE_MARKERS = {
    completedVerbs: ['दिले', 'केले', 'झाले', 'घातले', 'टाकले', 'फवारले', 'वापरले', 'चालवले', 'कापले', 'काढले', 'पूर्ण केले', 'संपले'],
    pastTimeMarkers: ['आज सकाळी', 'काल', 'परवा', 'आज दुपारी', 'मागच्या आठवड्यात'],
    durationMarkers: ['तास', 'मिनिटे', 'दिवस'],
    quantityMarkers: ['लिटर', 'किलो', 'एकर', 'गुंठे', 'पोती', 'बॅग'],
    workerMarkers: ['माणसांनी', 'लोकांनी', 'कामगारांनी', 'भाऊंनी', 'बायकांनी', 'होते', 'जणांनी']
};

export const TODO_TASK_MARKERS = {
    futureNecessity: ['करायचं आहे', 'करायचं', 'द्यायचं आहे', 'द्यायचं', 'घ्यायचं आहे', 'घ्यायचं', 'आणायचं आहे', 'आणायचं', 'बोलवायचं'],
    modalNecessity: ['पाहिजे', 'हवे', 'लागेल', 'लागणार', 'गरज आहे'],
    futureVerbs: ['करणार', 'करेन', 'देणार', 'येणार', 'घेणार', 'आणणार'],
    imperativeVerbs: ['करा', 'कर', 'द्या', 'दे', 'घ्या', 'घे', 'आणा', 'आण', 'बघा', 'तपासा'],
    futureTimeMarkers: ['उद्या', 'परवा', 'पुढच्या आठवड्यात', 'नंतर', 'संध्याकाळी'],
    planningKeywords: ['बाकी आहे', 'राहिले आहे', 'pending आहे', 'plan आहे', 'ठरवले आहे']
};

export const OBSERVATION_MARKERS = {
    sensoryVerbs: ['दिसत आहे', 'दिसले', 'वाटतो', 'वाटला', 'आहे', 'झाला'],
    stateDescriptors: ['कमी', 'जास्त', 'चांगले', 'वाईट', 'पिवळे', 'सुकलेले', 'ओले', 'खराब'],
    naturalEvents: ['पाऊस आला', 'वारा आला', 'गारा पडल्या', 'ऊन होते'],
    pestDiseaseObs: ['किडे दिसले', 'रोग दिसतो', 'डाग दिसले', 'बुरशी दिसते'],
    equipmentState: ['pressure कमी', 'motor बंद', 'leak आहे', 'चालत नाही'],
    uncertaintyMarkers: ['असू शकतो', 'कदाचित', 'बहुतेक', 'वाटतं'],
    negativePast: ['नाही आला', 'नाही झाले', 'नाही दिले']
};

export const UNCLEAR_MESSAGES: Record<UnclearReason, {
    mr: string;
    en: string;
    suggestion: string;
}> = {
    ambiguous_verb: {
        mr: "हे काम झालं की करायचं आहे, ते समजलं नाही। कृपया पुन्हा सांगा।",
        en: "Couldn't understand if this work is done or planned. Please say again.",
        suggestion: "'आज केले' for done, 'उद्या करायचं' for planned"
    },
    unknown_vocabulary: {
        mr: "काही शब्द ओळखता आले नाहीत। कृपया वेगळ्या शब्दांत सांगा।",
        en: "Some words weren't recognized. Please try different words.",
        suggestion: "Use common terms like खत, औषध, पाणी, कामगार"
    },
    incomplete_sentence: {
        mr: "वाक्य अपूर्ण वाटतं। कृपया पूर्ण माहिती सांगा।",
        en: "Sentence seems incomplete. Please provide full details.",
        suggestion: "Include: काय केलं, किती, कधी"
    },
    conflicting_markers: {
        mr: "एकाच वाक्यात भूतकाळ आणि भविष्यकाळ आला। कृपया वेगवेगळे सांगा।",
        en: "Found both past and future in same sentence. Please separate them.",
        suggestion: "First say what's done, then what's planned"
    },
    no_actionable_content: {
        mr: "यात नोंद करण्यासारखी माहिती नाही। काम किंवा निरीक्षण सांगा।",
        en: "No loggable information found. Please describe work or observation.",
        suggestion: "Describe: काय काम केलं, काय दिसलं, काय करायचं आहे"
    },
    audio_quality: {
        mr: "आवाज नीट ऐकू आला नाही। शांत ठिकाणी पुन्हा बोला।",
        en: "Audio wasn't clear. Please try again in a quieter place.",
        suggestion: "Speak closer to phone, reduce background noise"
    },
    mixed_languages: {
        mr: "खूप भाषा मिसळल्या। एकाच भाषेत सांगा।",
        en: "Too many languages mixed. Please use one language.",
        suggestion: "Stick to Marathi or Hindi for best results"
    },
    unknown: {
        mr: "हे समजलं नाही। कृपया पुन्हा सांगा।",
        en: "Couldn't understand this. Please say again.",
        suggestion: "Speak slowly and clearly"
    }
};

/**
 * Marathi System Prompt for Gemini
 */
export function getMarathiSystemPrompt(
    cropName: string,
    plotName: string,
    date: string,
    maleRate: number,
    femaleRate: number,
    defaultIrrigation: string
): string {
    return `तुम्ही ShramSafal Assistant आहात, भारतीय शेतकऱ्यांसाठी विशेष कृषी डेटा पार्सर आहात.

शेत माहिती (FARM PROFILE):
- पीक: ${cropName}
- शेत: ${plotName}
- तारीख: ${date}
- कामगार दर: पुरुष ₹${maleRate}, स्त्री ₹${femaleRate}
- सामान्य सिंचन: ${defaultIrrigation}

तुमचे काम (YOUR JOB):
शेतकऱ्याचा Voice Transcript 3 प्रमुख बकेट्समध्ये अचूकपणे वर्गीकृत करा.

### 1. WORK DONE (झालेले काम) - DailyLog
जर शेतकरी **भूतकाळात** (PAST DOING) बोलत असेल तर येथे टाका.
- "पाणी दिले", "फवारणी केली", "मजूर आले होते"
- उप-प्रकार: cropActivities, labour, irrigation, inputs, machinery

### 2. TO DO TASKS (नियोजित कामे) - PlannedTasks
जर शेतकरी **भविष्यकाळातील** (FUTURE INTENT) कामे सांगत असेल.
- "करायचं आहे", "पाहिजे", "उद्या कर", "आणायचं"
- "labour ला call करायचं" (Coordination)
- "sulphur आणायचं" (Procurement)

### 3. OBSERVATIONS (निरीक्षणे) - Observations
जर शेतकरी **स्थिती** (STATE) किंवा **नैसर्गिक घटना** (EVENT) सांगत असेल.
- "पाऊस आला" (Event), "pressure कमी वाटला" (State)
- "labour नाही आला" (Negative Observation)
- "पिवळे पान दिसले" (Visual)

भाषा नियम (LANGUAGE RULES):
- शुद्ध मराठी स्वीकारा
- अर्ध वाक्ये, अपूर्ण वाक्ये सहन करा
- "3 भाऊ" = male_count: 3
- "2 बायका" = female_count: 2
- "4 तास" = hours: 4
- "500 रुपये" = cost: 500

खर्च नियम (COST RULES):
- जर शेतकऱ्याने खर्च सांगितला, तो वापरा
- जर नाही सांगितला, auto_cost: true ठेवा
- खत/औषध खर्च न सांगितल्यास null ठेवा

## ⚠️ जर समजलं नाही (WHEN YOU DON'T UNDERSTAND)

### When to mark as "unclear":
1. **confidence < 0.50** - Not confident enough
2. **Unknown words** - Can't recognize vocabulary
3. **Incomplete sentence** - Missing critical information
4. **Conflicting signals** - Past and future mixed confusingly

### Rules:
- **NEVER guess** if confidence is below 0.50 OR if critical information (who, what, when) is missing.
- **NEVER drop** farmer's words - always preserve in rawText.
- **ALWAYS provide** empathetic Marathi message from UNCLEAR_MESSAGES.
- **ALWAYS suggest** how to say it clearer.
- **TRIGGER "unclearSegments"** if any part of the sentence is confusing, even if other parts are partially parsed.



## महत्वाचे भेद (CRITICAL DISTINCTIONS):

### 1. भूतकाळ vs भविष्यकाळ (Past vs Future)
- "पाणी दिले" (past) → सिंचन नोंद ✔️
- "पाणी द्यायचं" (future) → नियोजित कार्य (planned_tasks) ✔️
भूतकाळ क्रियापदे: "केले", "केली", "झाले", "दिले", "वापरले", "आला", "वाटला"
भविष्यकाळ क्रियापदे: "करायचं", "पाहिजे", "हवे", "लागेल", "आणायचं", "घ्यायचं", "बोलवायचं"

### 2. कर्ता vs कर्म (Subject vs Object)
- "labour ने काम केले" (labour = कर्ता) → कामगार नोंद ✔️
- "labour ला call करायचं" (labour = कर्म) → नियोजित कार्य ✔️

### 3. घटना vs कृती (Event vs Action)
- "पाऊस आला" (नैसर्गिक घटना) → हवामान निरीक्षण (notes) ✔️
- "पाणी दिले" (शेतकऱ्याची कृती) → सिंचन नोंद ✔️
**पाऊस ≠ सिंचन!** पाउस हा हवामान आहे, शेतकऱयाने केलेली कृती नाही.

### 4. वापर vs खरेदी (Usage vs Procurement)
- "sulphur फवारला" (वापरले) → औषध नोंद (inputs) ✔️
- "sulphur आणायचं" (घ्यायचं) → खरेदी कार्य (planned_tasks) ✔️

**नियम: क्रियापदाचे रूप शब्दांपेक्षा महत्वाचे आहे!**

## 🔫🌱 INPUT CLASSIFICATION — SPRAY vs NUTRITION (महत्वाचे!)

प्रत्येक input item साठी **method** आणि **type** फील्ड अचूकपणे भरा.

### SPRAY (फवारणी) — method: "Spray", type: "pesticide" / "fungicide"
खालील शब्द आल्यास ते SPRAY आहे:
- फवारणी, स्प्रे, औषध मारलं, औषध फवारलं, कीटकनाशक, बुरशीनाशक
- Fungicide, Pesticide, Insecticide, Mancozeb, Carbendazim, Chlorpyrifos
- तणनाशक (Herbicide)
- GA3, Ethrel, NAA (Growth regulators applied via spray)
- "2 ब्लोअर मारले", "टॅंक मारला" — ब्लोअर/टॅंक = spray carrier

### NUTRITION (पोषण) — method: "Drip" / "Soil", type: "fertilizer"
खालील शब्द आल्यास ते NUTRITION आहे:
- खत, सेंद्रिय खत, रासायनिक खत
- DAP, युरिया, 18:18:10, 19:19:19, Potash, SSP, MOP
- ड्रिपमधून दिले, फर्टिगेशन, solubles
- शेणखत, बायोफर्टिलायझर, ह्युमिक ॲसिड
- "खत टाकलं", "खत दिलं", "गांडूळ खत", "सूक्ष्मअन्नद्रव्य"

### नियम:
1. एका दिवशी spray आणि nutrition दोन्ही असू शकतात — वेगवेगळे items म्हणून नोंद करा
2. एका spray मध्ये multiple औषधं असू शकतात — mix[] array मध्ये ठेवा
3. एका nutrition application मध्ये multiple खते असू शकतात — mix[] array मध्ये ठेवा
4. **DEFAULT: method आणि type अनिश्चित असल्यास → method: "Soil", type: "fertilizer"**

आउटपुट स्वरूप (OUTPUT FORMAT):
JSON only.
{
  "summary": "थोडक्यात सारांश (मराठी)",
  "dailyLog": {
    "cropActivities": [{ "title": "...", "workTypes": [], "status": "completed" }],
    "labour": { "male_count": 0, "female_count": 0, "hours": 0, "activity": "...", "type": "HIRED", "auto_cost": true },
    "irrigation": { "method": "...", "duration": 0, "source": "..." },
    "machinery": { "type": "...", "purpose": "...", "fuel_cost": 0, "rental_cost": 0 },
    "inputs": { "items": [{ "name": "...", "quantity": 0, "unit": "...", "method": "Spray|Drip|Soil", "type": "pesticide|fungicide|fertilizer|bio", "cost": 0 }] }
  },
  "observations": [
    { "noteType": "observation/issue", "textRaw": "...", "tags": [], "severity": "normal/important/urgent" }
  ],
  "plannedTasks": [
    { "title": "...", "due_hint": "उद्या/null", "category": "maintenance/procurement/coordination", "priority": "normal", "status": "suggested" }
  ],
  "unclearSegments": [
    { "rawText": "...", "confidence": 0.35, "reason": "unknown_vocabulary", "userMessage": "...", "suggestedRephrase": "..." }
  ],
  "confidence": 0.0-1.0
}

जर बकेटमध्ये डेटा नसेल, तर null ठेवा.`;
}

/**
 * Few-shot examples for Marathi voice parsing
 */
export const MARATHI_FEW_SHOT_EXAMPLES = [
    // Example 1: The fails case - Mixed observations and tasks
    {
        input: "आज थोडा पाऊस आला… line pressure कमी वाटला. उद्या pipe check कर. labour ला call करायचं आहे. दुकानातून sulphur आणायचं.",
        output: {
            summary: "हवामान निरीक्षण + 3 कामे pending",
            dailyLog: {
                cropActivities: null,
                labour: null,
                irrigation: null,
                inputs: null,
                machinery: null
            },
            observations: [
                { noteType: "observation", textRaw: "आज थोडा पाऊस आला", tags: ["weather", "rain"], severity: "normal" },
                { noteType: "issue", textRaw: "line pressure कमी वाटला", tags: ["equipment", "pressure"], severity: "important" }
            ],
            plannedTasks: [
                { title: "Pipe check करणे", due_hint: "उद्या", category: "maintenance", priority: "normal", status: "suggested" },
                { title: "Labour ला call करणे", due_hint: null, category: "coordination", priority: "normal", status: "suggested" },
                { title: "Sulphur आणणे (दुकानातून)", due_hint: null, category: "procurement", priority: "normal", status: "suggested" }
            ],
            confidence: 0.90
        }
    },

    // Example 2: Labour actually working (Work Done)
    {
        input: "आज 3 माणसांनी 4 तास फवारणी केली, 2 लिटर औषध वापरले",
        output: {
            summary: "फवारणी पूर्ण - 3 माणसे, 4 तास",
            dailyLog: {
                cropActivities: [{ title: "फवारणी", workTypes: ["Spraying"], status: "completed" }],
                labour: { male_count: 3, female_count: 0, hours: 4, activity: "फवारणी", type: "HIRED", auto_cost: true },
                irrigation: null,
                inputs: { items: [{ name: "कीटकनाशक औषध", quantity: 2, unit: "लिटर", method: "Spray", type: "pesticide", cost: null }] },
                machinery: null
            },
            observations: null,
            plannedTasks: null,
            confidence: 0.95
        }
    },

    // Example 3: Labour mentioned but NOT working (Negative Obs + Possible Task)
    {
        input: "आज labour आला नाही, उद्या बोलवायचं आहे",
        output: {
            summary: "कामगार आला नाही + उद्या नियोजन",
            dailyLog: {
                cropActivities: null, labour: null, irrigation: null, inputs: null, machinery: null
            },
            observations: [
                { noteType: "observation", textRaw: "आज labour आला नाही", tags: ["labour", "absence"], severity: "important" }
            ],
            plannedTasks: [
                { title: "Labour ला उद्या बोलवणे", due_hint: "उद्या", category: "coordination", priority: "normal", status: "suggested" }
            ],
            confidence: 0.92
        }
    },

    // Example 4: Input for future purchase (Procurement Task)
    {
        input: "खत संपले आहे, DAP आणि युरिया मागवायचं आहे",
        output: {
            summary: "खत संपले (निरीक्षण) + खरेदी",
            dailyLog: { cropActivities: null, labour: null, irrigation: null, inputs: null, machinery: null },
            observations: [
                { noteType: "issue", textRaw: "खत संपले आहे", tags: ["inventory", "fertilizer"], severity: "important" }
            ],
            plannedTasks: [
                { title: "DAP आणि युरिया मागवणे", due_hint: null, category: "procurement", priority: "normal", status: "suggested" }
            ],
            confidence: 0.95
        }
    },

    // Example 5: Mix of Work Done + To Do
    {
        input: "आज 2 तास पाणी दिले, उद्या खत टाकायचे आहे",
        output: {
            summary: "सिंचन पूर्ण + उद्या खत नियोजन",
            dailyLog: {
                cropActivities: null,
                labour: null,
                irrigation: { method: "ठिबक", duration: 2, source: "विहीर" },
                inputs: null,
                machinery: null
            },
            observations: null,
            plannedTasks: [
                { title: "खत टाकणे", due_hint: "उद्या", category: "fertilization", priority: "normal", status: "suggested" }
            ],
            confidence: 0.92
        }
    },

    // Example 6: Observation with implicit task
    {
        input: "पानांवर किडे दिसले, फवारणी पाहिजे",
        output: {
            summary: "किडे दिसले (Issue) + फवारणी पाहिजे",
            dailyLog: { cropActivities: null, labour: null, irrigation: null, inputs: null, machinery: null },
            observations: [
                { noteType: "issue", textRaw: "पानांवर किडे दिसले", tags: ["pest", "leaves"], severity: "urgent" }
            ],
            plannedTasks: [
                { title: "कीटकनाशक फवारणी", due_hint: "तात्काळ", category: "pest_control", priority: "high", status: "suggested" }
            ],
            confidence: 0.88
        }
    },

    // Example 7: Labour actually working - goes to DailyLog (Gender breakdown)
    {
        input: "आज 4 भाऊ आणि 2 बायका होत्या, निंदणी केली 6 तास",
        output: {
            summary: "निंदणी पूर्ण - 6 माणसे, 6 तास",
            dailyLog: {
                cropActivities: [{ title: "निंदणी", workTypes: ["Weeding"], status: "completed" }],
                labour: { male_count: 4, female_count: 2, hours: 6, activity: "निंदणी", type: "HIRED", auto_cost: true },
                irrigation: null,
                inputs: null,
                machinery: null
            },
            observations: null,
            plannedTasks: null,
            confidence: 0.94
        }
    },

    // Example 8: Unclear / Unknown Vocabulary (Empathetic Fallback)
    {
        input: "आज कालची बाब झाली नाही अजून",
        output: {
            summary: "काही भाग समजला नाही",
            dailyLog: { cropActivities: null, labour: null, irrigation: null, inputs: null, machinery: null },
            observations: null,
            plannedTasks: null,
            unclearSegments: [
                {
                    rawText: "कालची बाब झाली नाही",
                    confidence: 0.40,
                    reason: "unknown_vocabulary",
                    userMessage: "\"कालची बाब\" समजलं नाही। कृपया स्पष्ट करा - काय झालं?",
                    suggestedRephrase: "काय काम झालं किंवा काय समस्या आली ते सांगा"
                }
            ],
            confidence: 0.40
        }
    }
];

/**
 * Build user prompt with farmer's voice transcript
 */
export function buildMarathiUserPrompt(transcript: string): string {
    return `शेतकऱ्याने म्हटले: "${transcript}"

वरील वाक्य पार्स करा आणि JSON आउटपुट द्या. फक्त JSON, स्पष्टीकरण नको.

लक्षात ठेवा:
- माहिती न मिळाल्यास null ठेवा
- गृहितक घेऊ नका
- कामगार खर्च न सांगितल्यास auto_cost: true
- खत/औषध खर्च न सांगितल्यास cost: null
- confidence हा तुमचा आत्मविश्वास सांगतो (0.0-1.0)`;
}

/**
 * Extract JSON from Gemini response
 */
export function extractJSON(text: string): string {
    // Try to find JSON block wrapped in ```json ... ```
    const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonBlockMatch) {
        return jsonBlockMatch[1].trim();
    }

    // Try to find JSON block wrapped in ``` ... ```
    const codeBlockMatch = text.match(/```\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
        return codeBlockMatch[1].trim();
    }

    // Try to find raw JSON object
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        return jsonMatch[0].trim();
    }

    throw new Error('No JSON found in Gemini response');
}
