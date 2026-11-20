// spec: plr-d10-redesign-real-integration-2026-10-25 - walk finding 2026-11-20 (phone conditional GETs blocked by CORS)
using System.Text.RegularExpressions;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// Every custom request header the phone code sets must be in the server's CORS allow-list (<c>AllowFrontend</c> in
/// <c>Program.cs</c>). A header that is missing makes the browser (and the Android WebView) refuse the request in
/// preflight - quietly: the app starts, the call never leaves the phone. That is how <c>If-None-Match</c> on the input
/// library and the schedule pictures went unnoticed: the first download works (nothing held yet, no header), every later
/// refresh is blocked. This rule reads the phone's source for the header names it sets and checks each against the list.
/// </summary>
public sealed class FrontendCorsHeaderRules
{
    // Headers a browser sends without asking (CORS-safelisted request headers) need no entry.
    private static readonly string[] Safelisted = ["accept", "accept-language", "content-language", "content-type"];

    private static readonly Regex HeaderSet = new(
        @"(?:headers\[\s*['""]|setRequestHeader\(\s*['""]|headers\.set\(\s*['""])([A-Za-z][A-Za-z0-9-]*)['""]|['""](X-[A-Za-z0-9-]+)['""]\s*:",
        RegexOptions.Compiled);

    [Fact]
    public void Every_header_the_phone_sets_is_allowed_by_the_server_cors_policy()
    {
        var root = TestPathHelper.GetSolutionRoot();
        var program = File.ReadAllText(Path.Combine(root, "AgriSync.Bootstrapper", "Program.cs"));

        var start = program.IndexOf(".WithHeaders(", StringComparison.Ordinal);
        Assert.True(start >= 0, "Program.cs must configure the AllowFrontend policy with .WithHeaders(...).");
        var end = program.IndexOf(".WithMethods(", start, StringComparison.Ordinal);
        Assert.True(end > start, "Program.cs: .WithMethods(...) must follow .WithHeaders(...).");
        var allowed = Regex.Matches(program[start..end], "\"([A-Za-z][A-Za-z0-9-]*)\"")
            .Select(m => m.Groups[1].Value.ToLowerInvariant())
            .ToHashSet();
        Assert.Contains("authorization", allowed);

        var phoneSource = Path.Combine(root, "clients", "mobile-web", "src");
        Assert.True(Directory.Exists(phoneSource), $"Phone source not found at {phoneSource}.");

        var missing = new SortedSet<string>();
        foreach (var file in Directory.EnumerateFiles(phoneSource, "*.*", SearchOption.AllDirectories)
                     .Where(f => (f.EndsWith(".ts", StringComparison.Ordinal) || f.EndsWith(".tsx", StringComparison.Ordinal))
                                 && !f.Contains("__tests__") && !f.Contains(".test.") && !f.Contains(".spec.")))
        {
            foreach (Match m in HeaderSet.Matches(File.ReadAllText(file)))
            {
                var name = (m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Value).ToLowerInvariant();
                if (!Safelisted.Contains(name) && !allowed.Contains(name))
                {
                    missing.Add(name);
                }
            }
        }

        Assert.True(
            missing.Count == 0,
            "The phone sets request headers that the server's CORS allow-list (Program.cs, AllowFrontend .WithHeaders) does not list: "
            + string.Join(", ", missing) + ". A browser or WebView refuses such a request in preflight.");
    }
}
