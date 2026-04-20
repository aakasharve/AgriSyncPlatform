using AgriSync.BuildingBlocks.Results;

namespace ShramSafal.Application.UseCases.ReferenceData.GetDeviationReasonCodes;

public sealed class GetDeviationReasonCodesHandler
{
    private static readonly IReadOnlyList<DeviationReasonCode> Codes = new List<DeviationReasonCode>
    {
        new("weather.rain",          "Rain",                    "बाद पाऊस"),
        new("weather.wind",          "Wind",                    "जोराचा वारा"),
        new("input.unavailable",     "Input not available",     "साहित्य नव्हतं"),
        new("labour.absent",         "Labour absent",           "मजूर नव्हते"),
        new("instruction.changed",   "Instruction changed",     "सूचना बदलली"),
        new("plant.stage.delayed",   "Plant stage not reached", "पीक अवस्था आली नाही"),
        new("operator.other",        "Other",                   "इतर"),
    }.AsReadOnly();

    public Task<Result<IReadOnlyList<DeviationReasonCode>>> HandleAsync(CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(Result.Success<IReadOnlyList<DeviationReasonCode>>(Codes));
    }

    // Public static for validation use in AddLogTaskHandler
    public static bool IsValidCode(string code) =>
        Codes.Any(c => string.Equals(c.Code, code, StringComparison.OrdinalIgnoreCase));
}
