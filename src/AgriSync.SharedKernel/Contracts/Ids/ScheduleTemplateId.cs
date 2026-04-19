using System.Text.Json;
using System.Text.Json.Serialization;

namespace AgriSync.SharedKernel.Contracts.Ids;

[JsonConverter(typeof(ScheduleTemplateIdJsonConverter))]
public readonly record struct ScheduleTemplateId(Guid Value)
{
    public static ScheduleTemplateId Empty => new(Guid.Empty);

    public bool IsEmpty => Value == Guid.Empty;

    public static ScheduleTemplateId New() => new(Guid.NewGuid());

    public static ScheduleTemplateId Parse(string value) => new(Guid.Parse(value));

    public static bool TryParse(string? value, out ScheduleTemplateId id)
    {
        var parsed = Guid.TryParse(value, out var guid);
        id = parsed ? new ScheduleTemplateId(guid) : Empty;
        return parsed;
    }

    public override string ToString() => Value.ToString();

    public static implicit operator Guid(ScheduleTemplateId id) => id.Value;
    public static implicit operator ScheduleTemplateId(Guid value) => new(value);

    private sealed class ScheduleTemplateIdJsonConverter : JsonConverter<ScheduleTemplateId>
    {
        public override ScheduleTemplateId Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType == JsonTokenType.String && Guid.TryParse(reader.GetString(), out var guid))
            {
                return new ScheduleTemplateId(guid);
            }

            throw new JsonException("Invalid ScheduleTemplateId value.");
        }

        public override void Write(Utf8JsonWriter writer, ScheduleTemplateId value, JsonSerializerOptions options)
        {
            writer.WriteStringValue(value.Value);
        }
    }
}
