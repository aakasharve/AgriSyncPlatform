using System.Text.Json;
using System.Text.Json.Serialization;

namespace AgriSync.SharedKernel.Contracts.Ids;

[JsonConverter(typeof(AffiliationProfileIdJsonConverter))]
public readonly record struct AffiliationProfileId(Guid Value)
{
    public static AffiliationProfileId Empty => new(Guid.Empty);

    public bool IsEmpty => Value == Guid.Empty;

    public static AffiliationProfileId New() => new(Guid.NewGuid());

    public static AffiliationProfileId Parse(string value) => new(Guid.Parse(value));

    public static bool TryParse(string? value, out AffiliationProfileId id)
    {
        var parsed = Guid.TryParse(value, out var guid);
        id = parsed ? new AffiliationProfileId(guid) : Empty;
        return parsed;
    }

    public override string ToString() => Value.ToString();

    public static implicit operator Guid(AffiliationProfileId id) => id.Value;
    public static implicit operator AffiliationProfileId(Guid value) => new(value);

    private sealed class AffiliationProfileIdJsonConverter : JsonConverter<AffiliationProfileId>
    {
        public override AffiliationProfileId Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType == JsonTokenType.String && Guid.TryParse(reader.GetString(), out var guid))
            {
                return new AffiliationProfileId(guid);
            }

            throw new JsonException("Invalid AffiliationProfileId value.");
        }

        public override void Write(Utf8JsonWriter writer, AffiliationProfileId value, JsonSerializerOptions options)
        {
            writer.WriteStringValue(value.Value);
        }
    }
}
