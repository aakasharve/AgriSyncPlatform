using ShramSafal.Domain.RecordPrivacy;

namespace ShramSafal.Application.UseCases.RecordPrivacy.SetRecordAudience;

/// <summary>
/// spec: plr-d10 lane PRV (founder D-26; Q3 2026-10-30) — the farm's primary account holder chooses who sees ONE record
/// (<c>set_record_audience</c>, a queued offline-safe sync mutation; there is no REST-only path).
/// </summary>
/// <param name="RecordKind"><see cref="RecordKinds.DailyLog"/> or <see cref="RecordKinds.CostEntry"/>.</param>
/// <param name="RecordId">The record.</param>
/// <param name="Audience">Team, Selected or OnlyMe.</param>
/// <param name="SelectedUserIds">The people he chose (only for <see cref="RecordAudience.Selected"/>; empty otherwise).</param>
/// <param name="ActorUserId">Who sent it (the authenticated caller, never a payload claim).</param>
/// <param name="ActorRole">The role the caller CLAIMED — recorded, never trusted.</param>
/// <param name="ClientRequestId">The phone's request id.</param>
/// <param name="ChangedOnPhoneAtUtc">When the phone made the choice (recorded, never trusted for ordering).</param>
public sealed record SetRecordAudienceCommand(
    string RecordKind,
    Guid RecordId,
    RecordAudience Audience,
    IReadOnlyList<Guid> SelectedUserIds,
    Guid ActorUserId,
    string? ActorRole = null,
    string? ClientRequestId = null,
    DateTime? ChangedOnPhoneAtUtc = null,
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");

/// <summary>
/// The answer: the audience as it now stands, and how many of the record's own money entries followed it (a work
/// record's money follows its record, my call in lane PRV).
/// </summary>
public sealed record SetRecordAudienceResultDto(
    string RecordKind,
    Guid RecordId,
    string Audience,
    IReadOnlyList<Guid> SelectedUserIds,
    DateTime AudienceChangedAtUtc,
    int MoneyEntriesFollowed,
    bool Changed);
