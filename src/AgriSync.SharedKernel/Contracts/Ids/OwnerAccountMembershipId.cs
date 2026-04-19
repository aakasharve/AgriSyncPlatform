using System.Text.Json;
using System.Text.Json.Serialization;

namespace AgriSync.SharedKernel.Contracts.Ids;

[JsonConverter(typeof(OwnerAccountMembershipIdJsonConverter))]
public readonly record struct OwnerAccountMembershipId(Guid Value)
{
    public static OwnerAccountMembershipId Empty => new(Guid.Empty);

    public bool IsEmpty => Value == Guid.Empty;

    public static OwnerAccountMembershipId New() => new(Guid.NewGuid());

    public static OwnerAccountMembershipId Parse(string value) => new(Guid.Parse(value));

    public static bool TryParse(string? value, out OwnerAccountMembershipId id)
    {
        var parsed = Guid.TryParse(value, out var guid);
        id = parsed ? new OwnerAccountMembershipId(guid) : Empty;
        return parsed;
    }

    public override string ToString() => Value.ToString();

    public static implicit operator Guid(OwnerAccountMembershipId id) => id.Value;
    public static implicit operator OwnerAccountMembershipId(Guid value) => new(value);

    private sealed class OwnerAccountMembershipIdJsonConverter : JsonConverter<OwnerAccountMembershipId>
    {
        public override OwnerAccountMembershipId Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType == JsonTokenType.String && Guid.TryParse(reader.GetString(), out var guid))
            {
                return new OwnerAccountMembershipId(guid);
            }

            throw new JsonException("Invalid OwnerAccountMembershipId value.");
        }

        public override void Write(Utf8JsonWriter writer, OwnerAccountMembershipId value, JsonSerializerOptions options)
        {
            writer.WriteStringValue(value.Value);
        }
    }
}
