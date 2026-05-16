// spec: data-principle-spine-2026-05-05/02-patch-test-harness
using ShramSafal.Application.Storage;
using ShramSafal.Domain.Storage;

namespace ShramSafal.Infrastructure.Storage;

/// <summary>
/// In-process <see cref="IRawBlobStore"/> for test harnesses and dev where
/// no real S3 is wired. Hashes the payload to produce a stable
/// <see cref="RawBlobRef"/> but does NOT persist bytes anywhere.
/// Production composition root replaces this with
/// <see cref="S3RawBlobStore"/> via a later <c>AddScoped</c> registration
/// (last-registered-wins for <c>GetService&lt;T&gt;</c>).
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this exists.</b> Phase 02 patch (cold-storage wiring) made
/// <see cref="ShramSafal.Infrastructure.AI.AiOrchestrator"/> depend on
/// <see cref="IRawBlobStore"/>. The integration test harness (AiEndpointsTests
/// + sibling sync integration tests) calls
/// <c>AddShramSafalInfrastructure</c> directly without going through
/// Bootstrapper's <c>Program.cs</c>, so the production S3 registration
/// was missing and AiOrchestrator failed to activate with
/// "Unable to resolve service for type IRawBlobStore". Register a
/// hash-only stub in the Infrastructure module via TryAddScoped so the
/// DI graph is complete regardless of who composes it.
/// </para>
/// <para>
/// <b>Not a no-op.</b> <see cref="PutAsync"/> computes the real SHA-256
/// so the returned <see cref="RawBlobRef.Sha256"/> matches what
/// production would compute for the same bytes. Tests that assert
/// "rawInputRef is a 64-char hex sha" pass without S3.
/// </para>
/// <para>
/// <b>Get/Dereference are not supported here.</b> Calls throw
/// <see cref="NotSupportedException"/> because the bytes were never
/// stored. Tests that need round-trip should explicitly register a
/// recording stub or use the LocalStack-backed integration test
/// (deferred to Phase 02 MAJOR #4 follow-up).
/// </para>
/// </remarks>
public sealed class InMemoryRawBlobStore : IRawBlobStore
{
    public async Task<RawBlobRef> PutAsync(Stream payload, string contentType, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(payload);
        using var ms = new MemoryStream();
        await payload.CopyToAsync(ms, ct);
        return RawBlobRef.FromBytes(ms.ToArray(), contentType);
    }

    public Task<Stream> GetAsync(string sha256, CancellationToken ct) =>
        throw new NotSupportedException(
            "InMemoryRawBlobStore does not retain bytes — use LocalStack/S3 or a recording stub for read tests.");

    public Task DereferenceAsync(string sha256, CancellationToken ct) =>
        throw new NotSupportedException(
            "InMemoryRawBlobStore does not retain bytes — use LocalStack/S3 or a recording stub for delete tests.");
}
