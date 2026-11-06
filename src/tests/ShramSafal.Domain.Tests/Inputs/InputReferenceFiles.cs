// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1)
using System.Text.Json;

namespace ShramSafal.Domain.Tests.Inputs;

/// <summary>
/// The shared case files live ONCE in <c>sync-contract/reference/inputs/</c>; the phone's vitest
/// suite reads the same files, so both sides are held to identical answers. Found by walking up
/// from the test's base directory until a folder holding <c>sync-contract</c> appears.
/// </summary>
internal static class InputReferenceFiles
{
    public static string Path(string fileName)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = System.IO.Path.Combine(dir.FullName, "sync-contract", "reference", "inputs", fileName);
            if (File.Exists(candidate))
            {
                return candidate;
            }

            dir = dir.Parent;
        }

        throw new FileNotFoundException(
            $"sync-contract/reference/inputs/{fileName} not found above {AppContext.BaseDirectory}");
    }

    public static JsonElement Read(string fileName)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(Path(fileName)));
        return doc.RootElement.Clone();
    }
}
