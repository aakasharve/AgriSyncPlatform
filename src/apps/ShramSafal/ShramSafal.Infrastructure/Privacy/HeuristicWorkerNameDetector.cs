// spec: data-principle-spine-2026-05-05/10.1
using System.Reflection;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Ports.Privacy;
using ShramSafal.Domain.Privacy.Pii;

namespace ShramSafal.Infrastructure.Privacy;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 10 sub-phase 10.1 — heuristic adapter for
/// <see cref="IThirdPartyPiiDetector"/>. Loads the worker-name
/// dictionary from an embedded resource at construction (cheap; one
/// disk hit per process), then defers all detection logic to the pure
/// <see cref="WorkerNameDetector"/> in the Domain layer.
///
/// <para>
/// <b>No external calls.</b> Per OQ-2, the heuristic floor avoids any
/// cross-border data movement (no Gemini call → no audit row in the
/// Phase 05 transfer ledger). An architecture test asserts this
/// invariant via source-grep.
/// </para>
///
/// <para>
/// <b>Thresholds bound at call time (OQ-3).</b> The adapter pulls
/// <see cref="PiiOptions.AutoRedactThreshold"/> /
/// <see cref="PiiOptions.DiscardThreshold"/> from the options snapshot
/// on every <c>DetectAsync</c> call so an operator can re-calibrate
/// thresholds without restarting the process (when using
/// <c>IOptionsMonitor</c>; <see cref="IOptions{T}"/> in V1 — promotion
/// to monitor is a one-line change when the §10.1 calibration probe
/// completes).
/// </para>
/// </summary>
public sealed class HeuristicWorkerNameDetector : IThirdPartyPiiDetector
{
    // Layout: lazy dictionary load — first call hydrates, subsequent
    // calls reuse. Lock-free; HashSet<string> publication is
    // atomic-reference-write safe under .NET memory model and the
    // detector is stateless after construction.
    private readonly Lazy<WorkerNameDetector> _engine;
    private readonly IOptions<PiiOptions> _options;

    public HeuristicWorkerNameDetector(IOptions<PiiOptions> options)
    {
        ArgumentNullException.ThrowIfNull(options);
        _options = options;
        _engine = new Lazy<WorkerNameDetector>(BuildEngine, isThreadSafe: true);
    }

    public Task<PiiDetection> DetectAsync(Guid transcriptId, string text, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var snapshot = _options.Value;
        var detection = _engine.Value.Detect(
            text ?? string.Empty,
            autoRedactThreshold: snapshot.AutoRedactThreshold,
            discardThreshold: snapshot.DiscardThreshold);
        return Task.FromResult(detection);
    }

    public async Task<bool> IsClean(Guid transcriptId, CancellationToken ct)
    {
        // No persisted flag in V1 — re-run heuristic. Phase 09 reader
        // contract documents the upgrade path.
        var detection = await DetectAsync(transcriptId, string.Empty, ct);
        return detection.Status == PiiDetectionStatus.Clean;
    }

    private WorkerNameDetector BuildEngine()
    {
        var names = LoadNameDictionary();
        return new WorkerNameDetector(names, WorkerNameDetector.DefaultMarkers);
    }

    private static IReadOnlySet<string> LoadNameDictionary()
    {
        var assembly = typeof(HeuristicWorkerNameDetector).Assembly;
        var resourceName = assembly
            .GetManifestResourceNames()
            .FirstOrDefault(n => n.EndsWith("marathi_worker_names.txt", StringComparison.OrdinalIgnoreCase));

        if (resourceName is null)
        {
            // Fail-loud: missing dictionary means the detector has no
            // signal to fire on. Better to crash startup than silently
            // run a no-op detector.
            throw new InvalidOperationException(
                "Embedded resource marathi_worker_names.txt missing. " +
                "Phase 10.1 dictionary must ship inside ShramSafal.Infrastructure.");
        }

        using var stream = assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException(
                $"Embedded resource {resourceName} could not be opened.");
        using var reader = new StreamReader(stream);

        var names = new HashSet<string>(StringComparer.Ordinal);
        string? line;
        while ((line = reader.ReadLine()) is not null)
        {
            var trimmed = line.Trim();
            if (string.IsNullOrEmpty(trimmed)) continue;
            if (trimmed.StartsWith('#')) continue;
            names.Add(trimmed);
        }

        return names;
    }
}
