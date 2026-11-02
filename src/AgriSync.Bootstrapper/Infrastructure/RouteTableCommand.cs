// spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 fix pass 2 (review N-3).
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Routing;

namespace AgriSync.Bootstrapper.Infrastructure;

/// <summary>
/// <c>--list-routes &lt;file&gt;</c>: write every route the host serves ("METHOD /path", one per line, sorted), then exit
/// without serving. Read from the BUILT host's own endpoint data sources, after Program.cs has mapped everything — so a
/// mapping added to or removed from Program.cs moves the list by itself (there is no hand copy of the mapping calls).
///
/// <para>Same shape as <c>--list-migrations</c>: it returns before <c>app.Run()</c>, so no hosted service starts, no port
/// is bound and no database is opened. The phone's path test reads the table this writes
/// (<c>sync-contract/routes/server-rest-routes.txt</c>, kept equal by <c>ServerRouteTableTests</c>).</para>
/// </summary>
public static class RouteTableCommand
{
    public const string Flag = "--list-routes";

    /// <summary>A route with no method metadata answers every method.</summary>
    public const string AnyMethod = "*";

    public static IReadOnlyList<string> Routes(IEndpointRouteBuilder app) =>
        app.DataSources
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .SelectMany(endpoint =>
                (endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods is { Count: > 0 } methods
                    ? methods
                    : [AnyMethod])
                .Select(method => $"{method} /{(endpoint.RoutePattern.RawText ?? string.Empty).TrimStart('/')}"))
            .Distinct()
            .OrderBy(route => route, StringComparer.Ordinal)
            .ToList();

    /// <summary>Writes the table to the file named after the flag (or to <paramref name="stdout"/>); returns the exit code.</summary>
    public static int Write(WebApplication app, string[] args, TextWriter stdout)
    {
        var routes = Routes(app);
        var at = Array.IndexOf(args, Flag);
        var file = at >= 0 && at + 1 < args.Length && !args[at + 1].StartsWith("--", StringComparison.Ordinal)
            ? args[at + 1]
            : null;
        var text = string.Join('\n', routes) + "\n";
        if (file is null)
        {
            stdout.Write(text);
        }
        else
        {
            File.WriteAllText(file, text);
        }

        return 0;
    }
}
