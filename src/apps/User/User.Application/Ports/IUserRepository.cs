using User.Domain.Identity;

namespace User.Application.Ports;

public interface IUserRepository
{
    Task<Domain.Identity.User?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<Domain.Identity.User?> GetByPhoneAsync(string phone, CancellationToken ct = default);
    Task<bool> ExistsByPhoneAsync(string phone, CancellationToken ct = default);
    Task AddAsync(Domain.Identity.User user, CancellationToken ct = default);
    Task SaveChangesAsync(CancellationToken ct = default);
}
