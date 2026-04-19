using System.Text.Json;
using System.Text.Json.Serialization;

namespace AgriSync.SharedKernel.Contracts.Ids;

[JsonConverter(typeof(PrescribedTaskIdJsonConverter))]
public readonly record struct PrescribedTaskId(Guid Value)
{
    public static PrescribedTaskId Empty => new(Guid.Empty);

    public bool IsEmpty => Value == Guid.Empty;

    public static PrescribedTaskId New() => new(Guid.NewGuid());

    public static PrescribedTaskId Parse(string value) => new(Guid.Parse(value));

    public static bool TryParse(string? value, out PrescribedTaskId id)
    {
        var parsed = Guid.TryParse(value, out var guid);
        id = parsed ? new PrescribedTaskId(guid) : Empty;
        return parsed;
    }

    public override string ToString() => Value.ToString();

    public static implicit operator Guid(PrescribedTaskId id) => id.Value;
    public static implicit operator PrescribedTaskId(Guid value) => new(value);

    private sealed class PrescribedTaskIdJsonConverter : JsonConverter<PrescribedTaskId>
    {
        public override PrescribedTaskId Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType == JsonTokenType.String && Guid.TryParse(reader.GetString(), out var guid))
            {
                return new PrescribedTaskId(guid);
            }

            throw new JsonException("Invalid PrescribedTaskId value.");
        }

        public override void Write(Utf8JsonWriter writer, PrescribedTaskId value, JsonSerializerOptions options)
        {
            writer.WriteStringValue(value.Value);
        }
    }
}
