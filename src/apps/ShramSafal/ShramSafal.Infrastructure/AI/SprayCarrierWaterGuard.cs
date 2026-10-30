using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace ShramSafal.Infrastructure.AI;

/// <summary>
/// PLR go-live (lane AI-1) — the spray's tank water is logged once. "आज इथरेल 300 मिली फवारणी केली, पाणी 400
/// लिटर वापरलं": the 400 L carried the spray. When the model puts it on the spray row (<c>carrierVolume</c> +
/// a litre <c>carrierUnit</c>, as the few-shots teach) AND also writes an irrigation row of the SAME litres with no
/// hours and no role, that irrigation row is the same water — it is tagged <c>role: "spray-carrier"</c> so no
/// screen or ledger counts it as watering. Tagged, never deleted (the provenance rule: a mechanical check never
/// destroys what the model extracted). An irrigation row with hours, a different volume, or a role already set is
/// left alone.
/// </summary>
internal static partial class SprayCarrierWaterGuard
{
    public static void Apply(JsonObject root)
    {
        if (root["inputs"] is not JsonArray inputs || root["irrigation"] is not JsonArray irrigation)
        {
            return;
        }

        var carriers = new HashSet<decimal>();
        foreach (var node in inputs)
        {
            if (node is not JsonObject input || !IsSpray(input))
            {
                continue;
            }

            var unit = ReadString(input["carrierUnit"]) is { Length: > 0 } u ? u : ReadString(input["unitCarrier"]);
            if (ReadNumber(input["carrierVolume"]) is { } litres && litres > 0 && LitreUnit().IsMatch(unit.Trim()))
            {
                carriers.Add(litres);
            }
        }

        if (carriers.Count == 0)
        {
            return;
        }

        foreach (var node in irrigation)
        {
            if (node is not JsonObject water || ReadString(water["role"]).Length > 0 ||
                ReadNumber(water["durationHours"]) is > 0)
            {
                continue;
            }

            if (ReadNumber(water["waterVolumeLitres"]) is { } litres && carriers.Contains(litres))
            {
                water["role"] = "spray-carrier";
            }
        }
    }

    private static bool IsSpray(JsonObject input) =>
        string.Equals(ReadString(input["method"]).Trim(), "Spray", StringComparison.OrdinalIgnoreCase);

    private static string ReadString(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue<string>(out var s) ? s : string.Empty;

    private static decimal? ReadNumber(JsonNode? node)
    {
        if (node is not JsonValue value)
        {
            return null;
        }

        if (value.TryGetValue<decimal>(out var m))
        {
            return m;
        }

        if (value.TryGetValue<double>(out var d))
        {
            return (decimal)d;
        }

        return value.TryGetValue<string>(out var s) &&
               decimal.TryParse(s.Trim(), NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : null;
    }

    [GeneratedRegex(@"^(?:l|lt|ltr|litres?|liters?|लिटर|लीटर)$", RegexOptions.IgnoreCase)]
    private static partial Regex LitreUnit();
}
