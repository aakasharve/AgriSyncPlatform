using ShramSafal.Domain.Identity;

namespace ShramSafal.Application.Ports;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID. The ONE door to the ShramSafal-wide person tables
/// (<c>ssf.shram_persons</c>, <c>ssf.shram_person_phones</c>, <c>ssf.shram_cards</c>, <c>ssf.shram_phone_challenges</c>).
/// </summary>
/// <remarks>
/// <para><b>The F8 exception, and how a farm session is kept out.</b> Those tables carry no farm id (a person is not a
/// farm's). They are FORCE-RLS on a transaction-local setting, <c>agrisync.identity_scope</c>, that ONLY this store
/// sets (through <c>IdentityTenantScope</c>, the one allow-listed writer), and only after the request's farm scope has
/// been opened and its rule checked. A normal farm- or user-scoped session never sets it, so it reads nothing from them.
/// Every caller of this store is a narrow worker-identity use case; nothing else in the module may take it.</para>
/// <para><b>Same unit of work.</b> It writes through the request's own ShramSafal context, so a farm record and its
/// identity rows commit (or roll back) together with the request's transaction.</para>
/// <para>The append-only events table is farm-scoped (F8) and is read and written under the farm scope.</para>
/// </remarks>
/// <summary>
/// Fix pass 3 (review R1) — one try counted at a code: <see cref="Counted"/> with the tries now used, or not counted
/// because the code was already spent or its tries were used up.
/// </summary>
public readonly record struct CountedTry(bool Counted, int Attempts, bool Spent);

/// <summary>Which database one-holder rule refused an identity write (fix pass 2, N3).</summary>
public enum IdentitySaveClash
{
    /// <summary>Saved.</summary>
    None = 0,

    /// <summary>The number is already another person's active verified number (R3).</summary>
    NumberAlreadyVerified = 1,

    /// <summary>The person already holds an active verified number (H2/N3: one at a time; a second only by the move).</summary>
    PersonAlreadyVerified = 2,

    /// <summary>Another unique rule (nothing was written either way).</summary>
    Other = 3,
}

public interface IShramIdentityStore
{
    Task<ShramPerson?> GetPersonAsync(Guid personId, CancellationToken ct = default);

    Task<IReadOnlyList<ShramPerson>> GetPersonsAsync(IReadOnlyCollection<Guid> personIds, CancellationToken ct = default);

    /// <summary>The persons merged into <paramref name="personIds"/> (one level: a merge target is never itself merged).</summary>
    Task<IReadOnlyList<ShramPerson>> GetPersonsMergedIntoAsync(IReadOnlyCollection<Guid> personIds, CancellationToken ct = default);

    Task AddPersonAsync(ShramPerson person, CancellationToken ct = default);

    Task<ShramCard?> GetCardAsync(string codeBody, CancellationToken ct = default);

    Task<IReadOnlyList<ShramCard>> GetCardsAsync(IReadOnlyCollection<Guid> personIds, CancellationToken ct = default);

    Task AddCardAsync(ShramCard card, CancellationToken ct = default);

    Task<IReadOnlyList<ShramPersonPhone>> GetPhonesAsync(IReadOnlyCollection<Guid> personIds, CancellationToken ct = default);

    /// <summary>Every active (not released, not erased) row holding this number, verified or not, across ShramSafal.</summary>
    Task<IReadOnlyList<ShramPersonPhone>> GetActivePhonesByNumberAsync(string phoneE164, CancellationToken ct = default);

    Task AddPhoneAsync(ShramPersonPhone phone, CancellationToken ct = default);

    Task<ShramPhoneChallenge?> GetChallengeAsync(Guid challengeId, CancellationToken ct = default);

    /// <summary>
    /// Every code sent to this number since <paramref name="sinceUtc"/>, by any farm (fix pass 2, N2: the caller splits
    /// them into the sends of the farms he trusts and everyone else's).
    /// </summary>
    Task<IReadOnlyList<ShramPhoneChallenge>> GetChallengesToNumberSinceAsync(string phoneE164, DateTime sinceUtc, CancellationToken ct = default);

    /// <summary>
    /// Wrong tries at any code sent for these persons (one human) since <paramref name="sinceUtc"/>, per farm that asked
    /// for the code (fix pass 2, N2; fix pass 3, R2: the caller splits his own farms' tries from everyone else's).
    /// </summary>
    Task<IReadOnlyDictionary<Guid, int>> CountWrongTriesForPersonsByFarmSinceAsync(
        IReadOnlyCollection<Guid> personIds, DateTime sinceUtc, CancellationToken ct = default);

    /// <summary>
    /// Fix pass 3 (review R1) — holds this person's row (<c>SELECT … FOR UPDATE</c>) until the request's transaction ends,
    /// so every code send and every code check for one person runs one at a time: a parallel request waits here, then
    /// reads the committed counts and tries. Taken before any count, and always first (person, then anything else).
    /// </summary>
    Task LockPersonAsync(Guid personId, CancellationToken ct = default);

    /// <summary>
    /// Fix pass 3 (review R1) — counts one try at this code in ONE database statement (<c>attempts = attempts + 1 … WHERE
    /// attempts &lt; 5 AND not spent … RETURNING attempts</c>), so the five-tries rule holds even without the person lock.
    /// The tracked challenge is brought in line with the database.
    /// </summary>
    Task<CountedTry> CountTryAsync(ShramPhoneChallenge challenge, CancellationToken ct = default);

    /// <summary>The farms that linked these persons with HIS code (a link code he read back), ever (fix pass 2, N2).</summary>
    Task<IReadOnlyList<Guid>> GetFarmsLinkedByCodeAsync(IReadOnlyCollection<Guid> personIds, CancellationToken ct = default);

    /// <summary>Codes this FARM asked for since <paramref name="sinceUtc"/> (fix pass 1, M2).</summary>
    Task<int> CountChallengesByFarmSinceAsync(Guid farmId, DateTime sinceUtc, CancellationToken ct = default);

    /// <summary>Codes this USER asked for since <paramref name="sinceUtc"/> (fix pass 1, M2).</summary>
    Task<int> CountChallengesByUserSinceAsync(Guid userId, DateTime sinceUtc, CancellationToken ct = default);

    /// <summary>Wrong tries at any code this farm asked for since <paramref name="sinceUtc"/> (fix pass 1, M2).</summary>
    Task<int> CountWrongTriesByFarmSinceAsync(Guid farmId, DateTime sinceUtc, CancellationToken ct = default);

    Task AddChallengeAsync(ShramPhoneChallenge challenge, CancellationToken ct = default);

    /// <summary>This farm's events about one of its records (farm-scoped; another farm's are never visible).</summary>
    Task<IReadOnlyList<ShramIdentityEvent>> GetEventsForRecordAsync(Guid farmId, Guid fieldOperatorId, CancellationToken ct = default);

    Task AddEventAsync(ShramIdentityEvent identityEvent, CancellationToken ct = default);

    /// <summary>
    /// Commits this request's pending identity rows (and any farm row staged beside them). A clash on the verified-number
    /// index (R3) is answered <c>false</c> with nothing written, never a 500.
    /// </summary>
    Task<bool> TrySaveChangesAsync(CancellationToken ct = default);

    /// <summary>
    /// As <see cref="TrySaveChangesAsync"/>, naming WHICH one-holder rule refused the write (fix pass 2, N3): his number is
    /// already another person's verified number, or he already has a verified number.
    /// </summary>
    Task<IdentitySaveClash> SaveChangesOrClashAsync(CancellationToken ct = default);

    /// <summary>Closes the identity door for the rest of the request (a read that only needed it for one projection).</summary>
    Task CloseAsync(CancellationToken ct = default);
}
