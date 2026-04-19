using System.Text.Json;
using System.Text.Json.Serialization;

namespace AgriSync.SharedKernel.Contracts.Ids;

[JsonConverter(typeof(BenefitRedemptionIdJsonConverter))]
public readonly record struct BenefitRedemptionId(Guid Value)
{
    public static BenefitRedemptionId Empty => new(Guid.Empty);

    public bool IsEmpty => Value == Guid.Empty;

    public static BenefitRedemptionId New() => new(Guid.NewGuid());

    public static BenefitRedemptionId Parse(string value) => new(Guid.Parse(value));

    public static bool TryParse(string? value, out BenefitRedemptionId id)
    {
        var parsed = Guid.TryParse(value, out var guid);
        id = parsed ? new BenefitRedemptionId(guid) : Empty;
        return parsed;
    }

    public override string ToString() => Value.ToString();

    public static implicit operator Guid(BenefitRedemptionId id) => id.Value;
    public static implicit operator BenefitRedemptionId(Guid value) => new(value);

    private sealed class BenefitRedemptionIdJsonConverter : JsonConverter<BenefitRedemptionId>
    {
        public override BenefitRedemptionId Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType == JsonTokenType.String && Guid.TryParse(reader.GetString(), out var guid))
            {
                return new BenefitRedemptionId(guid);
            }

            throw new JsonException("Invalid BenefitRedemptionId value.");
        }

        public override void Write(Utf8JsonWriter writer, BenefitRedemptionId value, JsonSerializerOptions options)
        {
            writer.WriteStringValue(value.Value);
        }
    }
}
