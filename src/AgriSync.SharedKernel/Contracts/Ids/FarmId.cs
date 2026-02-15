using System.Text.Json;
using System.Text.Json.Serialization;

namespace AgriSync.SharedKernel.Contracts.Ids;

[JsonConverter(typeof(FarmIdJsonConverter))]
public readonly record struct FarmId(Guid Value)
{
    public static FarmId Empty => new(Guid.Empty);

    public bool IsEmpty => Value == Guid.Empty;

    public static FarmId New() => new(Guid.NewGuid());

    public static FarmId Parse(string value) => new(Guid.Parse(value));

    public static bool TryParse(string? value, out FarmId farmId)
    {
        var parsed = Guid.TryParse(value, out var guid);
        farmId = parsed ? new FarmId(guid) : Empty;
        return parsed;
    }

    public override string ToString() => Value.ToString();

    public static implicit operator Guid(FarmId id) => id.Value;
    public static implicit operator FarmId(Guid value) => new(value);

    private sealed class FarmIdJsonConverter : JsonConverter<FarmId>
    {
        public override FarmId Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType == JsonTokenType.String && Guid.TryParse(reader.GetString(), out var guid))
            {
                return new FarmId(guid);
            }

            throw new JsonException("Invalid FarmId value.");
        }

        public override void Write(Utf8JsonWriter writer, FarmId value, JsonSerializerOptions options)
        {
            writer.WriteStringValue(value.Value);
        }
    }
}
