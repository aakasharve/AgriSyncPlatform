namespace ShramSafal.Application.Abstractions.Sync;

/// <summary>
/// Production default: never forces push failures.
/// Registered by <c>DependencyInjection.AddShramSafalApi</c> as the default
/// <see cref="IE2eFailPushesProbe"/> implementation.
/// </summary>
public sealed class NoOpFailPushesProbe : IE2eFailPushesProbe
{
    /// <summary>Shared singleton — stateless, safe to re-use.</summary>
    public static readonly NoOpFailPushesProbe Instance = new();

    /// <inheritdoc/>
    public string? FailReason => null;
}
