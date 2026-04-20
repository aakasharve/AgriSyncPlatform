using System.Text.Json;
using System.Text.Json.Serialization;

namespace AgriSync.SharedKernel.Contracts.Ids;

[JsonConverter(typeof(FarmInvitationIdJsonConverter))]
public readonly record struct FarmInvitationId(Guid Value)
{
    public static FarmInvitationId Empty => new(Guid.Empty);

    public bool IsEmpty => Value == Guid.Empty;

    public static FarmInvitationId New() => new(Guid.NewGuid());

    public static FarmInvitationId Parse(string value) => new(Guid.Parse(value));

    public static bool TryParse(string? value, out FarmInvitationId id)
    {
        var parsed = Guid.TryParse(value, out var guid);
        id = parsed ? new FarmInvitationId(guid) : Empty;
        return parsed;
    }

    public override string ToString() => Value.ToString();

    public static implicit operator Guid(FarmInvitationId id) => id.Value;
    public static implicit operator FarmInvitationId(Guid value) => new(value);

    private sealed class FarmInvitationIdJsonConverter : JsonConverter<FarmInvitationId>
    {
        public override FarmInvitationId Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType == JsonTokenType.String && Guid.TryParse(reader.GetString(), out var guid))
            {
                return new FarmInvitationId(guid);
            }

            throw new JsonException("Invalid FarmInvitationId value.");
        }

        public override void Write(Utf8JsonWriter writer, FarmInvitationId value, JsonSerializerOptions options)
        {
            writer.WriteStringValue(value.Value);
        }
    }
}
