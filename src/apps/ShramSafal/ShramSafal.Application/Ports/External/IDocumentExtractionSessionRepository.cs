using ShramSafal.Domain.AI;

namespace ShramSafal.Application.Ports.External;

public interface IDocumentExtractionSessionRepository
{
    Task SaveAsync(DocumentExtractionSession session, CancellationToken ct = default);
    Task<DocumentExtractionSession?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<List<DocumentExtractionSession>> GetPendingVerificationAsync(int limit, decimal maxDraftConfidence, CancellationToken ct = default);
}
