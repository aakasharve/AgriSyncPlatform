namespace AgriSync.BuildingBlocks.Results;

/// <summary>
/// Sub-plan 03 Task 10: observable partial-failure envelope. A handler
/// that wants to keep returning a partial payload (rather than fail
/// the whole call) wraps its result in <see cref="DegradedState{T}"/>
/// and lists the failed components.
///
/// <para>
/// Endpoint adapters serialize <see cref="DegradedState{T}.PartialValue"/>
/// as the response body and add an <c>X-Degraded</c> response header
/// listing the component names so callers (mobile-web, admin-web) can
/// render a "partial data" badge / banner.
/// </para>
///
/// <para>
/// This is the proper alternative to bare <c>catch { }</c> blocks that
/// returned empty arrays / null DTOs without telling the caller that
/// part of the response was missing. Sub-plan 03 §5 ("No swallowed
/// errors") requires every catch in the application layer to either
/// re-throw, return <see cref="Result.Failure"/>, or surface as a
/// <c>DegradedState</c>.
/// </para>
/// </summary>
public sealed record DegradedState<T>(
    T PartialValue,
    IReadOnlyList<DegradedComponent> Degraded)
{
    /// <summary>Convenience accessor — true when at least one component degraded.</summary>
    public bool IsDegraded => Degraded.Count > 0;

    /// <summary>Build a fully-healthy envelope (no degraded components).</summary>
    public static DegradedState<T> Healthy(T value) => new(value, Array.Empty<DegradedComponent>());
}

/// <summary>
/// One entry in <see cref="DegradedState{T}.Degraded"/>. <see cref="ComponentName"/>
/// is a stable identifier (e.g. "JobCards", "ComplianceFreshness") that
/// the frontend keys on; <see cref="ErrorCode"/> mirrors
/// <see cref="Error.Code"/> conventions; <see cref="Description"/> is a
/// human-readable hint suitable for support logs (NOT shown verbatim
/// to end users — strip in the response adapter if needed).
/// </summary>
public sealed record DegradedComponent(
    string ComponentName,
    string ErrorCode,
    string Description);
