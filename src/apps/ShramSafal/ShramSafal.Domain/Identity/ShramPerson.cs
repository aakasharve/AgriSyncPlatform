using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.Identity;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID. The Person (श्रम ओळख): one per real human, ShramSafal-wide,
/// so it carries NO farm id (the design's F8 exception, ruled by the orchestrator 2026-11-02). It holds the name on his
/// card, his home PIN code and, by relation, his phones and card codes. ALL WORK stays on each farm's
/// <c>FieldOperator</c> (Labour V1 Constraint 1): a farm record points at a person once proven, and linking never moves
/// or rewrites work (R2, P7).
/// </summary>
/// <remarks>
/// <para><b>Reached only through the narrow identity endpoints.</b> The table is FORCE-RLS on a dedicated
/// transaction-local setting only those endpoints set (<c>IdentityTenantScope</c>): a normal farm- or user-scoped
/// session reads nothing from it.</para>
/// <para><b>R10.</b> His home PIN is his, but another farm never sees it: it is shown only to the farm that recorded it
/// (<see cref="PinVisibleTo"/>), and only that farm may change it.</para>
/// <para><b>Merge (case 9)</b> keeps both ids: the merged person points at the one he is now (<see cref="MergedIntoPersonId"/>),
/// his old card resolves to the new person, and the owner who merged can undo it.</para>
/// <para><b>Erasure (R8, P6)</b> anonymises the person — name, PIN, phones, card — never the work.</para>
/// </remarks>
public sealed class ShramPerson : Entity<Guid>
{
    public const string ErasedName = "Erased worker";

    private ShramPerson() : base(Guid.Empty) { } // EF Core

    private ShramPerson(Guid id, string cardName, Guid createdByUserId, DateTime createdAtUtc)
        : base(id)
    {
        CardName = cardName;
        CreatedByUserId = createdByUserId;
        CreatedAtUtc = createdAtUtc;
    }

    /// <summary>The name on his card, as the farm that added him first wrote it (what a scan shows, R6).</summary>
    public string CardName { get; private set; } = string.Empty;

    public string? HomePinCode { get; private set; }

    /// <summary>The farm that recorded <see cref="HomePinCode"/>: the only farm that sees it or may change it (R10).</summary>
    public Guid? HomePinSetByFarmId { get; private set; }

    public Guid CreatedByUserId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public Guid? MergedIntoPersonId { get; private set; }
    public DateTime? ErasureRequestedAtUtc { get; private set; }
    public Guid? ErasureRequestedByUserId { get; private set; }
    public DateTime? ErasedAtUtc { get; private set; }

    public bool IsErased => ErasedAtUtc is not null;

    public static ShramPerson Create(Guid id, string cardName, Guid createdByUserId, DateTime createdAtUtc)
    {
        if (id == Guid.Empty)
        {
            throw new ArgumentException("A person needs an id.", nameof(id));
        }

        if (string.IsNullOrWhiteSpace(cardName))
        {
            throw new ArgumentException("The card carries a name.", nameof(cardName));
        }

        var name = cardName.Trim();
        return new ShramPerson(id, name.Length > 200 ? name[..200] : name, createdByUserId, createdAtUtc);
    }

    /// <summary>The PIN this farm may see: its own record of it, never another farm's (R10).</summary>
    public string? PinVisibleTo(Guid farmId) => HomePinSetByFarmId == farmId ? HomePinCode : null;

    /// <summary>
    /// Records his home PIN for <paramref name="farmId"/>. Set when none is on record; changed only by the farm that
    /// recorded it. Another farm's PIN is never overwritten nor revealed: that answers <see cref="PinOutcome.HeldElsewhere"/>.
    /// </summary>
    public PinOutcome SetHomePin(string pin, Guid farmId)
    {
        var normalized = Identity.HomePinCode.Normalize(pin)
            ?? throw new ArgumentException("A PIN code is 6 digits and does not start with 0.", nameof(pin));
        EnsureNotErased();

        if (HomePinCode is null || HomePinSetByFarmId == farmId)
        {
            if (HomePinCode == normalized && HomePinSetByFarmId == farmId)
            {
                return PinOutcome.Unchanged;
            }

            HomePinCode = normalized;
            HomePinSetByFarmId = farmId;
            return PinOutcome.Set;
        }

        return PinOutcome.HeldElsewhere;
    }

    /// <summary>Case 9 — "same person": this person is now <paramref name="targetPersonId"/>.</summary>
    public void MergeInto(Guid targetPersonId)
    {
        EnsureNotErased();
        if (targetPersonId == Guid.Empty || targetPersonId == Id)
        {
            throw new InvalidOperationException("A person merges into a different person.");
        }

        if (MergedIntoPersonId is not null)
        {
            throw new InvalidOperationException("This person is already merged.");
        }

        MergedIntoPersonId = targetPersonId;
    }

    /// <summary>Undo of a merge, by the owner who made it (R5).</summary>
    public void Unmerge()
    {
        if (MergedIntoPersonId is null)
        {
            throw new InvalidOperationException("This person is not merged.");
        }

        MergedIntoPersonId = null;
    }

    /// <summary>D-71: erasure waits; asking twice keeps the first date (one waiting request per person).</summary>
    public bool RequestErasure(Guid byUserId, DateTime atUtc)
    {
        if (IsErased)
        {
            return false;
        }

        if (ErasureRequestedAtUtc is null)
        {
            ErasureRequestedAtUtc = atUtc;
            ErasureRequestedByUserId = byUserId;
        }

        return true;
    }

    /// <summary>A waiting request may be withdrawn; once erased, nothing comes back.</summary>
    public bool CancelErasure()
    {
        if (IsErased || ErasureRequestedAtUtc is null)
        {
            return false;
        }

        ErasureRequestedAtUtc = null;
        ErasureRequestedByUserId = null;
        return true;
    }

    /// <summary>R8 / P6 — anonymise the person (his phones and cards are anonymised by their own entities).</summary>
    public void Anonymise(DateTime atUtc)
    {
        CardName = ErasedName;
        HomePinCode = null;
        HomePinSetByFarmId = null;
        ErasedAtUtc ??= atUtc;
    }

    private void EnsureNotErased()
    {
        if (IsErased)
        {
            throw new InvalidOperationException("An erased person cannot change.");
        }
    }
}

/// <summary>What recording a home PIN did.</summary>
public enum PinOutcome
{
    Set = 0,
    Unchanged = 1,

    /// <summary>Another farm recorded his PIN; it was neither changed nor revealed.</summary>
    HeldElsewhere = 2,
}
