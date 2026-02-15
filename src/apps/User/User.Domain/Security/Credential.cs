namespace User.Domain.Security;

public sealed class Credential
{
    private Credential() { } // EF Core

    private Credential(string passwordHash, DateTime createdAtUtc)
    {
        PasswordHash = passwordHash;
        CreatedAtUtc = createdAtUtc;
    }

    public string PasswordHash { get; private set; } = string.Empty;
    public DateTime CreatedAtUtc { get; private set; }

    public static Credential Create(string passwordHash, DateTime utcNow)
    {
        if (string.IsNullOrWhiteSpace(passwordHash))
        {
            throw new ArgumentException("Password hash cannot be empty.", nameof(passwordHash));
        }

        return new Credential(passwordHash, utcNow);
    }

    public void UpdateHash(string newHash, DateTime utcNow)
    {
        PasswordHash = newHash;
        CreatedAtUtc = utcNow;
    }
}
