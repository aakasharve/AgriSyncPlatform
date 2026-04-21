using ShramSafal.Domain.Tests;

namespace ShramSafal.Application.Ports;

/// <summary>
/// Read/write port for <see cref="TestProtocol"/> aggregates. See CEI §4.5.
/// Infrastructure wiring lands in CEI Phase 3.
/// </summary>
public interface ITestProtocolRepository
{
    Task AddAsync(TestProtocol protocol, CancellationToken ct = default);
    Task<TestProtocol?> GetByIdAsync(Guid protocolId, CancellationToken ct = default);

    /// <summary>
    /// Returns all <see cref="TestProtocol"/> rows matching the given crop type
    /// (trimmed, case-insensitive). Used by <c>ScheduleTestDueDatesHandler</c>
    /// to decide which protocols apply to a crop cycle.
    /// </summary>
    Task<IReadOnlyList<TestProtocol>> GetByCropTypeAsync(string cropType, CancellationToken ct = default);
}
