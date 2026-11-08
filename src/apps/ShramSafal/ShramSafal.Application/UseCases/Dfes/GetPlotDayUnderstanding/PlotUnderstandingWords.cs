using ShramSafal.Domain.Inputs;

namespace ShramSafal.Application.UseCases.Dfes.GetPlotDayUnderstanding;

/// <summary>
/// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT3, Task 2) - the fixed words of the per-plot read, one line per part of
/// the day the app can understand. Marathi has no Latin letters, English has no Devanagari; no number, no emoji, no "AI". The
/// part names are the roster's dimension names (<c>DfesLensExtractor</c>); a part with no words here is left out of the answer.
/// </summary>
public static class PlotUnderstandingWords
{
    private static readonly IReadOnlyDictionary<string, LocalizedText> UnderstoodLines = new Dictionary<string, LocalizedText>(StringComparer.Ordinal)
    {
        ["WHAT"] = new("आज काय काम केलं ते समजलं", "What work was done is understood"),
        ["DOSE"] = new("किती मात्रा वापरली ते समजलं", "How much was used is understood"),
        ["CARRIER"] = new("किती पाणी वापरलं ते समजलं", "How much water was used is understood"),
        ["COST"] = new("किती खर्च झाला ते समजलं", "What it cost is understood"),
        ["WEATHER"] = new("हवामान समजलं", "The weather is understood"),
        ["OBS_FACET"] = new("शेतात काय दिसलं ते समजलं", "What was seen in the field is understood"),
        ["PRODUCT_ID"] = new("कोणतं औषध वापरलं ते समजलं", "Which product was used is understood"),
    };

    private static readonly IReadOnlyDictionary<string, LocalizedText> HintLines = new Dictionary<string, LocalizedText>(StringComparer.Ordinal)
    {
        ["WHAT"] = new("आज काय काम केलं ते सांगा", "Tell what work was done"),
        ["DOSE"] = new("किती मात्रा वापरली ते सांगा", "Tell how much was used"),
        ["CARRIER"] = new("किती पाणी वापरलं ते सांगा", "Tell how much water was used"),
        ["COST"] = new("किती खर्च झाला ते सांगा", "Tell what it cost"),
        ["WEATHER"] = new("हवामान कसं होतं ते सांगा", "Tell what the weather was like"),
        ["OBS_FACET"] = new("शेतात काय दिसलं ते सांगा", "Tell what was seen in the field"),
        ["PRODUCT_ID"] = new("कोणतं औषध वापरलं ते नक्की सांगा", "Tell exactly which product was used"),
    };

    /// <summary>The line for a fully understood part, or <c>null</c> when this part has no words.</summary>
    public static LocalizedText? Understood(string dimension) => UnderstoodLines.GetValueOrDefault(dimension);

    /// <summary>The line telling him what to say for a missing part, or <c>null</c> when this part has no words.</summary>
    public static LocalizedText? Hint(string dimension) => HintLines.GetValueOrDefault(dimension);

    /// <summary>Every part that has words (for the tests that read the whole set).</summary>
    public static IReadOnlyCollection<string> Dimensions => UnderstoodLines.Keys.ToList();
}
