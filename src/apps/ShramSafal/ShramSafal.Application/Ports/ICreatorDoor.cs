using ShramSafal.Domain.Creators;

namespace ShramSafal.Application.Ports;

// spec: plr-d10-schedule-approved-spec-2026-11-23 ("Making a schedule"); build plan slice 15 (the creator door), server half.

/// <summary>
/// The creator door's settings (<c>CreatorDoor:*</c>). The door is OFF unless <see cref="Enabled"/> is set: every <c>/creator/*</c> route then answers 404, as if it were
/// not there. Registered once as a plain object.
/// </summary>
public sealed class CreatorDoorOptions
{
    public const string SectionName = "CreatorDoor";

    public bool Enabled { get; set; }

    /// <summary>The web origins of the creator door, and only of it. Never listed in the main <c>Cors:AllowedOrigins</c>.</summary>
    public string[] AllowedOrigins { get; set; } = [];

    /// <summary>The audience of a creator's access token: its OWN, so the farmer and staff routes refuse it and this door refuses theirs.</summary>
    public string Audience { get; set; } = "ShramSafal.CreatorDoor";

    /// <summary>The SMS ceiling of this door: at most this many codes to one phone in 24 hours.</summary>
    public int MaxCodesPerPhonePerDay { get; set; } = 5;

    public int CodeMinutes { get; set; } = 5;
    public int MaxCodeAttempts { get; set; } = 5;
    public int SessionDays { get; set; } = 30;

    /// <summary>The version of the creator terms a creator must have agreed to before he sends work. Empty: no terms are set yet (Production refuses to open the door then).</summary>
    public string TermsVersion { get; set; } = string.Empty;

    /// <summary>Which scanner decides about files: <c>builtin</c> (the type, size and test-file check only) or the name of a real one registered by the host.</summary>
    public string Scanner { get; set; } = "builtin";
}

/// <summary>
/// The two scopes of the creator door, set for the database exactly as a farm's or a person's scope is (a transaction-local setting the row policies read).
/// <list type="bullet">
/// <item><see cref="RunAtDoorAsync{T}"/>: before anyone is signed in. The key is the phone asking for a code, or the hash of the refresh credential presented: the policies show
/// only the one profile with that phone, the codes of that phone, or the one session with that hash.</item>
/// <item><see cref="RunAsCreatorAsync{T}"/>: a signed-in creator. The policies show his rows and nobody else's; no farm, no farmer and no other creator.</item>
/// <item><see cref="RunAsMakerOfLibraryRowAsync{T}"/>: only for the moment a staff checker's approval writes the library row: the row's tasks must be written under the maker's
/// own identity (their existing row policy), and the maker is the creator. The staff scope is put back before it returns.</item>
/// </list>
/// </summary>
public interface ICreatorDoorScope
{
    Task<T> RunAtDoorAsync<T>(string doorKey, Func<CancellationToken, Task<T>> work, CancellationToken ct = default);

    Task<T> RunAsCreatorAsync<T>(Guid creatorId, Func<CancellationToken, Task<T>> work, CancellationToken ct = default);

    Task<T> RunAsMakerOfLibraryRowAsync<T>(Guid creatorId, Guid staffUserId, Func<CancellationToken, Task<T>> work, CancellationToken ct = default);
}

/// <summary>The rows of the creator door. Every read is filtered by row security to the scope it runs under; nothing here widens it.</summary>
public interface ICreatorDoorStore
{
    Task<CreatorProfile?> GetProfileAsync(Guid creatorId, CancellationToken ct = default);
    Task<CreatorProfile?> GetProfileByPhoneAsync(string phone, CancellationToken ct = default);
    Task<IReadOnlyList<CreatorProfile>> ListProfilesAsync(CancellationToken ct = default);
    void Add(CreatorProfile profile);

    Task<int> CountCodesIssuedSinceAsync(string phone, DateTime sinceUtc, CancellationToken ct = default);
    Task<CreatorSignInCode?> GetPendingCodeAsync(string phone, CancellationToken ct = default);
    void Add(CreatorSignInCode code);

    Task<CreatorSession?> GetSessionByTokenHashAsync(string tokenHash, CancellationToken ct = default);
    Task<IReadOnlyList<CreatorSession>> ListLiveSessionsAsync(Guid creatorId, DateTime nowUtc, CancellationToken ct = default);
    void Add(CreatorSession session);

    Task<CreatorSubmission?> GetSubmissionAsync(Guid submissionId, CancellationToken ct = default);
    Task<IReadOnlyList<CreatorSubmission>> ListSubmissionsAsync(CancellationToken ct = default);
    Task<IReadOnlyList<CreatorSubmission>> ListRoundsOfWorkAsync(Guid workId, CancellationToken ct = default);
    void Add(CreatorSubmission submission);
    void Remove(CreatorSubmission submission);

    Task<IReadOnlyList<CreatorSubmissionDecision>> ListDecisionsAsync(IReadOnlyCollection<Guid> submissionIds, CancellationToken ct = default);
    void Add(CreatorSubmissionDecision decision);

    Task<CreatorFile?> GetFileAsync(Guid fileId, CancellationToken ct = default);
    Task<IReadOnlyList<CreatorFile>> ListFilesOfWorkAsync(Guid workId, CancellationToken ct = default);
    void Add(CreatorFile file);
    void Remove(CreatorFile file);

    Task<IReadOnlyList<CreatorTermsAcceptance>> ListTermsAsync(Guid creatorId, CancellationToken ct = default);
    void Add(CreatorTermsAcceptance acceptance);

    Task SaveChangesAsync(CancellationToken ct = default);
}

/// <summary>What a creator's access token carries beside its subject (his creator id): which door it is for, and his session.</summary>
public static class CreatorDoorClaims
{
    public const string Door = "door";
    public const string DoorValue = "creator";
    public const string Session = "sid";
}

/// <summary>A creator's access token: fifteen minutes or less, with the door's OWN audience.</summary>
public sealed record CreatorAccessToken(string Token, DateTime ExpiresAtUtc);

public interface ICreatorTokenIssuer
{
    CreatorAccessToken Issue(Guid creatorId, Guid sessionId, DateTime nowUtc);
}
