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
            ["petal"] = ["पाकळी", "पाकळ्या"]
        };

    public static readonly IReadOnlyList<string> WorkDoneMarkers =
    [
        "दिले", "केले", "झाले", "घातले", "टाकले", "फवारले", "वापरले", "चालवले",
        "कापले", "काढले", "पूर्ण केले", "संपले"
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
        Input: "आज कालची बाब झाली नाही अजून."
        Output: {"dayOutcome":"NO_WORK_PLANNED","unclearSegments":[{"rawText":"कालची बाब झाली नाही","reason":"unknown_vocabulary","confidence":0.4}],"confidence":0.4}
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
