using System.Text.Json;
using System.Text.Json.Serialization;

namespace AgriSync.SharedKernel.Contracts.Ids;

[JsonConverter(typeof(UserIdJsonConverter))]
public readonly record struct UserId(Guid Value)
{
    public static UserId Empty => new(Guid.Empty);

    public bool IsEmpty => Value == Guid.Empty;

    public static UserId New() => new(Guid.NewGuid());

    public static UserId Parse(string value) => new(Guid.Parse(value));

    public static bool TryParse(string? value, out UserId userId)
    {
        var parsed = Guid.TryParse(value, out var guid);
        userId = parsed ? new UserId(guid) : Empty;
        return parsed;
    }

    public override string ToString() => Value.ToString();

    public static implicit operator Guid(UserId id) => id.Value;
    public static implicit operator UserId(Guid value) => new(value);

    private sealed class UserIdJsonConverter : JsonConverter<UserId>
    {
        public override UserId Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType == JsonTokenType.String && Guid.TryParse(reader.GetString(), out var guid))
            {
                return new UserId(guid);
            }

            throw new JsonException("Invalid UserId value.");
        }

        public override void Write(Utf8JsonWriter writer, UserId value, JsonSerializerOptions options)
        {
            writer.WriteStringValue(value.Value);
        }
    }
}
