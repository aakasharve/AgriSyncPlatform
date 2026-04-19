using System.Text.Json;
using System.Text.Json.Serialization;

namespace AgriSync.SharedKernel.Contracts.Ids;

[JsonConverter(typeof(ScheduleSubscriptionIdJsonConverter))]
public readonly record struct ScheduleSubscriptionId(Guid Value)
{
    public static ScheduleSubscriptionId Empty => new(Guid.Empty);

    public bool IsEmpty => Value == Guid.Empty;

    public static ScheduleSubscriptionId New() => new(Guid.NewGuid());

    public static ScheduleSubscriptionId Parse(string value) => new(Guid.Parse(value));

    public static bool TryParse(string? value, out ScheduleSubscriptionId id)
    {
        var parsed = Guid.TryParse(value, out var guid);
        id = parsed ? new ScheduleSubscriptionId(guid) : Empty;
        return parsed;
    }

    public override string ToString() => Value.ToString();

    public static implicit operator Guid(ScheduleSubscriptionId id) => id.Value;
    public static implicit operator ScheduleSubscriptionId(Guid value) => new(value);

    private sealed class ScheduleSubscriptionIdJsonConverter : JsonConverter<ScheduleSubscriptionId>
    {
        public override ScheduleSubscriptionId Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType == JsonTokenType.String && Guid.TryParse(reader.GetString(), out var guid))
            {
                return new ScheduleSubscriptionId(guid);
            }

            throw new JsonException("Invalid ScheduleSubscriptionId value.");
        }

        public override void Write(Utf8JsonWriter writer, ScheduleSubscriptionId value, JsonSerializerOptions options)
        {
            writer.WriteStringValue(value.Value);
        }
    }
}
