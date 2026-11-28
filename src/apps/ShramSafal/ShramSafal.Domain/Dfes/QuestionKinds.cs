namespace ShramSafal.Domain.Dfes;

/// <summary>
/// Lane DFES-Q (founder D-B, 2026-11-21) — what KIND of question a key is, decided by the SERVER. A phone's claim about its own
/// question never decides whether a source is needed: the key does.
///
/// <para>A question that <b>states agronomy</b> (what to look for at this stage, a threshold, spray or weather advice) is recorded
/// only with a source resolved from Shram Safal's own published schedule. Questions that state no agronomy (fill a missing detail,
/// confirm the stage, follow up an observation, ask why his own schedule's task was not done, learning) need none.</para>
///
/// <para><b>Fail closed:</b> a key this table does not know is treated as stating agronomy, so a new question cannot slip past the
/// source gate by being new. Every key a phone in the field sends (including the retired gap keys of older APKs) is listed or
/// covered by a prefix rule below, so old phones are unaffected (P11).</para>
/// </summary>
public static class QuestionKinds
{
    public const string Gap = "gap";
    public const string StageConfirm = "stage_confirm";
    public const string StageOpen = "stage_open";
    public const string StageLook = "stage_look";
    public const string WhyNot = "why_not";
    public const string Followup = "followup";
    public const string Learning = "learning";
    public const string WeatherCheckIn = "weather_check_in";
    public const string Safety = "safety";
    public const string Weather = "weather";
    public const string Unknown = "unknown";

    /// <summary>Part 03 B4 - "what was this product for?" about one product of one saved record. It asks him a fact of his own
    /// work and states no agronomy, so it needs no source (<see cref="Inputs.ProductPurpose"/>).</summary>
    public const string ProductPurpose = "product_purpose";

    private static readonly HashSet<string> AgronomyKinds = new(StringComparer.Ordinal)
    {
        StageLook, Safety, Weather, Unknown,
    };

    /// <summary>The kind of the question with this bank key.</summary>
    public static string ForKey(string? questionKey)
    {
        var key = (questionKey ?? string.Empty).Trim();
        return key switch
        {
            "stage.look" => StageLook,
            "stage.open" => StageOpen,
            "stage.confirm_current" => StageConfirm,
            "weather.severe_care_check" => WeatherCheckIn,
            "weather.rain_before_spray" => Weather,
            _ when key.StartsWith("gap.", StringComparison.Ordinal) => Gap,
            _ when key.StartsWith("followup.", StringComparison.Ordinal) => Followup,
            _ when key.StartsWith("learning.", StringComparison.Ordinal) => Learning,
            _ when key.StartsWith("schedule.", StringComparison.Ordinal) => WhyNot,
            _ when key.StartsWith("safety.", StringComparison.Ordinal) => Safety,
            _ when Inputs.ProductPurpose.IsThisQuestion(key) => ProductPurpose,
            _ => Unknown,
        };
    }

    /// <summary>Does a question of this kind state agronomy, so that it needs a resolved source?</summary>
    public static bool StatesAgronomy(string kind) => AgronomyKinds.Contains(kind);
}
