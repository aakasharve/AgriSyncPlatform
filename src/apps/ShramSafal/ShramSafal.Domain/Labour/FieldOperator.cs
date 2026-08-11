using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Wtl;

namespace ShramSafal.Domain.Labour;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 9) — a
/// durable human work subject, deliberately <b>not</b> a user account.
/// <c>Id</c> (<c>FieldOperatorId</c>) is work identity; account identity
/// (<c>UserId</c>) stays wholly separate — there is no linked-user column,
/// claim table, OTP/QR claim, or Aadhaar of any form in V1, and that
/// separation is a frozen founder invariant (Global Constraint 1/2). A
/// <c>FieldOperatorWorkRow</c> (Task 10) later attributes work to this
/// identity without ever changing the reported headcount on the underlying
/// <c>LabourAssignment</c> (Constraint 3).
/// </summary>
/// <remarks>
/// <para>
/// <b>No uniqueness on any name column, ever.</b> Two field operators on the
/// same farm may legitimately share both <see cref="DisplayName"/> and
/// <see cref="FullName"/> — two different real people genuinely called
/// बाळू. Collapsing them into one record is an identity-merge bug: it
/// silently attributes one person's work to another.
/// <see cref="DisplayNameNormalized"/> exists for search and suggestion
/// only — it must never be used to find-or-create or otherwise merge
/// records. That is exactly the WTL v0 <c>WorkerNameProjector</c> defect
/// (find-or-create on exact normalised name per farm) this type must not
/// repeat.
/// </para>
/// <para>
/// <see cref="FullName"/> is stored verbatim — never normalized, never
/// compared, never used for matching.
/// </para>
/// </remarks>
public sealed class FieldOperator : Entity<Guid>
{
    private FieldOperator() : base(Guid.Empty) { } // EF Core

    private FieldOperator(
        Guid id,
        string displayName,
        string displayNameNormalized,
        string? fullName,
        FarmId originatingFarmId,
        UserId createdByUserId,
        DateTime createdAtUtc)
        : base(id)
    {
        DisplayName = displayName;
        DisplayNameNormalized = displayNameNormalized;
        FullName = fullName;
        OriginatingFarmId = originatingFarmId;
        CreatedByUserId = createdByUserId;
        CreatedAtUtc = createdAtUtc;
        IsActive = true;
    }

    public string DisplayName { get; private set; } = string.Empty;

    /// <summary>
    /// Search/suggestion index only, using <see cref="WorkerName"/>'s
    /// existing normalization rules (trim, strip <c>मा.</c>/<c>श्री.</c>/
    /// <c>भाऊ</c>, lowercase). Never a uniqueness or matching key — see
    /// the class remarks.
    /// </summary>
    public string DisplayNameNormalized { get; private set; } = string.Empty;

    /// <summary>Stored verbatim. Never normalized, compared, or matched on.</summary>
    public string? FullName { get; private set; }

    /// <summary>Tenancy key — direct RLS, like <c>WeatherEvent.FarmId</c>.</summary>
    public FarmId OriginatingFarmId { get; private set; }

    public UserId CreatedByUserId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public bool IsActive { get; private set; }

    public static FieldOperator Create(
        Guid id,
        string displayName,
        string? fullName,
        FarmId originatingFarmId,
        UserId createdByUserId,
        DateTime createdAtUtc)
    {
        if (string.IsNullOrWhiteSpace(displayName))
        {
            throw new ArgumentException(
                "Display name is required — a field operator must be identifiable by name.",
                nameof(displayName));
        }

        var name = WorkerName.From(displayName);

        return new FieldOperator(
            id, name.Raw, name.Normalized, fullName,
            originatingFarmId, createdByUserId, createdAtUtc);
    }

    /// <summary>
    /// Renames the operator going forward only. Recomputes
    /// <see cref="DisplayNameNormalized"/> via the same <see cref="WorkerName"/>
    /// rule used at creation, and never touches any existing work row — a
    /// <c>FieldOperatorWorkRow</c> snapshots <c>DisplayNameAtAttach</c> at
    /// attach time (Task 10, Scenario 7), so renaming a person here must not
    /// rewrite recorded history.
    /// </summary>
    public void Rename(string displayName, DateTime atUtc)
    {
        if (string.IsNullOrWhiteSpace(displayName))
        {
            throw new ArgumentException(
                "Display name is required — a field operator must be identifiable by name.",
                nameof(displayName));
        }

        var name = WorkerName.From(displayName);
        DisplayName = name.Raw;
        DisplayNameNormalized = name.Normalized;
    }

    public void Deactivate(DateTime atUtc)
    {
        IsActive = false;
    }
}
