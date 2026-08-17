// spec: dfes-companion-2026-07-11 (wave-4.4)

namespace ShramSafal.Domain.Work;

/// <summary>
/// What KIND of thing is being read about a worker. Founder model, 2026-08-17.
///
/// <para>The whole reputation design turns on one distinction: <b>a reputation belongs to
/// the worker; the operational record belongs to the farm.</b> Those two are mixed together
/// in the same tables — a job card holds both "he finished the job" (his) and "we sprayed
/// 400ml of X on plot 3 for ₹700" (the farm's). So the tier is not a property of a table.
/// It is a property of the QUESTION being asked, and the caller has to name it.</para>
///
/// <para>Why the founder wanted it this way, in his words: when Patil Farms wants to hire
/// Ramesh they "must not be able to see what he did at ARVE Farms in exact things — but
/// must be able to see what ARVE Farm reviewed about him", plus "Shram Safal generated
/// number of completed tasks or completed field work hours".</para>
///
/// <para>A reference letter can be written by a friend; a number can be invented. This can
/// be neither. Patil Farms gets the ARVE owner's own word (tier 2) plus a count the system
/// itself stands behind (tier 3) — and none of ARVE's farm data (tier 1).</para>
/// </summary>
public enum WorkerRecordTier
{
    /// <summary>
    /// <b>Tier 1 — the farm's operational detail. It NEVER crosses a farm boundary.</b>
    ///
    /// <para>Which plot, which crop, what spray, what dose, which day, what it cost. This
    /// is the farm's own business record, which happens to have a worker's name attached —
    /// it is not his reputation.</para>
    ///
    /// <para><b>No consent unlocks this, because it is not the worker's to give.</b> A
    /// worker cannot license his employer's spray schedule to a competitor any more than
    /// the employer can license the worker's reputation. That asymmetry is the reason this
    /// tier ignores <c>workerConsentedToPortability</c> entirely rather than merely
    /// defaulting it to false.</para>
    /// </summary>
    FarmOperationalDetail = 1,

    /// <summary>
    /// <b>Tier 2 — the employer's own statement about the worker. Travels with the
    /// worker's consent.</b>
    ///
    /// <para>A remark, an accountability note — "anything the ARVE farm owner wants to
    /// say". It is the employer's freely-given word, like a reference, and it is attributed
    /// to the farm that wrote it so a reader always knows who is vouching.</para>
    ///
    /// <para><b>Writing one is OPTIONAL.</b> An owner may say nothing at all, and silence
    /// must render as silence — never as a bad score, never as an empty star row. See
    /// <see cref="WorkerStatement"/>.</para>
    /// </summary>
    EmployerStatement = 2,

    /// <summary>
    /// <b>Tier 3 — what Shram Safal itself counts. Travels with the worker's consent.</b>
    ///
    /// <para>Neutral, derived, never typed: completed tasks, completed field-work hours.
    /// Nobody claims these — they fall out of work already recorded, which is exactly why
    /// they cannot be flattered the way a written reference can.</para>
    ///
    /// <para>Doctrine P4 governs: genuinely derived from real rows, never estimated, never
    /// defaulted, never back-filled to look better. If a count cannot be derived honestly,
    /// it is absent — not zero. See <see cref="WorkerDerivedCounts"/>.</para>
    /// </summary>
    DerivedCount = 3,
}
