// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1c, Task 2)
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Inputs;

namespace ShramSafal.Application.UseCases.ReferenceData.GetInputLibrary;

/// <summary>The answer to <c>GET /shramsafal/reference/input-library</c>. <see cref="NotModified"/> means the phone already holds
/// <see cref="Version"/> (the route answers 304 and sends no body); otherwise <see cref="Json"/> is the library.</summary>
public sealed record InputLibraryResponse(bool NotModified, string Version, byte[]? Json);

/// <summary>
/// The phone's download of the input library by version. The library is global and large, so it has a route of its own
/// and is never folded into the sync pull. The version is the ETag: a caller that sends it back in <c>If-None-Match</c>
/// gets "not modified" and costs the database one small read.
///
/// <para>Only PUBLISHED rows are ever served. A database that has never been seeded (a development database built without
/// migrations) serves the embedded seed as version 1, so the answer is the same shape either way.</para>
/// </summary>
public sealed class GetInputLibraryHandler(IInputLibraryStore store)
{
    private static readonly Lazy<PublishedLibraryCopy> EmbeddedSeed = new(() => InputLibraryWorkspace.FromEmbeddedSeed().BuildPublished());

    public async Task<InputLibraryResponse> HandleAsync(string? ifNoneMatch, CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();

        var version = await store.GetPublishedVersionAsync(ct);
        if (version is null)
        {
            var seed = EmbeddedSeed.Value;
            return InputLibraryETag.Matches(ifNoneMatch, seed.Version)
                ? new InputLibraryResponse(true, seed.Version, null)
                : new InputLibraryResponse(false, seed.Version, seed.Json);
        }

        if (InputLibraryETag.Matches(ifNoneMatch, version))
        {
            return new InputLibraryResponse(true, version, null);
        }

        var copy = await store.GetPublishedAsync(ct);
        if (copy is null)
        {
            var seed = EmbeddedSeed.Value;
            return new InputLibraryResponse(false, seed.Version, seed.Json);
        }

        // The copy is what the rows say now; its version may be newer than the one asked about a moment ago. Serve it
        // under its own version, so the phone stores the content with the version it really is.
        return new InputLibraryResponse(false, copy.Version, copy.Json);
    }
}

/// <summary>The <c>If-None-Match</c> rule for the library: the stored version in quotes is the ETag.</summary>
public static class InputLibraryETag
{
    /// <summary>
    /// True when the header names <paramref name="version"/>: a comma-separated list of validators, each optionally weak
    /// (<c>W/"..."</c>) and quoted, or <c>*</c>. An empty or missing header never matches.
    /// </summary>
    public static bool Matches(string? ifNoneMatch, string version)
    {
        if (string.IsNullOrWhiteSpace(ifNoneMatch))
        {
            return false;
        }

        foreach (var raw in ifNoneMatch.Split(','))
        {
            var token = raw.Trim();
            if (token == "*")
            {
                return true;
            }

            if (token.StartsWith("W/", StringComparison.Ordinal))
            {
                token = token[2..];
            }

            token = token.Trim('"');
            if (string.Equals(token, version, StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }
}
