using System.Text;

namespace ShramSafal.Infrastructure.AI;

internal static class MarathiPromptData
{
    public static readonly IReadOnlyDictionary<string, string[]> MarathiVocab =
        new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
        {
            ["labour"] = ["कामगार", "माणसे", "मजूर", "श्रमिक"],
            ["male_workers"] = ["भाऊ", "पुरुष", "माणसे"],
            ["female_workers"] = ["बायका", "स्त्रिया", "महिला"],
            ["worker_ordinals"] = ["तिघे", "तिघांनी", "चौघे", "चौघांनी", "पाचजण", "पाचजणांनी", "सहाजण", "सहाजणांनी"],
            ["worker_ranges"] = ["दोन-तीन", "तीन-चार", "पाच-सहा"],
            ["hours"] = ["तास", "तासे"],
            ["work"] = ["काम", "कामकाज"],
            ["irrigation"] = ["पाणी", "सिंचन", "पाणी देणे"],
            ["drip"] = ["ठिबक", "ड्रिप"],
            ["flood"] = ["पूर", "भरपूर पाणी"],
            ["sprinkler"] = ["फुहारा", "स्प्रिंकलर"],
            ["hours_water"] = ["तास पाणी"],
            ["tractor"] = ["ट्रॅक्टर", "ट्रक्टर"],
            ["diesel"] = ["डिझेल", "तेल"],
            ["fuel"] = ["इंधन", "डिझेल"],
            ["rental"] = ["भाडे", "भाड्याचे"],
            ["fertilizer"] = ["खत", "सेंद्रिय खत", "रासायनिक खत"],
            ["pesticide"] = ["औषध", "किडनाशक", "कीटकनाशक"],
            ["spray"] = ["फवारणी", "फवारा", "स्प्रे"],
            ["urea"] = ["युरिया", "यूरिया"],
            ["dap"] = ["डीएपी", "DAP"],
            ["litre"] = ["लिटर", "लीटर"],
            ["kg"] = ["किलो", "किलोग्राम", "के.जी"],
            ["bag"] = ["पोती", "बॅग"],
            ["rupees"] = ["रुपये", "रुपया", "₹"],
            ["cost"] = ["खर्च", "किंमत", "लागले"],
            ["morning"] = ["सकाळ", "सकाळी"],
            ["afternoon"] = ["दुपार", "दुपारी"],
            ["evening"] = ["संध्याकाळ", "संध्याकाळी"],
            ["did"] = ["केले", "केली", "केला"],
            ["used"] = ["वापरले", "घातले"],
            ["gave"] = ["दिले", "दिला"],
            ["ran"] = ["चालवला", "चालवले"],
            ["bunch"] = ["घड", "घडे", "घडा"],
            ["tying"] = ["बांधणी", "बांधणे", "बांधले"],
            ["thinning"] = ["छाटणी", "विरळणी"],
            ["petal"] = ["पाकळी", "पाकळ्या"],
            ["ploughing"] = ["नांगरणी", "नांगरून", "नांगर", "नांगरले"],
            ["motor"] = ["मोटर", "पंप", "मोटरपंप"],
            ["broken"] = ["खराब", "बंद पडली", "बंद झाली", "चालू नाही"]
        };

    public static readonly IReadOnlyList<string> WorkDoneMarkers =
    [
        "दिले", "केले", "झाले", "घातले", "टाकले", "फवारले", "वापरले", "चालवले",
        "कापले", "काढले", "पूर्ण केले", "संपले", "घेतले"
    ];

    public static readonly IReadOnlyList<string> FutureIntentMarkers =
    [
        "करायचं आहे", "करायचं", "द्यायचं आहे", "द्यायचं", "घ्यायचं आहे", "घ्यायचं",
        "आणायचं आहे", "आणायचं", "बोलवायचं", "पाहिजे", "हवे", "लागेल", "लागणार",
        "उद्या", "पुढच्या आठवड्यात", "नंतर"
    ];

    public static readonly IReadOnlyList<string> WorkerMarkers =
    [
        "माणसांनी", "लोकांनी", "कामगारांनी", "भाऊंनी", "बायकांनी", "जणांनी", "मजूर"
    ];

    public static readonly IReadOnlyList<string> FewShotExamples =
    [
        """
        Input: "चार लोकांनी खत टाकले आणि तिघांनी पाणी सोडले. पाने पिवळी पडत आहेत. उद्या फवारणी करायचं आहे."
        Output: {"dayOutcome":"WORK_RECORDED","labour":[{"type":"HIRED","count":4,"activity":"fertilizer_application","sourceText":"चार लोकांनी खत टाकले"},{"type":"HIRED","count":3,"activity":"irrigation","sourceText":"तिघांनी पाणी सोडले"}],"inputs":[{"productName":"खत","method":"Soil","type":"fertilizer","sourceText":"खत टाकले"}],"irrigation":[{"method":"Flood","sourceText":"पाणी सोडले"}],"observations":[{"noteType":"issue","textRaw":"पाने पिवळी पडत आहेत","textCleaned":"पाने पिवळी पडत आहेत","severity":"important"},{"noteType":"reminder","textRaw":"उद्या फवारणी करायचं आहे","textCleaned":"उद्या फवारणी करायचं आहे","extractedTasks":[{"id":"task_future_spray","title":"फवारणी करणे","dueDate":"tomorrow","plotId":"current_plot","priority":"normal","status":"suggested","confidence":92,"sourceNoteId":"obs_future_spray","rawText":"उद्या फवारणी करायचं आहे"}],"sourceText":"उद्या फवारणी करायचं आहे"}],"plannedTasks":[{"title":"फवारणी करणे","dueHint":"उद्या"}],"confidence":0.97}
        """,
        """
        Input: "आज थोडा पाऊस आला, line pressure कमी वाटला. उद्या pipe check कर. labour ला call करायचं आहे."
        Output: {"dayOutcome":"DISTURBANCE_RECORDED","observations":[{"noteType":"observation","textRaw":"आज थोडा पाऊस आला"},{"noteType":"issue","textRaw":"line pressure कमी वाटला"}],"plannedTasks":[{"title":"Pipe check करणे"},{"title":"Labour ला call करणे"}],"confidence":0.9}
        """,
        """
        Input: "आज 3 माणसांनी 4 तास फवारणी केली, 2 लिटर औषध वापरले."
        Output: {"dayOutcome":"WORK_RECORDED","cropActivities":[{"title":"फवारणी","workTypes":["Spraying"]}],"labour":[{"type":"HIRED","count":3,"hours":4}],"inputs":[{"productName":"औषध","quantity":2,"unit":"लिटर","method":"Spray","type":"pesticide"}],"confidence":0.95}
        """,
        """
        Input: "आज labour आला नाही, उद्या बोलवायचं आहे."
        Output: {"dayOutcome":"DISTURBANCE_RECORDED","observations":[{"noteType":"observation","textRaw":"labour आला नाही"}],"plannedTasks":[{"title":"Labour ला उद्या बोलवणे","category":"coordination"}],"confidence":0.92}
        """,
        """
        Input: "खत संपले आहे, DAP आणि युरिया मागवायचं आहे."
        Output: {"dayOutcome":"NO_WORK_PLANNED","observations":[{"noteType":"issue","textRaw":"खत संपले आहे"}],"plannedTasks":[{"title":"DAP आणि युरिया मागवणे","category":"procurement"}],"confidence":0.95}
        """,
        """
        Input: "आज 2 तास पाणी दिले, उद्या खत टाकायचे आहे."
        Output: {"dayOutcome":"WORK_RECORDED","irrigation":[{"method":"Drip","durationHours":2}],"plannedTasks":[{"title":"खत टाकणे","dueHint":"उद्या"}],"confidence":0.92}
        """,
        """
        Input: "पानांवर किडे दिसले, फवारणी पाहिजे."
        Output: {"dayOutcome":"DISTURBANCE_RECORDED","observations":[{"noteType":"issue","textRaw":"पानांवर किडे दिसले","severity":"urgent"}],"plannedTasks":[{"title":"कीटकनाशक फवारणी","category":"maintenance"}],"confidence":0.88}
        """,
        """
        Input: "आज 4 भाऊ आणि 2 बायका होत्या, निंदणी केली 6 तास."
        Output: {"dayOutcome":"WORK_RECORDED","cropActivities":[{"title":"निंदणी","workTypes":["Weeding"]}],"labour":[{"maleCount":4,"femaleCount":2,"hours":6,"type":"HIRED"}],"confidence":0.94}
        """,
        """
        Input: "चार लोकांनी खत टाकले आणि तिघांनी पाणी सोडले."
        Output: {"dayOutcome":"WORK_RECORDED","labour":[{"type":"HIRED","count":4,"activity":"fertilizer_application","sourceText":"चार लोकांनी खत टाकले"},{"type":"HIRED","count":3,"activity":"irrigation","sourceText":"तिघांनी पाणी सोडले"}],"inputs":[{"productName":"खत","method":"Soil","type":"fertilizer"}],"irrigation":[{"method":"Flood","sourceText":"पाणी सोडले"}],"confidence":0.96}
        """,
        """
        Input: "दोन माणसांनी छाटणी केली, चार बायकांनी पाने काढली."
        Output: {"dayOutcome":"WORK_RECORDED","labour":[{"type":"HIRED","count":2,"activity":"pruning","sourceText":"दोन माणसांनी छाटणी केली"},{"type":"HIRED","count":4,"activity":"leaf_removal","sourceText":"चार बायकांनी पाने काढली"}],"cropActivities":[{"title":"छाटणी","workTypes":["Pruning"]},{"title":"पाने काढणे","workTypes":["Leaf Removal"]}],"confidence":0.95}
        """,
        """
        Input: "सकाळी चार माणसांनी आणि संध्याकाळी दोन माणसांनी फवारणी केली."
        Output: {"dayOutcome":"WORK_RECORDED","labour":[{"type":"HIRED","count":4,"activity":"spraying","notes":"सकाळी","sourceText":"सकाळी चार माणसांनी"},{"type":"HIRED","count":2,"activity":"spraying","notes":"संध्याकाळी","sourceText":"संध्याकाळी दोन माणसांनी"}],"inputs":[{"productName":"फवारणी","method":"Spray","type":"pesticide"}],"confidence":0.94}
        """,
        """
        Input: "पाने पिवळी पडत आहेत, उद्या खत मारायचं आहे."
        Output: {"dayOutcome":"DISTURBANCE_RECORDED","observations":[{"noteType":"issue","textRaw":"पाने पिवळी पडत आहेत","textCleaned":"पाने पिवळी पडत आहेत","severity":"important"},{"noteType":"reminder","textRaw":"उद्या खत मारायचं आहे","textCleaned":"उद्या खत मारायचं आहे","extractedTasks":[{"id":"task_future_fertilizer","title":"खत मारणे","dueDate":"tomorrow","plotId":"current_plot","priority":"normal","status":"suggested","confidence":92,"sourceNoteId":"obs_future_fertilizer","rawText":"उद्या खत मारायचं आहे"}]}],"plannedTasks":[{"title":"खत मारणे","dueHint":"उद्या"}],"confidence":0.93}
        """,
        """
        Input: "आज कालची बाब झाली नाही अजून."
        Output: {"dayOutcome":"NO_WORK_PLANNED","unclearSegments":[{"rawText":"कालची बाब झाली नाही","reason":"unknown_vocabulary","confidence":0.4}],"confidence":0.4}
        """,
        """
        Input: "चार जणांनी मिळून नांगरून घेतले."
        Output: {"dayOutcome":"WORK_RECORDED","cropActivities":[{"title":"नांगरणी","workTypes":["Tillage"],"sourceText":"नांगरून घेतले"}],"labour":[{"type":"HIRED","count":4,"activity":"tillage","sourceText":"चार जणांनी मिळून नांगरून घेतले"}],"confidence":0.95}
        """,
        """
        Input: "मोटर खराब असल्यामुळे पाणी देता आले नाही."
        Output: {"dayOutcome":"DISTURBANCE_RECORDED","disturbance":{"scope":"PARTIAL","group":"equipment","reason":"motor_failure","severity":"HIGH","blockedSegments":["irrigation"],"note":"मोटर खराब असल्यामुळे पाणी देता आले नाही"},"observations":[{"noteType":"issue","textRaw":"मोटर खराब असल्यामुळे पाणी देता आले नाही","textCleaned":"मोटर खराब असल्यामुळे पाणी देता आले नाही","severity":"important"}],"confidence":0.93}
        """,
        """
        Input: "चार जणांनी नांगरून घेतले. खत दिलं. मोटर खराब असल्यामुळे पाणी देता आले नाही. पानांवर काळे डाग दिसतायत."
        Output: {"dayOutcome":"WORK_RECORDED","cropActivities":[{"title":"नांगरणी","workTypes":["Tillage"],"sourceText":"नांगरून घेतले"}],"labour":[{"type":"HIRED","count":4,"activity":"tillage","sourceText":"चार जणांनी नांगरून घेतले"}],"inputs":[{"productName":"खत","type":"fertilizer","method":"Soil","sourceText":"खत दिलं"}],"disturbance":{"scope":"PARTIAL","group":"equipment","reason":"motor_failure","severity":"HIGH","blockedSegments":["irrigation"],"note":"मोटर खराब असल्यामुळे पाणी देता आले नाही"},"observations":[{"noteType":"issue","textRaw":"मोटर खराब असल्यामुळे पाणी देता आले नाही","severity":"important"},{"noteType":"issue","textRaw":"पानांवर काळे डाग दिसतायत","severity":"important"}],"confidence":0.93}
        """,

        // =====================================================================
        // C10 CURRICULUM — 4 skills: batch-decomposition, carrier-vs-irrigation,
        // dose-basis-abstention, decision-chain.
        // spec: ai-intelligence-plan-2026-06-25
        // =====================================================================

        // ------------------------------------------------------------------
        // SKILL 1: BATCH DECOMPOSITION
        // Rule: When multiple products are named, emit ONE inputs[] row per
        // product. NEVER merge a multi-product tank into a single row.
        // ------------------------------------------------------------------

        // S1-POSITIVE: 3 products named → 3 distinct inputs rows.
        """
        Input: "इथरेल आणि 00:52:34 आणि फॉस्फोरिक ॲसिड मिसळून बलोवेरने फवारणी केली."
        Output: {"dayOutcome":"WORK_RECORDED","inputs":[{"productName":"Ethrel","rawProductName":"इथरेल","type":"other","method":"Spray","sourceText":"इथरेल"},{"productName":"0-52-34","rawProductName":"00:52:34","type":"fertilizer","method":"Spray","sourceText":"00:52:34"},{"productName":"phosphoric acid","rawProductName":"फॉस्फोरिक ॲसिड","type":"other","method":"Spray","sourceText":"फॉस्फोरिक ॲसिड"}],"confidence":0.94}
        """,

        // S1-ABSTENTION: One product clear (Ethrel), second product name
        // unclear → emit the clear row, put the unclear segment in
        // unclearSegments. Do NOT skip the clear one or guess the unclear one.
        """
        Input: "इथरेल आणि त्या गोळ्या मिसळून फवारणी केली."
        Output: {"dayOutcome":"WORK_RECORDED","inputs":[{"productName":"Ethrel","rawProductName":"इथरेल","type":"other","method":"Spray","sourceText":"इथरेल"}],"unclearSegments":[{"rawText":"त्या गोळ्या","reason":"unknown_vocabulary","confidence":0.4}],"confidence":0.72}
        """,

        // S1-NEGATIVE (contrast): Farmer says all three in one tank — still
        // emit 3 separate rows. Do NOT collapse into one merged row.
        """
        Input: "सगळं एकत्र मिसळून — इथरेल, 00:52:34, फॉस्फोरिक ॲसिड — एकाच टँकमधून फवारले."
        Output: {"dayOutcome":"WORK_RECORDED","inputs":[{"productName":"Ethrel","rawProductName":"इथरेल","type":"other","method":"Spray","sourceText":"इथरेल"},{"productName":"0-52-34","rawProductName":"00:52:34","type":"fertilizer","method":"Spray","sourceText":"00:52:34"},{"productName":"phosphoric acid","rawProductName":"फॉस्फोरिक ॲसिड","type":"other","method":"Spray","sourceText":"फॉस्फोरिक ॲसिड"}],"confidence":0.93}
        """,

        // ------------------------------------------------------------------
        // SKILL 2: CARRIER-VS-IRRIGATION
        // Rule: Water used as a spray carrier belongs on the inputs[] row
        // (as a volume note). It is NOT an irrigation event. Only emit
        // irrigation[] when the farmer describes watering the soil/roots.
        // ------------------------------------------------------------------

        // S2-POSITIVE: 1000 L is spray carrier — goes on the input row as a
        // note; irrigation[] is empty because no soil watering was done.
        """
        Input: "इथरेल फवारणीसाठी एक हजार लिटर पाणी वापरलं. बागेत पाणी दिलं नाही."
        Output: {"dayOutcome":"WORK_RECORDED","inputs":[{"productName":"Ethrel","rawProductName":"इथरेल","type":"other","method":"Spray","notes":"carrier: 1000 L spray water","sourceText":"इथरेल फवारणीसाठी एक हजार लिटर पाणी वापरलं"}],"irrigation":[],"confidence":0.95}
        """,

        // S2-ABSTENTION: "पाणी दिलं" — farmer completed work but gave no duration,
        // no source, no method → dayOutcome=WORK_RECORDED (work happened), and
        // put the missing detail in unclearSegments so the app can ask. Do NOT
        // set DISTURBANCE_RECORDED (that is for when work did NOT happen / was blocked).
        // Do NOT move "पाणी दिलं" into irrigation[] — that would re-break the carrier lesson.
        """
        Input: "आज पाणी दिलं."
        Output: {"dayOutcome":"WORK_RECORDED","unclearSegments":[{"rawText":"आज पाणी दिलं","reason":"incomplete_sentence","confidence":0.5,"userMessage":"किती वेळ पाणी दिले? कोणत्या पद्धतीने — ठिबक, फुहारा, की पूर पाणी?"}],"confidence":0.5}
        """,

        // S2-NEGATIVE (contrast): Water volume stated for mixing — NOT irrigation.
        // "१०० लिटर पाण्यात मिसळून" is spray carrier, must not appear in irrigation[].
        """
        Input: "१०० लिटर पाण्यात बाविस्तीन मिसळून फवारणी केली."
        Output: {"dayOutcome":"WORK_RECORDED","inputs":[{"productName":"Bavistin","rawProductName":"बाविस्तीन","type":"fungicide","method":"Spray","notes":"carrier: 100 L spray water","sourceText":"१०० लिटर पाण्यात बाविस्तीन मिसळून"}],"irrigation":[],"confidence":0.94}
        """,

        // ------------------------------------------------------------------
        // SKILL 3: DOSE-BASIS ABSTENTION
        // Rule: When a dose rate is stated (e.g. 4 ml/L) but the carrier
        // volume is NOT stated, emit doseBasis="NOT_MENTIONED". NEVER compute
        // or fabricate totalMl from an assumed tank size.
        // ------------------------------------------------------------------

        // S3-POSITIVE (which IS the abstention case): dose rate 4 ml/L given;
        // tank volume not spoken → doseBasis=NOT_MENTIONED, no totalMl key.
        """
        Input: "इथरेल ४ मिली प्रति लिटर वापरलं. टँकचं पाणी किती ते सांगितलं नाही."
        Output: {"dayOutcome":"WORK_RECORDED","inputs":[{"productName":"Ethrel","rawProductName":"इथरेल","type":"other","method":"Spray","dosePerLitre":4,"doseUnit":"ml","doseBasis":"NOT_MENTIONED","sourceText":"इथरेल ४ मिली प्रति लिटर"}],"confidence":0.91}
        """,

        // S3-NEGATIVE (contrast): Even if carrier volume seems implied by context
        // (e.g. "standard blower tank"), if NOT spoken → still abstain on totalMl.
        """
        Input: "इथरेल ४ मिली दराने मारलं."
        Output: {"dayOutcome":"WORK_RECORDED","inputs":[{"productName":"Ethrel","rawProductName":"इथरेल","type":"other","method":"Spray","dosePerLitre":4,"doseUnit":"ml","doseBasis":"NOT_MENTIONED","sourceText":"इथरेल ४ मिली दराने"}],"confidence":0.9}
        """,

        // ------------------------------------------------------------------
        // SKILL 4: DECISION-CHAIN
        // Rule: When a farmer states a cause→effect pair (e.g. rain caused
        // them to reduce irrigation), encode it as ONE linked entry showing
        // both the cause and the effect. NEVER split the causal pair into
        // two unrelated standalone rows.
        // ------------------------------------------------------------------

        // S4-POSITIVE: Rain → irrigation cut from 4h to 1h — ONE causal entry.
        // The disturbance captures the weather cause; irrigation shows the reduced
        // duration (durationHours:1) with the causal explanation in notes.
        // Fields used: disturbance.note (cause) + irrigation.durationHours + irrigation.notes.
        // NEVER invent fields like "cause" or "reducedFrom" — they don't exist in the schema.
        """
        Input: "आज पाऊस आला म्हणून ४ तासाचं पाणी १ तासावर आणलं."
        Output: {"dayOutcome":"WORK_RECORDED","disturbance":{"scope":"PARTIAL","group":"weather","reason":"rain","severity":"MEDIUM","blockedSegments":["irrigation"],"note":"पाऊस आला म्हणून सिंचन ४ तासांवरून १ तासावर कमी केले"},"irrigation":[{"method":"Drip","durationHours":1,"notes":"reduced from 4h due to rain","sourceText":"४ तासाचं पाणी १ तासावर आणलं"}],"confidence":0.94}
        """,

        // S4-ABSTENTION: Effect observed (irrigation was short) but cause
        // not stated → record the effect, flag cause unclear.
        """
        Input: "आज फक्त १ तास पाणी दिलं."
        Output: {"dayOutcome":"WORK_RECORDED","irrigation":[{"method":"Drip","durationHours":1,"sourceText":"१ तास पाणी दिलं"}],"observations":[{"noteType":"observation","textRaw":"फक्त १ तास पाणी दिलं — कारण सांगितले नाही","severity":"normal"}],"confidence":0.88}
        """,

        // S4-NEGATIVE (contrast): Both rain AND the irrigation reduction are
        // stated — keep as ONE linked entry, NOT split into rain-note + irrigation-row.
        // Use only existing fields: disturbance.note + irrigation.durationHours + irrigation.notes.
        """
        Input: "पाऊस आल्यामुळे आज पाणी फक्त १ तास चालू ठेवलं, नेहमीच्या ४ तासांऐवजी."
        Output: {"dayOutcome":"WORK_RECORDED","disturbance":{"scope":"PARTIAL","group":"weather","reason":"rain","severity":"MEDIUM","blockedSegments":["irrigation"],"note":"पाऊस आल्यामुळे सिंचन ४ तासांवरून १ तासावर कमी केले"},"irrigation":[{"method":"Drip","durationHours":1,"notes":"reduced from 4h due to rain","sourceText":"पाणी फक्त १ तास चालू ठेवलं"}],"confidence":0.96}
        """
    ];

    public static string BuildVocabListing()
    {
        var builder = new StringBuilder();
        foreach (var pair in MarathiVocab.OrderBy(x => x.Key, StringComparer.OrdinalIgnoreCase))
        {
            builder
                .Append("- ")
                .Append(pair.Key)
                .Append(": ")
                .AppendLine(string.Join(", ", pair.Value));
        }

        return builder.ToString().TrimEnd();
    }
}
