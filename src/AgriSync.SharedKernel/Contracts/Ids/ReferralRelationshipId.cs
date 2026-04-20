using System.Text.Json;
using System.Text.Json.Serialization;

namespace AgriSync.SharedKernel.Contracts.Ids;

[JsonConverter(typeof(ReferralRelationshipIdJsonConverter))]
public readonly record struct ReferralRelationshipId(Guid Value)
{
    public static ReferralRelationshipId Empty => new(Guid.Empty);

    public bool IsEmpty => Value == Guid.Empty;

    public static ReferralRelationshipId New() => new(Guid.NewGuid());

    public static ReferralRelationshipId Parse(string value) => new(Guid.Parse(value));

    public static bool TryParse(string? value, out ReferralRelationshipId id)
    {
        var parsed = Guid.TryParse(value, out var guid);
        id = parsed ? new ReferralRelationshipId(guid) : Empty;
        return parsed;
    }

    public override string ToString() => Value.ToString();

    public static implicit operator Guid(ReferralRelationshipId id) => id.Value;
    public static implicit operator ReferralRelationshipId(Guid value) => new(value);

    private sealed class ReferralRelationshipIdJsonConverter : JsonConverter<ReferralRelationshipId>
    {
        public override ReferralRelationshipId Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType == JsonTokenType.String && Guid.TryParse(reader.GetString(), out var guid))
            {
                return new ReferralRelationshipId(guid);
            }

            throw new JsonException("Invalid ReferralRelationshipId value.");
        }

        public override void Write(Utf8JsonWriter writer, ReferralRelationshipId value, JsonSerializerOptions options)
        {
            writer.WriteStringValue(value.Value);
        }
    }
}
