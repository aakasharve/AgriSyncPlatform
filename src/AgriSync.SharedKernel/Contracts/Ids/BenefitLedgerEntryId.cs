using System.Text.Json;
using System.Text.Json.Serialization;

namespace AgriSync.SharedKernel.Contracts.Ids;

[JsonConverter(typeof(BenefitLedgerEntryIdJsonConverter))]
public readonly record struct BenefitLedgerEntryId(Guid Value)
{
    public static BenefitLedgerEntryId Empty => new(Guid.Empty);

    public bool IsEmpty => Value == Guid.Empty;

    public static BenefitLedgerEntryId New() => new(Guid.NewGuid());

    public static BenefitLedgerEntryId Parse(string value) => new(Guid.Parse(value));

    public static bool TryParse(string? value, out BenefitLedgerEntryId id)
    {
        var parsed = Guid.TryParse(value, out var guid);
        id = parsed ? new BenefitLedgerEntryId(guid) : Empty;
        return parsed;
    }

    public override string ToString() => Value.ToString();

    public static implicit operator Guid(BenefitLedgerEntryId id) => id.Value;
    public static implicit operator BenefitLedgerEntryId(Guid value) => new(value);

    private sealed class BenefitLedgerEntryIdJsonConverter : JsonConverter<BenefitLedgerEntryId>
    {
        public override BenefitLedgerEntryId Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType == JsonTokenType.String && Guid.TryParse(reader.GetString(), out var guid))
            {
                return new BenefitLedgerEntryId(guid);
            }

            throw new JsonException("Invalid BenefitLedgerEntryId value.");
        }

        public override void Write(Utf8JsonWriter writer, BenefitLedgerEntryId value, JsonSerializerOptions options)
        {
            writer.WriteStringValue(value.Value);
        }
    }
}
