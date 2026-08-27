// spec: dfes-companion-2026-07-11 (wave-4.4)

using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Work;

/// <summary>
/// <b>TIER 2 — a farm's own word about a worker.</b> Founder model, 2026-08-17.
///
/// <para>"What ARVE Farm reviewed about him. That might be the score, accountability or
/// anything that the ARVE farm owner wants to say." So this is one free-text field and an
/// attribution, and deliberately nothing more.</para>
///
/// <para><b>Why there is no number here.</b> The founder asked for the owner's word, not a
/// rating widget. A numeric field would immediately grow a star row, then an average, then
/// a formula nobody can explain to the man it describes — product design he has not asked
/// for. If a rating is wanted later it can be added; a five-star column added now would be
/// almost impossible to take back once farms had filled it in.</para>
///
/// <para><b>Attribution is not decoration.</b> A reference is only worth what its author is
/// worth, so a reader must be able to see WHO is vouching before deciding what the words
/// are worth. <see cref="FarmId"/> and <see cref="FarmName"/> travel with every statement
/// and cannot be dropped: a statement is never rendered as a free-floating verdict on the
/// worker.</para>
///
/// <para><b>Writing one is OPTIONAL, and an unwritten one is silence.</b> An owner may say
/// nothing. Nothing is not a bad review, and it must never be rendered as an empty score,
/// a zero, or "no rating yet" phrasing that implies a rating was owed. Absence of a
/// statement is modelled as an absent element in the collection — there is no "empty
/// statement" instance, which is why <see cref="Write"/> refuses blank remarks outright
/// rather than storing one.</para>
///
/// <para><b>Not persisted yet.</b> There is no table behind this and no endpoint that
/// writes one; see <c>IShramSafalRepository.GetWorkerStatementsAsync</c>, which returns
/// empty and says why. That is the honest state: the concept and its boundary exist, and
/// the storage is a deliberate next step rather than a half-built table quietly returning
/// rows nobody wrote.</para>
/// </summary>
public sealed record WorkerStatement
{
    private WorkerStatement(
        Guid id,
        FarmId farmId,
        string farmName,
        UserId workerUserId,
        UserId authoredByUserId,
        string remark,
        DateTime authoredAtUtc)
    {
        Id = id;
        FarmId = farmId;
        FarmName = farmName;
        WorkerUserId = workerUserId;
        AuthoredByUserId = authoredByUserId;
        Remark = remark;
        AuthoredAtUtc = authoredAtUtc;
    }

    public Guid Id { get; }

    /// <summary>The farm that is vouching. Travels with the statement, always.</summary>
    public FarmId FarmId { get; }

    /// <summary>The vouching farm's name, so a reader knows who spoke without a second
    /// lookup — and so a statement can never be shown detached from its author.</summary>
    public string FarmName { get; }

    /// <summary>The worker the statement is about. He is the data subject; the farm is the
    /// author. Creator is not data subject — the two are separate people here by
    /// construction.</summary>
    public UserId WorkerUserId { get; }

    /// <summary>The person at that farm who wrote it.</summary>
    public UserId AuthoredByUserId { get; }

    /// <summary>
    /// The employer's own words. Free text on purpose: an accountability note, a remark, a
    /// recommendation — whatever the owner wants to say. Left loose so the concept can
    /// grow; the founder asked to make the concept alive, not to harden it into a schema.
    /// </summary>
    public string Remark { get; }

    public DateTime AuthoredAtUtc { get; }

    /// <summary>
    /// Author a statement. Fails rather than storing an empty one: a blank remark is
    /// silence, and silence belongs outside the collection, not inside it as a row that
    /// renders as a farm having said something hollow about a man.
    /// </summary>
    public static WorkerStatement Write(
        Guid id,
        FarmId farmId,
        string farmName,
        UserId workerUserId,
        UserId authoredByUserId,
        string remark,
        DateTime authoredAtUtc)
    {
        if (string.IsNullOrWhiteSpace(remark))
        {
            throw new ArgumentException(
                "A worker statement with nothing in it is silence, and silence is not stored. " +
                "An owner who has nothing to say writes no statement at all.",
                nameof(remark));
        }

        if (string.IsNullOrWhiteSpace(farmName))
        {
            throw new ArgumentException(
                "A statement must name the farm vouching for the worker — a reader has to " +
                "know who is speaking before the words mean anything.",
                nameof(farmName));
        }

        return new WorkerStatement(
            id, farmId, farmName.Trim(), workerUserId, authoredByUserId,
            remark.Trim(), authoredAtUtc);
    }
}
