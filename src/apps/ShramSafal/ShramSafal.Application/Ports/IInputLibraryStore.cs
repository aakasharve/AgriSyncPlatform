// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1c, Task 2)
using ShramSafal.Domain.Inputs;

namespace ShramSafal.Application.Ports;

/// <summary>
/// The read side of the input library (<c>ssf.input_library_*</c>): ShramSafal-wide reference data, no farm column,
/// readable by every caller under the caller's own user scope. It serves PUBLISHED rows only; a draft never leaves the
/// database through this port. Writing the library is an admin act (the intake command), never a farm's.
/// </summary>
public interface IInputLibraryStore
{
    /// <summary>The published version string (<c>inputs-2.1</c>), or null when the library has never been seeded in this database.</summary>
    Task<string?> GetPublishedVersionAsync(CancellationToken ct = default);

    /// <summary>The published library as served: its version and JSON. Null when the library has never been seeded.</summary>
    Task<PublishedLibraryCopy?> GetPublishedAsync(CancellationToken ct = default);
}
