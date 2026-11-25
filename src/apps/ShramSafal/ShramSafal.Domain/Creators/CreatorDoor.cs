using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.Creators;

// spec: plr-d10-schedule-approved-spec-2026-11-23 ("Making a schedule": creators invite only, own session, no self-approval); build plan slice 15, server half.
//
// The creator door: an outside schedule maker, invited by ShramSafal staff, who signs in at his own door and sends a schedule for a check. Nothing here is a farmer, a farm or a
// library row: a submission stays in these tables until a staff checker approves it, and only then does the server make the library row through the same importer.

/// <summary>Where an invited creator stands. Only <see cref="Invited"/> and <see cref="Active"/> may sign in.</summary>
public enum CreatorStatus : short
{
    Invited = 0,
    Active = 1,
    Revoked = 2,
    Erased = 3,
}

/// <summary>
/// <c>ssf.creator_profiles</c>: one invited outside schedule maker. His id is his OWN id (never a farmer's account id): it is the subject of his session token and the maker of
/// every library row made from his approved work. After erasure the row stays as an opaque id with no phone and no name (doctrine P6: anonymise the person, never the work).
/// </summary>
public sealed class CreatorProfile : Entity<Guid>
{
    public const int MaxNameLength = 80;
    public const string ErasedName = "erased";

    private CreatorProfile() : base(Guid.Empty) { } // EF Core

    private CreatorProfile(Guid id, string phone, string displayName, Guid invitedByUserId, DateTime atUtc) : base(id)
    {
        Phone = phone;
        DisplayName = displayName;
        Status = CreatorStatus.Invited;
        InvitedByUserId = invitedByUserId;
        InvitedAtUtc = atUtc;
        ModifiedAtUtc = atUtc;
    }

    /// <summary>The ten-digit Indian mobile number he signs in with; null once erased.</summary>
    public string? Phone { get; private set; }

    public string DisplayName { get; private set; } = string.Empty;
    public CreatorStatus Status { get; private set; }

    /// <summary>The ShramSafal staff member (schedule review seat) who invited him.</summary>
    public Guid InvitedByUserId { get; private set; }

    public DateTime InvitedAtUtc { get; private set; }
    public DateTime? FirstSignedInAtUtc { get; private set; }
    public DateTime? RevokedAtUtc { get; private set; }
    public DateTime? ErasedAtUtc { get; private set; }
    public DateTime ModifiedAtUtc { get; private set; }

    public bool MaySignIn => Status is CreatorStatus.Invited or CreatorStatus.Active;

    public static CreatorProfile? Invite(Guid id, string? phone, string? displayName, Guid invitedByUserId, DateTime atUtc, out string? problem)
    {
        problem = null;
        var normalized = NormalizePhone(phone);
        if (normalized is null)
        {
            problem = "The phone must be a ten-digit Indian mobile number.";
            return null;
        }

        var name = CleanName(displayName);
        if (name is null)
        {
            problem = $"The creator needs a name of at most {MaxNameLength} characters.";
            return null;
        }

        if (id == Guid.Empty || invitedByUserId == Guid.Empty)
        {
            problem = "An invitation needs its id and the staff member who invites.";
            return null;
        }

        return new CreatorProfile(id, normalized, name, invitedByUserId, atUtc);
    }

    /// <summary>A revoked creator invited again by staff: he may sign in again; his id and his earlier work are unchanged.</summary>
    public void InviteAgain(Guid invitedByUserId, DateTime atUtc)
    {
        if (Status != CreatorStatus.Revoked)
        {
            return;
        }

        Status = FirstSignedInAtUtc is null ? CreatorStatus.Invited : CreatorStatus.Active;
        InvitedByUserId = invitedByUserId;
        RevokedAtUtc = null;
        ModifiedAtUtc = atUtc;
    }

    public void MarkSignedIn(DateTime atUtc)
    {
        if (Status == CreatorStatus.Invited)
        {
            Status = CreatorStatus.Active;
        }

        FirstSignedInAtUtc ??= atUtc;
        ModifiedAtUtc = atUtc;
    }

    public void Revoke(DateTime atUtc)
    {
        if (Status is CreatorStatus.Invited or CreatorStatus.Active)
        {
            Status = CreatorStatus.Revoked;
            RevokedAtUtc = atUtc;
            ModifiedAtUtc = atUtc;
        }
    }

    public bool Rename(string? displayName, DateTime atUtc)
    {
        var name = CleanName(displayName);
        if (name is null)
        {
            return false;
        }

        DisplayName = name;
        ModifiedAtUtc = atUtc;
        return true;
    }

    /// <summary>Ten digits starting 6 to 9, with an optional +91 / 91 / 0 in front and spaces or dashes inside; anything else is null.</summary>
    public static string? NormalizePhone(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        var digits = new string(raw.Where(char.IsAsciiDigit).ToArray());
        if (raw.Any(c => !char.IsAsciiDigit(c) && c is not ('+' or ' ' or '-')))
        {
            return null;
        }

        if (digits.Length == 12 && digits.StartsWith("91", StringComparison.Ordinal))
        {
            digits = digits[2..];
        }
        else if (digits.Length == 11 && digits[0] == '0')
        {
            digits = digits[1..];
        }

        return digits.Length == 10 && digits[0] is >= '6' and <= '9' ? digits : null;
    }

    private static string? CleanName(string? raw)
    {
        var name = raw?.Trim();
        return string.IsNullOrEmpty(name) || name.Length > MaxNameLength ? null : name;
    }
}

public enum CreatorSignInCodeStatus : short
{
    Pending = 0,
    Consumed = 1,
    Expired = 2,
    LockedOut = 3,
}

/// <summary>
/// <c>ssf.creator_sign_in_codes</c>: one one-time code sent to an invited phone at the creator door. Its OWN table: a code asked for at the farmer's door never opens this one, and
/// the rows counted for the SMS ceiling of this door are only this door's.
/// </summary>
public sealed class CreatorSignInCode : Entity<Guid>
{
    private CreatorSignInCode() : base(Guid.Empty) { } // EF Core

    public CreatorSignInCode(Guid id, string phone, string codeHash, DateTime issuedAtUtc, TimeSpan lifetime, int maxAttempts) : base(id)
    {
        Phone = phone;
        CodeHash = codeHash;
        IssuedAtUtc = issuedAtUtc;
        ExpiresAtUtc = issuedAtUtc.Add(lifetime);
        MaxAttempts = maxAttempts;
        Status = CreatorSignInCodeStatus.Pending;
    }

    public string Phone { get; private set; } = string.Empty;
    public string CodeHash { get; private set; } = string.Empty;
    public DateTime IssuedAtUtc { get; private set; }
    public DateTime ExpiresAtUtc { get; private set; }
    public int Attempts { get; private set; }
    public int MaxAttempts { get; private set; }
    public CreatorSignInCodeStatus Status { get; private set; }

    public void Supersede()
    {
        if (Status == CreatorSignInCodeStatus.Pending)
        {
            Status = CreatorSignInCodeStatus.Expired;
        }
    }

    /// <summary>True only for the right code on a pending, unexpired row; a wrong try is counted and the row locks at its limit.</summary>
    public bool TryConsume(bool codeMatches, DateTime atUtc)
    {
        if (Status != CreatorSignInCodeStatus.Pending)
        {
            return false;
        }

        if (atUtc >= ExpiresAtUtc)
        {
            Status = CreatorSignInCodeStatus.Expired;
            return false;
        }

        if (!codeMatches)
        {
            Attempts++;
            if (Attempts >= MaxAttempts)
            {
                Status = CreatorSignInCodeStatus.LockedOut;
            }

            return false;
        }

        Status = CreatorSignInCodeStatus.Consumed;
        return true;
    }
}

/// <summary>
/// <c>ssf.creator_sessions</c>: one signed-in browser of a creator. The refresh credential is kept only as its hash and is bound to the device id that browser sent at sign-in:
/// a refresh from another device id ends the session.
/// </summary>
public sealed class CreatorSession : Entity<Guid>
{
    private CreatorSession() : base(Guid.Empty) { } // EF Core

    public CreatorSession(Guid id, Guid creatorId, string tokenHash, string deviceIdHash, DateTime atUtc, TimeSpan lifetime) : base(id)
    {
        CreatorId = creatorId;
        TokenHash = tokenHash;
        DeviceIdHash = deviceIdHash;
        IssuedAtUtc = atUtc;
        LastUsedAtUtc = atUtc;
        ExpiresAtUtc = atUtc.Add(lifetime);
    }

    public Guid CreatorId { get; private set; }
    public string TokenHash { get; private set; } = string.Empty;
    public string DeviceIdHash { get; private set; } = string.Empty;
    public DateTime IssuedAtUtc { get; private set; }
    public DateTime LastUsedAtUtc { get; private set; }
    public DateTime ExpiresAtUtc { get; private set; }
    public DateTime? RevokedAtUtc { get; private set; }

    public bool IsLive(DateTime atUtc) => RevokedAtUtc is null && atUtc < ExpiresAtUtc;

    /// <summary>A refresh: the old credential stops working the moment the new one is written.</summary>
    public void Rotate(string newTokenHash, DateTime atUtc)
    {
        TokenHash = newTokenHash;
        LastUsedAtUtc = atUtc;
    }

    public void Revoke(DateTime atUtc) => RevokedAtUtc ??= atUtc;
}

/// <summary>One round of a creator's work. Only a <see cref="Draft"/> can be changed, and only by its creator; only staff move a round out of <see cref="Submitted"/>.</summary>
public enum CreatorSubmissionState : short
{
    Draft = 0,
    Submitted = 1,
    Returned = 2,
    Approved = 3,
}

/// <summary>
/// <c>ssf.creator_submissions</c>: one ROUND of one piece of a creator's work (<see cref="WorkId"/> is shared by every round). The body is a reference schedule in format 2, the
/// same shape the staff import route takes, kept as it was sent. A returned round is never edited: staff's return opens the next round as a new draft holding the same body, so
/// what was sent, what was said about it and what was sent next all stay (doctrine P3).
/// </summary>
public sealed class CreatorSubmission : Entity<Guid>
{
    public const int MaxBodyBytes = 512 * 1024;
    public const int MaxTitleLength = 200;
    public static readonly TimeSpan DraftLifetime = TimeSpan.FromDays(90);

    private CreatorSubmission() : base(Guid.Empty) { } // EF Core

    private CreatorSubmission(Guid id, Guid creatorId, Guid workId, int round, string title, string bodyJson, DateTime atUtc) : base(id)
    {
        CreatorId = creatorId;
        WorkId = workId;
        Round = round;
        Title = title;
        BodyJson = bodyJson;
        State = CreatorSubmissionState.Draft;
        CreatedAtUtc = atUtc;
        ModifiedAtUtc = atUtc;
        ExpiresAtUtc = atUtc.Add(DraftLifetime);
    }

    public Guid CreatorId { get; private set; }
    public Guid WorkId { get; private set; }
    public int Round { get; private set; }
    public string Title { get; private set; } = string.Empty;
    public string BodyJson { get; private set; } = string.Empty;
    public CreatorSubmissionState State { get; private set; }

    /// <summary>The content hash of the body as the importer builds it, stamped when the round is sent.</summary>
    public string? ContentHash { get; private set; }

    public DateTime CreatedAtUtc { get; private set; }
    public DateTime ModifiedAtUtc { get; private set; }
    public DateTime? SubmittedAtUtc { get; private set; }
    public DateTime? DecidedAtUtc { get; private set; }

    /// <summary>A draft and its files go ninety days after its last change; null once the round is sent.</summary>
    public DateTime? ExpiresAtUtc { get; private set; }

    /// <summary>The library row made from this round when staff approved it; null until then.</summary>
    public Guid? LibraryTemplateId { get; private set; }

    public static CreatorSubmission NewDraft(Guid id, Guid creatorId, string title, string bodyJson, DateTime atUtc) =>
        new(id, creatorId, id, 1, Clip(title), bodyJson, atUtc);

    /// <summary>The next round of a returned work: a new draft holding the same body, for the creator to change and send again.</summary>
    public CreatorSubmission NextRound(Guid id, DateTime atUtc) => new(id, CreatorId, WorkId, Round + 1, Title, BodyJson, atUtc);

    public bool IsExpired(DateTime atUtc) => State == CreatorSubmissionState.Draft && ExpiresAtUtc is { } until && atUtc >= until;

    public bool ReplaceBody(string title, string bodyJson, DateTime atUtc)
    {
        if (State != CreatorSubmissionState.Draft)
        {
            return false;
        }

        Title = Clip(title);
        BodyJson = bodyJson;
        ModifiedAtUtc = atUtc;
        ExpiresAtUtc = atUtc.Add(DraftLifetime);
        return true;
    }

    public bool Submit(string contentHash, DateTime atUtc)
    {
        if (State != CreatorSubmissionState.Draft)
        {
            return false;
        }

        State = CreatorSubmissionState.Submitted;
        ContentHash = contentHash;
        SubmittedAtUtc = atUtc;
        ModifiedAtUtc = atUtc;
        ExpiresAtUtc = null;
        return true;
    }

    public bool Return(DateTime atUtc) => Decide(CreatorSubmissionState.Returned, null, atUtc);

    public bool Approve(Guid libraryTemplateId, DateTime atUtc) => Decide(CreatorSubmissionState.Approved, libraryTemplateId, atUtc);

    private bool Decide(CreatorSubmissionState state, Guid? templateId, DateTime atUtc)
    {
        if (State != CreatorSubmissionState.Submitted)
        {
            return false;
        }

        State = state;
        LibraryTemplateId = templateId;
        DecidedAtUtc = atUtc;
        ModifiedAtUtc = atUtc;
        return true;
    }

    private static string Clip(string? title)
    {
        var text = (title ?? string.Empty).Trim();
        return text.Length > MaxTitleLength ? text[..MaxTitleLength] : text;
    }
}

public enum CreatorDecisionKind : short
{
    Returned = 0,
    Approved = 1,
}

/// <summary>
/// <c>ssf.creator_submission_decisions</c>: what a staff checker decided about one round, APPEND-ONLY: who, when, the reasons of a return as written, and for an approval the
/// library row made and the content hash it was approved on. Never written by a creator.
/// </summary>
public sealed class CreatorSubmissionDecision : Entity<Guid>
{
    public const int MaxReasonsLength = 2000;

    private CreatorSubmissionDecision() : base(Guid.Empty) { } // EF Core

    public CreatorSubmissionDecision(
        Guid id, Guid submissionId, Guid creatorId, CreatorDecisionKind decision, string? reasons, Guid decidedByUserId, DateTime atUtc, Guid? libraryTemplateId, string? contentHash)
        : base(id)
    {
        SubmissionId = submissionId;
        CreatorId = creatorId;
        Decision = decision;
        Reasons = reasons;
        DecidedByUserId = decidedByUserId;
        DecidedAtUtc = atUtc;
        LibraryTemplateId = libraryTemplateId;
        ContentHash = contentHash;
    }

    public Guid SubmissionId { get; private set; }
    public Guid CreatorId { get; private set; }
    public CreatorDecisionKind Decision { get; private set; }
    public string? Reasons { get; private set; }
    public Guid DecidedByUserId { get; private set; }
    public DateTime DecidedAtUtc { get; private set; }
    public Guid? LibraryTemplateId { get; private set; }
    public string? ContentHash { get; private set; }
}

/// <summary>Every file starts <see cref="Quarantined"/>; the scanner decides. Only a <see cref="Clean"/> file can be read by anyone.</summary>
public enum CreatorFileState : short
{
    Quarantined = 0,
    Clean = 1,
    Blocked = 2,
}

/// <summary>
/// <c>ssf.creator_files</c>: the metadata of one file a creator attached to his work (a source document or a picture of one). The bytes live under their OWN storage prefix
/// (<see cref="StoragePrefix"/>), never a farmer's store. A blocked file keeps its row (what was refused and why) and has no bytes.
/// </summary>
public sealed class CreatorFile : Entity<Guid>
{
    public const string StoragePrefix = "creator-door-files";
    public const long MaxBytes = 10L * 1024 * 1024;
    public const int MaxFilesPerWork = 10;
    public const long MaxBytesPerWork = 50L * 1024 * 1024;
    public const int MaxNameLength = 120;

    private CreatorFile() : base(Guid.Empty) { } // EF Core

    public CreatorFile(Guid id, Guid creatorId, Guid workId, Guid submissionId, string fileName, string mimeType, long sizeBytes, string contentHash, DateTime atUtc)
        : base(id)
    {
        CreatorId = creatorId;
        WorkId = workId;
        SubmissionId = submissionId;
        FileName = fileName;
        MimeType = mimeType;
        SizeBytes = sizeBytes;
        ContentHash = contentHash;
        StorageKey = $"{StoragePrefix}/{creatorId:N}/{id:N}";
        State = CreatorFileState.Quarantined;
        CreatedAtUtc = atUtc;
    }

    public Guid CreatorId { get; private set; }
    public Guid WorkId { get; private set; }

    /// <summary>The round it was attached to. A file of a round that was sent is history and is never removed by the creator.</summary>
    public Guid SubmissionId { get; private set; }

    public string FileName { get; private set; } = string.Empty;
    public string MimeType { get; private set; } = string.Empty;
    public long SizeBytes { get; private set; }
    public string ContentHash { get; private set; } = string.Empty;
    public string StorageKey { get; private set; } = string.Empty;
    public CreatorFileState State { get; private set; }

    /// <summary>The scanner that decided, and its words when it refused.</summary>
    public string? ScannerName { get; private set; }

    public string? ScanWords { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime? ScannedAtUtc { get; private set; }

    public void MarkClean(string scannerName, DateTime atUtc) => Decide(CreatorFileState.Clean, scannerName, null, atUtc);

    public void MarkBlocked(string scannerName, string words, DateTime atUtc) => Decide(CreatorFileState.Blocked, scannerName, words, atUtc);

    private void Decide(CreatorFileState state, string scannerName, string? words, DateTime atUtc)
    {
        if (State != CreatorFileState.Quarantined)
        {
            return;
        }

        State = state;
        ScannerName = scannerName.Length > 60 ? scannerName[..60] : scannerName;
        ScanWords = words is { Length: > 300 } ? words[..300] : words;
        ScannedAtUtc = atUtc;
    }

    /// <summary>The name as shown: no folder, no control character, at most <see cref="MaxNameLength"/> characters. Never used as a storage key.</summary>
    public static string CleanName(string? raw)
    {
        var name = (raw ?? string.Empty).Replace('\\', '/');
        name = name[(name.LastIndexOf('/') + 1)..];
        name = new string(name.Where(c => !char.IsControl(c)).ToArray()).Trim();
        if (name.Length == 0)
        {
            return "file";
        }

        return name.Length > MaxNameLength ? name[^MaxNameLength..] : name;
    }
}

/// <summary><c>ssf.creator_terms_acceptances</c>: the creator agreed to one version of the creator terms, APPEND-ONLY. The terms text itself is the founder's and is not stored here.</summary>
public sealed class CreatorTermsAcceptance : Entity<Guid>
{
    public const int MaxVersionLength = 40;

    private CreatorTermsAcceptance() : base(Guid.Empty) { } // EF Core

    public CreatorTermsAcceptance(Guid id, Guid creatorId, string termsVersion, DateTime atUtc) : base(id)
    {
        CreatorId = creatorId;
        TermsVersion = termsVersion;
        AcceptedAtUtc = atUtc;
    }

    public Guid CreatorId { get; private set; }
    public string TermsVersion { get; private set; } = string.Empty;
    public DateTime AcceptedAtUtc { get; private set; }
}
