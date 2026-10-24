namespace User.Application.UseCases.Auth.Session;

/// <summary>
/// Server-side life of a refresh credential. One definition, used for the stored
/// refresh_tokens row AND the web refresh cookie, so the two can never drift.
/// The mobile client pins the same number (refreshCredentialLife.ts) to size its
/// unfinished-logout protection; change both together.
/// </summary>
public static class RefreshTokenPolicy
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromDays(30);
}
