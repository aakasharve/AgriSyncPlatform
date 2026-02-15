using System.Text.Json;
using System.Text.Json.Serialization;

namespace AgriSync.SharedKernel.Contracts.Ids;

[JsonConverter(typeof(AppIdJsonConverter))]
public readonly record struct AppId(string Value)
{
    public static AppId Empty => new(string.Empty);

    public bool IsEmpty => string.IsNullOrWhiteSpace(Value);

    public static AppId Parse(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ArgumentException("AppId is required.", nameof(value));
        }

        return new AppId(value.Trim().ToLowerInvariant());
    }

    public static bool TryParse(string? value, out AppId appId)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            appId = Empty;
            return false;
        }

        appId = Parse(value);
        return true;
    }

    public override string ToString() => Value;

    public static implicit operator string(AppId id) => id.Value;
    public static implicit operator AppId(string value) => new(value);

    private sealed class AppIdJsonConverter : JsonConverter<AppId>
    {
        public override AppId Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType == JsonTokenType.String)
            {
                return Parse(reader.GetString() ?? string.Empty);
            }

            throw new JsonException("Invalid AppId value.");
        }

        public override void Write(Utf8JsonWriter writer, AppId value, JsonSerializerOptions options)
        {
            writer.WriteStringValue(value.Value);
        }
    }
}
