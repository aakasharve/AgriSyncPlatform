namespace ShramSafal.Domain.Farms;

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 2) and lane 2b (MU design §2, §11.1) — the STORED
/// bitmask of what the primary account holder switched on for one person on one farm
/// (<c>ssf.farm_memberships.permissions</c>). Each bit is one authority of
/// <see cref="FarmAuthority"/>; the label on the seat (<c>role</c>) grants none of them (founder
/// D-22 / D-26: "सहमालक and कुटुंब … neither automatically grants operational, financial, approval,
/// setup, or administrative powers").
///
/// <para><b>Values are persisted — never renumber.</b> Add a new flag on a new bit only. Lane 2b
/// added bits 6–9; bits 0–5 are step 2's, unchanged.</para>
///
/// <para><b>Not here, on purpose:</b> "take हजेरी" (<see cref="FarmAuthority.TakeAttendance"/>). It is
/// the existing labour grant (<see cref="FarmMembership.CanManageLabourRecords"/> +
/// <see cref="FarmMembership.LabourGrantExpiresAtUtc"/>), kept as THE one store for it — two stores
/// for one power is how they drift apart.</para>
///
/// <para><b>Meaning of a step-2 name kept:</b> <see cref="AddTestRecord"/> is "lab records".</para>
///
/// <para><b>RETIRED bits — kept so no value is ever reused; never granted, never read:</b>
/// <see cref="Invite"/> (inviting, approving, changing authorities, pausing and removing are the
/// primary account holder's alone, D-26) and <see cref="AddCost"/> (lane 2b fix 1: step 2's "may
/// split a whole-farm bill" meant LESS than review money, so a stored 4 must never be read as review
/// money — <see cref="ReviewMoney"/> is a new bit, and the 2b migration grants it only to seats that
/// could already do every one of its actions).</para>
/// </summary>
[Flags]
public enum FarmPermission
{
    None = 0,

    /// <summary>See money: costs, bills, ledgers, payouts, totals. Stored and reported; the download filter is lane MU-3.</summary>
    SeeMoney = 1 << 0,

    /// <summary>See per-person wages. Requires <see cref="SeeMoney"/>. Stored and reported; filter is MU-3.</summary>
    SeeWages = 1 << 1,

    /// <summary>RETIRED (lane 2b fix 1) — step 2's "may change recorded money". Never granted, never read; see <see cref="ReviewMoney"/>.</summary>
    AddCost = 1 << 2,

    /// <summary>Plan work: create or change work plans (job cards, the crop-schedule steps). STORED only: L8 enforces it; until then today's label rule still decides (lane 2b brief).</summary>
    PlanWork = 1 << 3,

    /// <summary>RETIRED — never granted, never read (people and permissions are the primary account holder's alone).</summary>
    Invite = 1 << 4,

    /// <summary>Lab records (wire name kept): a test's sample taken, its result, waiving it, a test protocol.</summary>
    AddTestRecord = 1 << 5,

    /// <summary>lane 2b — Assign work to another person (D-26 "plan ≠ assign"). STORED only: L8 enforces it; until then today's label rule still decides.</summary>
    AssignWork = 1 << 6,

    /// <summary>lane 2b — Confirm records: a log's मंजूर / शंका, a compliance warning; never money (D-24d, D-44).</summary>
    ConfirmRecords = 1 << 7,

    /// <summary>lane 2b — Edit farm setup: add a plot, the boundary, motors, water (D-15 via D-26).</summary>
    EditFarmSetup = 1 << 8,

    /// <summary>lane 2b — Schedule templates: write a Team / Licensed template (replaces the global-role gate).</summary>
    ManageScheduleTemplates = 1 << 9,

    /// <summary>lane 2b fix 1 — Review money entries: correct a cost, split a whole-farm cost, job-card payout verify / settle. Requires <see cref="SeeMoney"/>.</summary>
    ReviewMoney = 1 << 10,

    /// <summary>
    /// spec: plr-d10 lane L8c-1 (R19: the next free bit at merge) — See all tasks ("सगळी कामे पाहणे"): every planned task and
    /// reminder of the farm on the plots the seat covers, not only the ones he made or was given (D-24e1, D-79).
    /// </summary>
    SeeAllTasks = 1 << 11,
}
