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
