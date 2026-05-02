namespace ShramSafal.Application.Abstractions.Sync;

/// <summary>
/// Sub-plan 05 Task 2a (T-IGH-05-FAIL-PUSHES-WIRING).
/// Abstraction consumed by <c>PushSyncBatchHandler</c> to check whether the
/// E2E harness has armed a forced-failure for sync pushes.
///
/// In production this interface is satisfied by <see cref="NoOpFailPushesProbe"/>
/// (returns <see langword="null"/>). When the server is started with
/// <c>ALLOW_E2E_SEED=true</c> the Bootstrapper re-registers an adapter backed by
/// <c>E2eFailPushesToggle</c>.
/// </summary>
public interface IE2eFailPushesProbe
{
    /// <summary>
    /// When non-null, every sync mutation should be rejected with this reason as
    /// the error detail. <see langword="null"/> means "do not fail".
    /// </summary>
    string? FailReason { get; }
}
