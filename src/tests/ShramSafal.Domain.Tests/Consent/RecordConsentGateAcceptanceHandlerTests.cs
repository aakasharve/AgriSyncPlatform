// spec: dfes-companion-2026-07-11 (wave-4.2)
using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using ShramSafal.Application.UseCases.Consent.RecordConsentGateAcceptance;
using ShramSafal.Domain.Consent;
using ShramSafal.Domain.Tests.Common;
using Xunit;

namespace ShramSafal.Domain.Tests.Consent;

/// <summary>
/// FOUNDER DECISION 17 (2026-08-16) — <b>one visual acceptance button, two separate legal
/// records.</b>
///
/// <para>The load-bearing assertion in this file is the first one: a single tap produces
/// <c>TERMS_ACCEPTED</c> in one ledger AND <c>CORE_DPDP_CONSENT_GRANTED</c> in the other,
/// as two distinct rows with two distinct ids. A blanket "accept everything forever" is
/// not valid consent under DPDP, and one bundled row is that blanket wearing a nicer
/// label: it could not express a withdrawal of consent that leaves the Terms intact.</para>
///
/// <para>The database half of this — append-only by REVOKE, RLS tenant isolation — is
/// proved separately against a real Postgres in
/// <c>ShramSafal.Sync.IntegrationTests/Consent/ConsentGateLedgerRlsTests</c>. A fake
/// repository cannot prove a privilege.</para>
/// </summary>
public sealed class RecordConsentGateAcceptanceHandlerTests
{
    private static readonly DateTime FixedNow = new(2026, 8, 16, 6, 0, 0, DateTimeKind.Utc);
    private const string Notice = "आम्ही तुमची माहिती कशी वापरतो\nनोटीस मजकूर";

    private static RecordConsentGateAcceptanceCommand ValidCommand() => new(
        UserId: null,
        PreRegistrationSessionId: "preauth-abc123",
        NoticeVersion: "notice-2026-08-16.1",
        PrivacyPolicyVersion: "privacy-2026-08-16.1",
        TermsVersion: "terms-2026-08-16.1",
        DisplayedLanguage: "mr",
        AcceptedPurposeCodes: new List<string> { "ACCOUNT_AUTHENTICATION", "FARM_OPERATIONS" },
        DataCategoryCodes: new List<string> { "IDENTITY_AND_CONTACT" },
        Source: "web",
        AppVersion: "1.2.3",
        DisplayedNoticeText: Notice,
        AgeDeclaredAdult: true);

    private static (RecordConsentGateAcceptanceHandler Handler, CapturingRepo Repo) Build()
    {
        var repo = new CapturingRepo();
        return (new RecordConsentGateAcceptanceHandler(repo, new SequentialIds(), new FixedClock(FixedNow)), repo);
    }

    [Fact]
    public async Task One_tap_writes_two_distinct_records_in_two_distinct_ledgers()
    {
        var (handler, repo) = Build();

        var result = await handler.HandleAsync(ValidCommand(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(repo.Terms);
        Assert.NotNull(repo.Grant);
        Assert.Equal("TERMS_ACCEPTED", repo.Terms!.EventType);
        Assert.Equal("CORE_DPDP_CONSENT_GRANTED", repo.Grant!.EventType);
        // Two rows, two ids — not one row wearing two labels.
        Assert.NotEqual(repo.Terms.Id, repo.Grant.Id);
        Assert.Equal(repo.Terms.Id, result.Value.TermsAcceptanceEventId);
        Assert.Equal(repo.Grant.Id, result.Value.ConsentGrantEventId);
        // ONE flush: both land or neither does.
        Assert.Equal(1, repo.SaveCount);
    }

    [Fact]
    public async Task Both_records_preserve_the_same_evidence()
    {
        var (handler, repo) = Build();

        await handler.HandleAsync(ValidCommand(), CancellationToken.None);

        foreach (var (eventType, userId, session, notice, privacy, terms, lang, purposes, categories, source, app, hash, status, at)
                 in new[]
                 {
                     (repo.Terms!.EventType, repo.Terms.UserId, repo.Terms.PreRegistrationSessionId,
                      repo.Terms.NoticeVersion, repo.Terms.PrivacyPolicyVersion, repo.Terms.TermsVersion,
                      repo.Terms.DisplayedLanguage, repo.Terms.AcceptedPurposeCodes, repo.Terms.DataCategoryCodes,
                      repo.Terms.Source, repo.Terms.AppVersion, repo.Terms.NoticeHash, repo.Terms.Status,
                      repo.Terms.RecordedAtUtc),
                     (repo.Grant!.EventType, repo.Grant.UserId, repo.Grant.PreRegistrationSessionId,
                      repo.Grant.NoticeVersion, repo.Grant.PrivacyPolicyVersion, repo.Grant.TermsVersion,
                      repo.Grant.DisplayedLanguage, repo.Grant.AcceptedPurposeCodes, repo.Grant.DataCategoryCodes,
                      repo.Grant.Source, repo.Grant.AppVersion, repo.Grant.NoticeHash, repo.Grant.Status,
                      repo.Grant.RecordedAtUtc),
                 })
        {
            Assert.False(string.IsNullOrWhiteSpace(eventType));
            Assert.Null(userId);                                  // pre-login: no account yet
            Assert.Equal("preauth-abc123", session);              // …so the session id is the join key
            Assert.Equal("notice-2026-08-16.1", notice);
            Assert.Equal("privacy-2026-08-16.1", privacy);
            Assert.Equal("terms-2026-08-16.1", terms);
            Assert.Equal("mr", lang);                             // the language it was READ in
            Assert.Equal("ACCOUNT_AUTHENTICATION,FARM_OPERATIONS", purposes);
            Assert.Equal("IDENTITY_AND_CONTACT", categories);
            Assert.Equal(ConsentRecordSource.Web, source);
            Assert.Equal("1.2.3", app);
            Assert.Equal(ExpectedHash(Notice), hash);
            Assert.Equal(ConsentRecordStatus.Granted, status);
            Assert.Equal(FixedNow, at);                           // SERVER time, not the device's
        }
    }

    [Fact]
    public async Task The_hash_is_of_the_exact_notice_and_changes_when_one_character_does()
    {
        var (handler, repo) = Build();
        await handler.HandleAsync(ValidCommand(), CancellationToken.None);
        var first = repo.Grant!.NoticeHash;

        var (handler2, repo2) = Build();
        await handler2.HandleAsync(
            ValidCommand() with { DisplayedNoticeText = Notice + "." }, CancellationToken.None);

        Assert.NotEqual(first, repo2.Grant!.NoticeHash);
        // Computed here, from the text — never taken on the client's word.
        Assert.Equal(ExpectedHash(Notice + "."), repo2.Grant.NoticeHash);
    }

    [Theory]
    // The 18+ declaration is mandatory: the under-18 policy is one of the six disclosures
    // the founder still owes, so until it lands the only honest posture is to refuse.
    [InlineData("age")]
    [InlineData("session")]
    [InlineData("language")]
    [InlineData("noticeVersion")]
    [InlineData("purposes")]
    [InlineData("categories")]
    [InlineData("noticeText")]
    [InlineData("source")]
    public async Task An_incomplete_or_unattributable_acceptance_writes_nothing(string missing)
    {
        var (handler, repo) = Build();
        var cmd = missing switch
        {
            "age" => ValidCommand() with { AgeDeclaredAdult = false },
            "session" => ValidCommand() with { PreRegistrationSessionId = "  " },
            "language" => ValidCommand() with { DisplayedLanguage = "" },
            "noticeVersion" => ValidCommand() with { NoticeVersion = "" },
            "purposes" => ValidCommand() with { AcceptedPurposeCodes = Array.Empty<string>() },
            "categories" => ValidCommand() with { DataCategoryCodes = Array.Empty<string>() },
            "noticeText" => ValidCommand() with { DisplayedNoticeText = "" },
            // Not defaulted to "web" — where the acceptance happened is a fact on a legal
            // row, and guessing it would put a false fact there.
            "source" => ValidCommand() with { Source = "kiosk" },
            _ => throw new InvalidOperationException(missing),
        };

        var result = await handler.HandleAsync(cmd, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Null(repo.Terms);
        Assert.Null(repo.Grant);
        Assert.Equal(0, repo.SaveCount);
    }

    [Fact]
    public async Task An_absurdly_large_notice_is_refused()
    {
        // The endpoint is anonymous by necessity, so this bound is the only thing between
        // it and a ledger full of megabytes.
        var (handler, repo) = Build();
        var oversized = new string('x', RecordConsentGateAcceptanceHandler.MaxNoticeTextLength + 1);

        var result = await handler.HandleAsync(
            ValidCommand() with { DisplayedNoticeText = oversized }, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(0, repo.SaveCount);
    }

    [Fact]
    public async Task A_signed_in_re_acceptance_is_attributed_to_that_user()
    {
        var (handler, repo) = Build();
        var userId = Guid.NewGuid();

        await handler.HandleAsync(ValidCommand() with { UserId = userId }, CancellationToken.None);

        Assert.Equal(userId, repo.Terms!.UserId);
        Assert.Equal(userId, repo.Grant!.UserId);
    }

    [Fact]
    public void A_withdrawal_is_a_new_row_never_an_edit()
    {
        // Append-only is enforced by privilege in Postgres; this pins the DOMAIN shape
        // that makes the privilege liveable — there is no setter to reach for.
        var facts = new ConsentLedgerFacts(
            Guid.NewGuid(), "preauth-abc123", "notice-1", "privacy-1", "terms-1", "mr",
            "ACCOUNT_AUTHENTICATION", "IDENTITY_AND_CONTACT", ConsentRecordSource.App, "1.2.3", "hash");

        var granted = ConsentGrantEvent.GrantCore(Guid.NewGuid(), facts, FixedNow);
        var withdrawn = ConsentGrantEvent.Record(
            Guid.NewGuid(), ConsentGrantEvent.CoreConsentGrantedEventType, facts,
            ConsentRecordStatus.Withdrawn, FixedNow.AddDays(6));

        Assert.Equal(ConsentRecordStatus.Granted, granted.Status);
        Assert.Equal(ConsentRecordStatus.Withdrawn, withdrawn.Status);
        Assert.NotEqual(granted.Id, withdrawn.Id);
        // "granted on the 16th, withdrawn on the 22nd" — both halves survive.
        Assert.True(withdrawn.RecordedAtUtc > granted.RecordedAtUtc);
    }

    private static string ExpectedHash(string text)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant();

    private sealed class FixedClock(DateTime utcNow) : IClock { public DateTime UtcNow => utcNow; }

    private sealed class SequentialIds : IIdGenerator
    {
        public Guid New() => Guid.NewGuid();
    }

    private sealed class CapturingRepo : FakeShramSafalRepository
    {
        public TermsAcceptanceEvent? Terms { get; private set; }
        public ConsentGrantEvent? Grant { get; private set; }
        public int SaveCount { get; private set; }

        public override Task AddTermsAcceptanceEventAsync(TermsAcceptanceEvent e, CancellationToken ct = default)
        { Terms = e; return Task.CompletedTask; }

        public override Task AddConsentGrantEventAsync(ConsentGrantEvent e, CancellationToken ct = default)
        { Grant = e; return Task.CompletedTask; }

        public override Task SaveChangesAsync(CancellationToken ct = default)
        { SaveCount++; return Task.CompletedTask; }
    }
}
