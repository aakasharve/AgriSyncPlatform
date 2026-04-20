using System.Text.Json;
using System.Text.Json.Serialization;

namespace AgriSync.SharedKernel.Contracts.Ids;

[JsonConverter(typeof(FarmJoinTokenIdJsonConverter))]
public readonly record struct FarmJoinTokenId(Guid Value)
{
    public static FarmJoinTokenId Empty => new(Guid.Empty);

    public bool IsEmpty => Value == Guid.Empty;

    public static FarmJoinTokenId New() => new(Guid.NewGuid());

    public static FarmJoinTokenId Parse(string value) => new(Guid.Parse(value));

    public static bool TryParse(string? value, out FarmJoinTokenId id)
    {
        var parsed = Guid.TryParse(value, out var guid);
        id = parsed ? new FarmJoinTokenId(guid) : Empty;
        return parsed;
    }

    public override string ToString() => Value.ToString();

    public static implicit operator Guid(FarmJoinTokenId id) => id.Value;
    public static implicit operator FarmJoinTokenId(Guid value) => new(value);

    private sealed class FarmJoinTokenIdJsonConverter : JsonConverter<FarmJoinTokenId>
    {
        public override FarmJoinTokenId Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType == JsonTokenType.String && Guid.TryParse(reader.GetString(), out var guid))
            {
                return new FarmJoinTokenId(guid);
            }

            throw new JsonException("Invalid FarmJoinTokenId value.");
        }

        public override void Write(Utf8JsonWriter writer, FarmJoinTokenId value, JsonSerializerOptions options)
        {
            writer.WriteStringValue(value.Value);
        }
    }
}
