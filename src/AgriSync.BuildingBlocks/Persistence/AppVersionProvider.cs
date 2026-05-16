// spec: data-principle-spine-2026-05-05/03.5
using System.Reflection;

namespace AgriSync.BuildingBlocks.Persistence;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 03 sub-phase 03.5 — minimal helper that
/// exposes the entry-assembly's informational version string for use in
/// audit payloads (e.g. <see cref="IAdminDbContextFactory{TContext}"/>'s
/// <c>open</c> audit row).
///
/// <para>
/// <b>Resolution order:</b>
/// <list type="number">
/// <item><see cref="Assembly.GetEntryAssembly"/> informational version
/// (mirrors the <c>/version</c> endpoint in <c>Program.cs</c>).</item>
/// <item>Entry assembly file version.</item>
/// <item>The string literal <c>"unknown"</c> as last-resort fallback so
/// audit writes never throw on missing metadata.</item>
/// </list>
/// </para>
///
/// <para>
/// Lives in <c>BuildingBlocks/Persistence</c> rather than
/// <c>BuildingBlocks/Abstractions</c> because its only caller today is
/// the persistence-tier admin factory. Hoist up to Abstractions if a
/// non-persistence caller appears.
/// </para>
/// </summary>
public static class AppVersionProvider
{
    private static readonly Lazy<string> CurrentLazy = new(ResolveCurrent);

    public static string Current => CurrentLazy.Value;

    private static string ResolveCurrent()
    {
        var entry = Assembly.GetEntryAssembly();
        if (entry is not null)
        {
            var info = entry.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
            if (!string.IsNullOrWhiteSpace(info))
            {
                return info!.Trim();
            }

            var file = entry.GetName().Version?.ToString();
            if (!string.IsNullOrWhiteSpace(file))
            {
                return file!;
            }
        }

        return "unknown";
    }
}
