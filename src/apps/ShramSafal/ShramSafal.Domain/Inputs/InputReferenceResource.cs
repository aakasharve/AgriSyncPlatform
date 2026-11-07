// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1, Task 1)
using System.Text.Json;

namespace ShramSafal.Domain.Inputs;

/// <summary>
/// Reads the input reference data this assembly embeds (<c>Inputs/Generated/*.json</c>, copied
/// byte-for-byte from <c>sync-contract/reference/inputs/</c> by <c>generate.mjs</c>). The only IO the
/// Domain does here is reading its own embedded resource.
/// </summary>
internal static class InputReferenceResource
{
    internal static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    internal static byte[] ReadBytes(string fileName)
    {
        var assembly = typeof(InputReferenceResource).Assembly;
        var suffix = ".Inputs.Generated." + fileName;
        var name = assembly.GetManifestResourceNames()
            .SingleOrDefault(n => n.EndsWith(suffix, StringComparison.Ordinal))
            ?? throw new InvalidOperationException($"Embedded resource '*{suffix}' is missing; run `cd sync-contract && npm run generate`.");

        using var stream = assembly.GetManifestResourceStream(name)!;
        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        return buffer.ToArray();
    }

    internal static T Read<T>(string fileName) =>
        JsonSerializer.Deserialize<T>(ReadBytes(fileName), JsonOptions)
        ?? throw new InvalidOperationException($"Embedded resource '{fileName}' is empty.");
}
