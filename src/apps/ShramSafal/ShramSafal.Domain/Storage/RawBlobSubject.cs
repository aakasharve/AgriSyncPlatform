namespace ShramSafal.Domain.Storage;

/// <summary>
/// Links a content-addressed raw blob (<see cref="RawBlobIndexEntry"/>) to the
/// data subject whose bytes it holds. Mapped to <c>ssf.raw_blob_subjects</c>.
/// Created by FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN §P0.9.
///
/// <para>
/// <b>Why a join table and not a column on <c>raw_blob_index</c>.</b> The blob
/// index is content-addressed (PK = sha256) and ref-counted, so two different
/// farmers can legitimately produce a row for the same sha256. Subject↔blob is
/// therefore many-to-many by construction. A scalar <c>user_id</c> on
/// <c>raw_blob_index</c> would silently lose the second subject the first time
/// one clip is re-uploaded under another account, and erasing farmer A would
/// then either destroy farmer B's evidence or spare it invisibly.
/// </para>
///
/// <para>
/// <b>Why it exists at all.</b> Before this table the ONLY user→audio pointer
/// was <c>ssf.ai_jobs.raw_input_ref</c> / <c>input_content_hash</c>, and the
/// DPDP erasure cascade deletes <c>ai_jobs WHERE user_id = X</c>. After that
/// delete the S3 object survives with nothing left in the system that can say
/// whose voice it is — permanently unattributable. This row is written at
/// blob-creation time and does not depend on <c>ai_jobs</c> surviving.
/// </para>
///
/// <para>
/// <b>Absence means unknown.</b> There is no placeholder subject. A blob whose
/// owner is genuinely not known carries NO row here rather than a row with
/// <see cref="Guid.Empty"/> or a fresh GUID — a fabricated owner is worse than
/// an honest gap, and <see cref="New"/> refuses to mint one.
/// </para>
///
/// <para>
/// <b>Not a retention or deletion decision.</b> This type records who a blob
/// belongs to. Whether raw audio is deleted on erasure, and after how long, is
/// deferred to counsel (§17). Nothing here deletes or retains anything.
/// </para>
/// </summary>
public sealed class RawBlobSubject
{
    /// <summary>SHA-256 of the blob bytes. FK → <c>ssf.raw_blob_index.sha256</c>.</summary>
    public string Sha256 { get; private set; } = string.Empty;

    /// <summary>The data subject this blob belongs to. Never a placeholder.</summary>
    public Guid UserId { get; private set; }

    /// <summary>
    /// When this subject was FIRST linked to this blob. Not updated on a repeat
    /// sighting — the linkage is idempotent on <c>(sha256, user_id)</c>, so the
    /// value keeps meaning "first seen" rather than drifting to "last seen".
    /// </summary>
    public DateTime FirstSeenUtc { get; private set; }

    private RawBlobSubject() { }

    /// <summary>
    /// Mint a linkage row. Throws when the caller has no real subject — an
    /// unknown owner must be represented by the ABSENCE of a row, never by a
    /// stand-in value.
    /// </summary>
    /// <exception cref="ArgumentException">
    /// <paramref name="sha256"/> is blank, or <paramref name="userId"/> is
    /// <see cref="Guid.Empty"/>.
    /// </exception>
    public static RawBlobSubject New(string sha256, Guid userId)
    {
        if (string.IsNullOrWhiteSpace(sha256))
        {
            throw new ArgumentException("Raw-blob subject linkage requires a sha256.", nameof(sha256));
        }

        if (userId == Guid.Empty)
        {
            throw new ArgumentException(
                "Raw-blob subject linkage requires a real subject. An unknown owner is recorded " +
                "as the absence of a linkage row, never as Guid.Empty.",
                nameof(userId));
        }

        return new RawBlobSubject
        {
            Sha256 = sha256,
            UserId = userId,
            FirstSeenUtc = DateTime.UtcNow,
        };
    }
}
