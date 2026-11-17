// spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-S; founder D-146)
using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Pictures;

/// <summary>
/// One CURRENT picture per (<see cref="Kind"/>, <see cref="SubjectId"/>): <c>ssf.pictures</c>. A person's face is personal data, so the
/// row holds only what is needed to serve it: where the file is, its type, size and hash, and who set it when. Never the image.
///
/// <para><b>Hangs on a person or on a schedule's ROOT, never on a version</b> (spec A): changing a picture writes no
/// <c>schedule_templates</c> row, so "made by NAME, typed on DATE" stays true per version. Replacing UPDATES this row (the file at the old
/// key is deleted by the handler); removing deletes it. No foreign key on <see cref="SubjectId"/> or <see cref="SetByUserId"/>
/// (they are opaque ids, like <c>OwnerUserId</c>: a foreign key proves existence, not permission, E4).</para>
///
/// <para><b>Erasure (P6).</b> The erased person's PERSON row and the SCHEDULE rows he set are DELETED with their files; INSTITUTION
/// rows stay (not a person's data).</para>
/// </summary>
public sealed class Picture : Entity<Guid>
{
    private Picture() : base(Guid.Empty) { } // EF Core

    private Picture(
        Guid id, PictureKind kind, Guid subjectId, string storageKey, string contentType, int bytes, string sha256,
        UserId setByUserId, DateTime setAtUtc)
        : base(id)
    {
        Kind = kind;
        SubjectId = subjectId;
        StorageKey = storageKey;
        ContentType = contentType;
        Bytes = bytes;
        Sha256 = sha256;
        SetByUserId = setByUserId;
        SetAtUtc = setAtUtc;
    }

    public PictureKind Kind { get; private set; }

    /// <summary>The user id (PERSON) or the schedule's root template id (SCHEDULE, INSTITUTION).</summary>
    public Guid SubjectId { get; private set; }

    /// <summary>The key in the attachment storage (<see cref="PictureRules.StorageKeyFor"/>).</summary>
    public string StorageKey { get; private set; } = string.Empty;

    /// <summary>The type the first bytes proved.</summary>
    public string ContentType { get; private set; } = string.Empty;

    public int Bytes { get; private set; }

    /// <summary>Lower-case hex SHA-256 of the file: the ETag and what the phone compares before it downloads.</summary>
    public string Sha256 { get; private set; } = string.Empty;

    public UserId SetByUserId { get; private set; }

    public DateTime SetAtUtc { get; private set; }

    public static Picture Create(
        Guid id, PictureKind kind, Guid subjectId, string contentType, int bytes, string sha256, UserId setByUserId, DateTime setAtUtc)
    {
        Validate(id, subjectId, contentType, bytes, sha256, setByUserId);
        return new Picture(
            id, kind, subjectId, PictureRules.StorageKeyFor(kind, subjectId, sha256), contentType, bytes, sha256, setByUserId,
            DateTime.SpecifyKind(setAtUtc, DateTimeKind.Utc));
    }

    /// <summary>Replaces the file this row points at. The caller deletes the file at the previous <see cref="StorageKey"/>.</summary>
    public void Replace(string contentType, int bytes, string sha256, UserId setByUserId, DateTime setAtUtc)
    {
        Validate(Id, SubjectId, contentType, bytes, sha256, setByUserId);
        StorageKey = PictureRules.StorageKeyFor(Kind, SubjectId, sha256);
        ContentType = contentType;
        Bytes = bytes;
        Sha256 = sha256;
        SetByUserId = setByUserId;
        SetAtUtc = DateTime.SpecifyKind(setAtUtc, DateTimeKind.Utc);
    }

    private static void Validate(Guid id, Guid subjectId, string contentType, int bytes, string sha256, UserId setByUserId)
    {
        if (id == Guid.Empty)
        {
            throw new ArgumentException("Picture id is required.", nameof(id));
        }

        if (subjectId == Guid.Empty)
        {
            throw new ArgumentException("Picture subject is required.", nameof(subjectId));
        }

        if (contentType is not (PictureRules.Jpeg or PictureRules.Png or PictureRules.Webp))
        {
            throw new ArgumentException("Picture content type must be jpeg, png or webp.", nameof(contentType));
        }

        if (bytes <= 0 || bytes > PictureRules.MaxBytes)
        {
            throw new ArgumentOutOfRangeException(nameof(bytes), bytes, "Picture size is out of range.");
        }

        if (sha256 is not { Length: 64 } || !sha256.All(c => c is (>= '0' and <= '9') or (>= 'a' and <= 'f')))
        {
            throw new ArgumentException("Picture hash must be 64 lower-case hex characters.", nameof(sha256));
        }

        if (setByUserId.IsEmpty)
        {
            throw new ArgumentException("Who set the picture is required.", nameof(setByUserId));
        }
    }
}
