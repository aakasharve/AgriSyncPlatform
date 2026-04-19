using System.Text.Json;
using System.Text.Json.Serialization;

namespace AgriSync.SharedKernel.Contracts.Ids;

[JsonConverter(typeof(GrowthEventIdJsonConverter))]
public readonly record struct GrowthEventId(Guid Value)
{
    public static GrowthEventId Empty => new(Guid.Empty);

    public bool IsEmpty => Value == Guid.Empty;

    public static GrowthEventId New() => new(Guid.NewGuid());

    public static GrowthEventId Parse(string value) => new(Guid.Parse(value));

    public static bool TryParse(string? value, out GrowthEventId id)
    {
        var parsed = Guid.TryParse(value, out var guid);
        id = parsed ? new GrowthEventId(guid) : Empty;
        return parsed;
    }

    public override string ToString() => Value.ToString();

    public static implicit operator Guid(GrowthEventId id) => id.Value;
    public static implicit operator GrowthEventId(Guid value) => new(value);

    private sealed class GrowthEventIdJsonConverter : JsonConverter<GrowthEventId>
    {
        public override GrowthEventId Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType == JsonTokenType.String && Guid.TryParse(reader.GetString(), out var guid))
            {
                return new GrowthEventId(guid);
            }

            throw new JsonException("Invalid GrowthEventId value.");
        }

        public override void Write(Utf8JsonWriter writer, GrowthEventId value, JsonSerializerOptions options)
        {
            writer.WriteStringValue(value.Value);
        }
    }
}
