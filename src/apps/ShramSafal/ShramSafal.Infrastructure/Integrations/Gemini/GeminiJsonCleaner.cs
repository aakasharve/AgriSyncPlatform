using System.Text.RegularExpressions;

namespace ShramSafal.Infrastructure.Integrations.Gemini;

internal static class GeminiJsonCleaner
{
    public static string Clean(string rawText)
    {
        if (string.IsNullOrWhiteSpace(rawText))
        {
            return "{}";
        }

        var text = rawText
            .Replace("```json", string.Empty, StringComparison.OrdinalIgnoreCase)
            .Replace("```", string.Empty, StringComparison.OrdinalIgnoreCase)
            .Trim();

        var firstBrace = text.IndexOf('{');
        var lastBrace = text.LastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace)
        {
            text = text[firstBrace..(lastBrace + 1)];
        }

        text = Regex.Replace(text, @"([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:", "$1\"$2\":");
        text = Regex.Replace(text, @",\s*}", "}");
        text = Regex.Replace(text, @",\s*]", "]");

        return text;
    }
}
