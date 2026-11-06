// spec: plr-d10-redesign-real-integration-2026-10-25 (I25; founder D-13, D-31)
//
// Two additive facts on the existing consent surface:
//   • D-31 — which words the "keep my original voice" choice was made under (the switch now
//     says "I and authorized reviewers on this farm"); a choice made on an older phone, or
//     against unknown words, must read as unknown (null), never as the new words.
//   • D-13 — GET /consent/me says which notice is in force and which one this person last
//     accepted, and a failure to read the latter can never break the read (every phone
//     back to 1.0.15 calls it) — it reports "unknown", which makes a phone ASK.
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Consent.GetConsent;
using ShramSafal.Application.UseCases.Consent.UpdateConsent;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Consent;
using ShramSafal.Domain.Privacy;
using ShramSafal.Domain.Tests.Common;
using Xunit;

namespace ShramSafal.Domain.Tests.Privacy;

public sealed class ConsentWordingVersionTests
{
    private static readonly Guid User = Guid.Parse("c3000000-0000-0000-0000-000000000003");
    private static readonly DateTime T0 = new(2026, 10, 30, 6, 0, 0, DateTimeKind.Utc);
    private const string NewWords = "voice-keep-2026-11-06.1";

    // ── fix round 1, H5: the renamed switch is recorded against its new words, and the old words still allow playback ──

    [Fact]
    public void The_switch_words_version_moved_with_the_rename()
    {
        CurrentConsentWording.VoiceKeepVersion.Should().Be("voice-keep-2026-11-06.1");
        CurrentConsentWording.VoiceKeepVersionBeforeRename.Should().Be("voice-keep-2026-10-30.1");
    }

    [Theory]
    [InlineData("voice-keep-2026-11-06.1", true)]    // the new words
    [InlineData("voice-keep-2026-10-30.1", true)]    // before the rename: same listeners, so an ON given then still plays
    [InlineData(null, false)]                         // pre-L5 / older phone: words unknown
    [InlineData("", false)]
    [InlineData("voice-keep-2026-11-07.1", false)]    // a version nobody ever shipped
    public void Playback_is_allowed_only_for_the_current_or_the_pre_rename_words(string? words, bool allowed)
    {
        CurrentConsentWording.VoiceKeepWordsAllowPlayback(words).Should().Be(allowed);
    }

    // ── UserConsentState: the D-31 words version ─────────────────────────

    [Fact]
    public void A_new_row_has_unknown_words()
    {
        UserConsentState.Create(User).FullHistoryJournalWordingVersion.Should().BeNull();
    }

    [Fact]
    public void Choosing_with_the_words_named_records_those_words()
    {
        var s = UserConsentState.Create(User).Update(true, null, null, 1, null, T0, NewWords);
        s.FullHistoryJournal.Should().BeTrue();
        s.FullHistoryJournalWordingVersion.Should().Be(NewWords);
    }

    [Fact]
    public void Re_making_the_same_choice_under_new_words_records_the_new_words()
    {
        var s = UserConsentState.Create(User).Update(true, null, null, 1, null, T0)
            .Update(true, null, null, 1, null, T0.AddMinutes(1), NewWords);
        s.FullHistoryJournalWordingVersion.Should().Be(NewWords);
    }

    [Fact]
    public void An_older_phone_changing_the_switch_makes_the_words_unknown()
    {
        var s = UserConsentState.Create(User).Update(true, null, null, 1, null, T0, NewWords)
            .Update(false, null, null, 1, null, T0.AddMinutes(1))   // older phone: no words named
            .Update(true, null, null, 1, null, T0.AddMinutes(2));
        s.FullHistoryJournal.Should().BeTrue();
        s.FullHistoryJournalWordingVersion.Should().BeNull(
            "an ON given on a phone that showed the old words cannot vouch for the new ones");
    }

    [Fact]
    public void Saving_other_toggles_without_touching_the_switch_keeps_the_words()
    {
        var s = UserConsentState.Create(User).Update(true, null, null, 1, null, T0, NewWords)
            .Update(true, false, false, 1, null, T0.AddMinutes(1))   // old phone re-sends the same value
            .Update(null, null, true, 1, null, T0.AddMinutes(2));
        s.FullHistoryJournalWordingVersion.Should().Be(NewWords);
    }

    [Fact]
    public void Words_named_without_a_value_for_the_switch_change_nothing()
    {
        var s = UserConsentState.Create(User).Update(null, true, null, 1, null, T0, NewWords);
        s.FullHistoryJournalWordingVersion.Should().BeNull();
    }

    [Fact]
    public void Other_mutators_and_stricter_wins_keep_the_server_words()
    {
        var server = UserConsentState.Create(User).Update(true, null, null, 1, null, T0, NewWords);
        server.EnableVerbatimTrainingCorpus(T0).FullHistoryJournalWordingVersion.Should().Be(NewWords);
        server.OptInEnglishTranslationForAdmin(T0).FullHistoryJournalWordingVersion.Should().Be(NewWords);
        UserConsentState.StricterWins(UserConsentState.Create(User), server)
            .FullHistoryJournalWordingVersion.Should().Be(NewWords);
    }

    // ── UpdateConsentHandler: optional, additive ─────────────────────────

    [Fact]
    public async Task Update_passes_the_words_through_and_the_audit_snapshot_carries_them()
    {
        var repo = new ConsentRepo();
        var handler = new UpdateConsentHandler(repo, new FixedTime(T0));
        var result = await handler.HandleAsync(Command(fullHistory: true, wording: NewWords));

        result.IsSuccess.Should().BeTrue();
        result.Value!.FullHistoryJournalWordingVersion.Should().Be(NewWords);
        repo.State!.FullHistoryJournalWordingVersion.Should().Be(NewWords);
        repo.Audits.Should().ContainSingle().Which.NewStateJson.Should().Contain(NewWords);
    }

    [Fact]
    public async Task Update_from_an_older_phone_without_the_field_still_succeeds()
    {
        var repo = new ConsentRepo();
        var result = await new UpdateConsentHandler(repo, new FixedTime(T0))
            .HandleAsync(Command(fullHistory: true, wording: null));
        result.IsSuccess.Should().BeTrue();
        result.Value!.FullHistoryJournalWordingVersion.Should().BeNull();
    }

    [Fact]
    public async Task Update_refuses_an_oversized_words_version()
    {
        var repo = new ConsentRepo();
        var result = await new UpdateConsentHandler(repo, new FixedTime(T0))
            .HandleAsync(Command(fullHistory: true, wording: new string('v', 61)));
        result.Error.Should().Be(ShramSafalErrors.InvalidCommand);
        repo.State.Should().BeNull();
    }

    // ── GetConsentHandler: notice versions ───────────────────────────────

    [Fact]
    public async Task Get_says_which_notice_is_in_force_and_which_he_accepted()
    {
        var repo = new ConsentRepo { Accepted = Acceptance("notice-2026-10-25.1", T0) };
        var scope = new RecordingScope();
        var result = await new GetConsentHandler(repo, scope).HandleAsync(User);

        result.IsSuccess.Should().BeTrue();
        result.Value!.CurrentNoticeVersion.Should().Be(CurrentConsentWording.NoticeVersion);
        result.Value.AcceptedNoticeVersion.Should().Be("notice-2026-10-25.1");
        result.Value.NoticeAcceptedAtUtc.Should().Be(T0);
        scope.RanFor.Should().Equal(User);
    }

    [Fact]
    public async Task Get_reports_unknown_and_still_succeeds_when_the_ledger_read_fails()
    {
        var repo = new ConsentRepo { Accepted = Acceptance("notice-2026-10-30.1", T0) };
        var result = await new GetConsentHandler(repo, new RecordingScope { Throw = true }).HandleAsync(User);

        result.IsSuccess.Should().BeTrue("every phone back to 1.0.15 reads /consent/me");
        result.Value!.AcceptedNoticeVersion.Should().BeNull("unknown makes a phone ask — never skip");
        result.Value.CurrentNoticeVersion.Should().Be(CurrentConsentWording.NoticeVersion);
    }

    [Fact]
    public async Task Get_without_a_caller_scope_reports_unknown()
    {
        var repo = new ConsentRepo { Accepted = Acceptance("notice-2026-10-30.1", T0) };
        var result = await new GetConsentHandler(repo).HandleAsync(User);
        result.Value!.AcceptedNoticeVersion.Should().BeNull();
    }

    [Fact]
    public async Task Get_carries_the_words_of_the_stored_voice_choice()
    {
        var repo = new ConsentRepo
        {
            State = UserConsentState.Create(User).Update(true, null, null, 1, null, T0, NewWords),
        };
        var result = await new GetConsentHandler(repo, new RecordingScope()).HandleAsync(User);
        result.Value!.FullHistoryJournalWordingVersion.Should().Be(NewWords);
    }

    // ── helpers ──────────────────────────────────────────────────────────

    private static UpdateConsentCommand Command(bool? fullHistory, string? wording) =>
        new(User, fullHistory, null, null, "mr-IN", 1, "1.0.18", "dev", "sha256:x", wording);

    private static TermsAcceptanceEvent Acceptance(string notice, DateTime at) =>
        TermsAcceptanceEvent.LinkToUser(Guid.NewGuid(), new ConsentLedgerFacts(
            UserId: User,
            PreRegistrationSessionId: "session-1",
            NoticeVersion: notice,
            PrivacyPolicyVersion: "privacy-2026-10-30.1",
            TermsVersion: "terms-2026-10-25.1",
            DisplayedLanguage: "mr",
            AcceptedPurposeCodes: "ACCOUNT_AUTHENTICATION",
            DataCategoryCodes: "IDENTITY_AND_CONTACT",
            Source: ConsentRecordSource.App,
            AppVersion: "1.0.18",
            NoticeHash: "sha256:abc"), at);

    private sealed class ConsentRepo : FakeShramSafalRepository, IShramSafalRepository
    {
        public UserConsentState? State { get; set; }
        public TermsAcceptanceEvent? Accepted { get; set; }
        public List<ConsentAuditEntry> Audits { get; } = new();

        Task<UserConsentState?> IShramSafalRepository.GetUserConsentStateAsync(Guid userId, CancellationToken ct)
            => Task.FromResult(State);

        Task IShramSafalRepository.AddUserConsentStateAsync(UserConsentState state, CancellationToken ct)
        {
            State = state;
            return Task.CompletedTask;
        }

        Task IShramSafalRepository.UpdateUserConsentStateAsync(UserConsentState state, CancellationToken ct)
        {
            State = state;
            return Task.CompletedTask;
        }

        Task IShramSafalRepository.AddConsentAuditEntryAsync(ConsentAuditEntry entry, CancellationToken ct)
        {
            Audits.Add(entry);
            return Task.CompletedTask;
        }

        Task<TermsAcceptanceEvent?> IShramSafalRepository.GetLatestNoticeAcceptanceAsync(Guid userId, CancellationToken ct)
            => Task.FromResult(Accepted);

        public override Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class RecordingScope : ICallerUserTenantScope
    {
        public bool Throw { get; init; }
        public List<Guid> RanFor { get; } = new();

        public Task<T> RunForCallerAsync<T>(Guid userId, Func<CancellationToken, Task<T>> work, CancellationToken ct = default)
        {
            RanFor.Add(userId);
            if (Throw) throw new InvalidOperationException("RLS scope could not open");
            return work(ct);
        }
    }

    private sealed class FixedTime(DateTime now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(now);
    }
}
