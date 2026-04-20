using ShramSafal.Application.Contracts.Dtos;

namespace ShramSafal.Application.Ports;

public interface IAdminMisRepository
{
    Task<WvfdHistoryDto> GetWvfdHistoryAsync(int weeks, CancellationToken ct = default);
}
