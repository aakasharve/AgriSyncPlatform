using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.Identity;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID. One contact number of a person, tagged with whose phone it
/// is (स्वतःचा / घरचा / मुकादमचा) and whether HE proved it with a code. A phone is how we reach and check a person; it is
/// not who he is (design §1).
/// </summary>
/// <remarks>
/// <para><b>R3.</b> A VERIFIED number belongs to one person at a time: the database keeps one active verified row per
/// number (a partial unique index). Moving it takes the case-5 flow; the old row is RELEASED, never deleted, so its
/// history stays (R5).</para>
/// <para><b>R4.</b> An unverified number may repeat (a family phone, a मुकादम's phone typed for his gang): warn, never block.</para>
/// <para><b>R10.</b> <see cref="AddedByFarmId"/> is the farm that typed it: only that farm is ever shown even its last digits.</para>
/// </remarks>
public sealed class ShramPersonPhone : Entity<Guid>
{
    private ShramPersonPhone() : base(Guid.Empty) { } // EF Core

    private ShramPersonPhone(Guid id, Guid personId, string phoneE164, PhoneWhose whose, Guid? addedByFarmId, DateTime addedAtUtc)
        : base(id)
    {
        PersonId = personId;
        PhoneE164 = phoneE164;
        Whose = whose;
        AddedByFarmId = addedByFarmId;
        AddedAtUtc = addedAtUtc;
    }

    public Guid PersonId { get; private set; }

    /// <summary><c>+91</c> and ten digits; <c>null</c> once erased (R8).</summary>
    public string? PhoneE164 { get; private set; }

    public PhoneWhose Whose { get; private set; }
    public Guid? AddedByFarmId { get; private set; }
    public DateTime AddedAtUtc { get; private set; }
    public DateTime? VerifiedAtUtc { get; private set; }
    public DateTime? ReleasedAtUtc { get; private set; }

    public bool IsActive => ReleasedAtUtc is null && PhoneE164 is not null;
    public bool IsActiveVerified => IsActive && VerifiedAtUtc is not null;

    public static ShramPersonPhone Add(Guid id, Guid personId, string phone, PhoneWhose whose, Guid? addedByFarmId, DateTime addedAtUtc)
    {
        var e164 = IndianMobile.Normalize(phone)
            ?? throw new ArgumentException("An Indian mobile number has 10 digits and starts with 6, 7, 8 or 9.", nameof(phone));
        if (personId == Guid.Empty)
        {
            throw new ArgumentException("A phone belongs to a person.", nameof(personId));
        }

        return new ShramPersonPhone(id, personId, e164, whose, addedByFarmId, addedAtUtc);
    }

    public void ChangeWhose(PhoneWhose whose) => Whose = whose;

    /// <summary>He proved he holds it now (screen 3).</summary>
    public void MarkVerified(DateTime atUtc)
    {
        if (!IsActive)
        {
            throw new InvalidOperationException("A released or erased number cannot be verified.");
        }

        VerifiedAtUtc ??= atUtc;
    }

    /// <summary>No longer his contact (a changed number, case 5): the row and its dates stay as history.</summary>
    public void Release(DateTime atUtc) => ReleasedAtUtc ??= atUtc;

    /// <summary>R8 — the number is forgotten; the row says only that a phone once existed.</summary>
    public void Erase(DateTime atUtc)
    {
        PhoneE164 = null;
        ReleasedAtUtc ??= atUtc;
    }
}
