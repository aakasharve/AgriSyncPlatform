using System.Text.Json;
using System.Text.Json.Serialization;

namespace AgriSync.SharedKernel.Contracts.Ids;

[JsonConverter(typeof(OwnerAccountIdJsonConverter))]
public readonly record struct OwnerAccountId(Guid Value)
{
    public static OwnerAccountId Empty => new(Guid.Empty);

    public bool IsEmpty => Value == Guid.Empty;

    public static OwnerAccountId New() => new(Guid.NewGuid());

    public static OwnerAccountId Parse(string value) => new(Guid.Parse(value));

    public static bool TryParse(string? value, out OwnerAccountId id)
    {
        var parsed = Guid.TryParse(value, out var guid);
        id = parsed ? new OwnerAccountId(guid) : Empty;
        return parsed;
    }

    public override string ToString() => Value.ToString();

    public static implicit operator Guid(OwnerAccountId id) => id.Value;
    public static implicit operator OwnerAccountId(Guid value) => new(value);

    private sealed class OwnerAccountIdJsonConverter : JsonConverter<OwnerAccountId>
    {
        public override OwnerAccountId Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType == JsonTokenType.String && Guid.TryParse(reader.GetString(), out var guid))
            {
                return new OwnerAccountId(guid);
            }

            throw new JsonException("Invalid OwnerAccountId value.");
        }

        public override void Write(Utf8JsonWriter writer, OwnerAccountId value, JsonSerializerOptions options)
        {
            writer.WriteStringValue(value.Value);
        }
    }
}
