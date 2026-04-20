using System.Text.Json;
using System.Text.Json.Serialization;

namespace AgriSync.SharedKernel.Contracts.Ids;

[JsonConverter(typeof(SubscriptionIdJsonConverter))]
public readonly record struct SubscriptionId(Guid Value)
{
    public static SubscriptionId Empty => new(Guid.Empty);

    public bool IsEmpty => Value == Guid.Empty;

    public static SubscriptionId New() => new(Guid.NewGuid());

    public static SubscriptionId Parse(string value) => new(Guid.Parse(value));

    public static bool TryParse(string? value, out SubscriptionId id)
    {
        var parsed = Guid.TryParse(value, out var guid);
        id = parsed ? new SubscriptionId(guid) : Empty;
        return parsed;
    }

    public override string ToString() => Value.ToString();

    public static implicit operator Guid(SubscriptionId id) => id.Value;
    public static implicit operator SubscriptionId(Guid value) => new(value);

    private sealed class SubscriptionIdJsonConverter : JsonConverter<SubscriptionId>
    {
        public override SubscriptionId Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType == JsonTokenType.String && Guid.TryParse(reader.GetString(), out var guid))
            {
                return new SubscriptionId(guid);
            }

            throw new JsonException("Invalid SubscriptionId value.");
        }

        public override void Write(Utf8JsonWriter writer, SubscriptionId value, JsonSerializerOptions options)
        {
            writer.WriteStringValue(value.Value);
        }
    }
}
