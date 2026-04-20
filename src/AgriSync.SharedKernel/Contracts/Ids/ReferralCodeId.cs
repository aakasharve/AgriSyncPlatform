using System.Text.Json;
using System.Text.Json.Serialization;

namespace AgriSync.SharedKernel.Contracts.Ids;

[JsonConverter(typeof(ReferralCodeIdJsonConverter))]
public readonly record struct ReferralCodeId(Guid Value)
{
    public static ReferralCodeId Empty => new(Guid.Empty);

    public bool IsEmpty => Value == Guid.Empty;

    public static ReferralCodeId New() => new(Guid.NewGuid());

    public static ReferralCodeId Parse(string value) => new(Guid.Parse(value));

    public static bool TryParse(string? value, out ReferralCodeId id)
    {
        var parsed = Guid.TryParse(value, out var guid);
        id = parsed ? new ReferralCodeId(guid) : Empty;
        return parsed;
    }

    public override string ToString() => Value.ToString();

    public static implicit operator Guid(ReferralCodeId id) => id.Value;
    public static implicit operator ReferralCodeId(Guid value) => new(value);

    private sealed class ReferralCodeIdJsonConverter : JsonConverter<ReferralCodeId>
    {
        public override ReferralCodeId Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType == JsonTokenType.String && Guid.TryParse(reader.GetString(), out var guid))
            {
                return new ReferralCodeId(guid);
            }

            throw new JsonException("Invalid ReferralCodeId value.");
        }

        public override void Write(Utf8JsonWriter writer, ReferralCodeId value, JsonSerializerOptions options)
        {
            writer.WriteStringValue(value.Value);
        }
    }
}
