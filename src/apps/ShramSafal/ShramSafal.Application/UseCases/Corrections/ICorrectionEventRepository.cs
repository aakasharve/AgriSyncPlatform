// spec: correctionevent-server-persistence
using ShramSafal.Domain.Corrections;

namespace ShramSafal.Application.UseCases.Corrections;

public interface ICorrectionEventRepository
{
    Task AddAsync(CorrectionEvent correction, CancellationToken ct = default);
}
