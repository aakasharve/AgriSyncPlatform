// spec: 2026-08-25-prod-cutover-waves (B1)
using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.UseCases.Consent.LinkConsentGateToUser;
using ShramSafal.Domain.Consent;
using ShramSafal.Domain.Tests.Common;
using Xunit;

namespace ShramSafal.Domain.Tests.Consent;

/// <summary>
/// B1 (founder ruling 2026-08-27, option a) — <b>a pre-login acceptance gets an owner, as a
/// NEW row.</b>
///
/// <para>The defect these tests pin: the consent gate renders only when
/// <c>!isAuthenticated</c>, so the accepting row lands with <c>user_id NULL</c>; the RLS
/// policy requires <c>user_id IS NOT NULL</c> to read and <c>UPDATE</c> is revoked, so the
/// consent was recorded and immediately orphaned — invisible to everyone, unproducible on a
/// DPDP access request, with no error raised anywhere.</para>
///
/// <para>The load-bearing assertions here are the ones about what the linking row is NOT: it
/// is not the accepting row edited, it does not carry the acceptance's timestamp, and it
/// cannot be written without a real account. The DATABASE half — that a linked row is
/// readable by its owner while the orphan is readable by nobody, and that a row naming
/// another user is refused with 42501 — is proved against a real Postgres in
/// <c>ShramSafal.Sync.IntegrationTests/Consent/ConsentGateLedgerRlsTests</c>. A fake
/// repository cannot prove a privilege or a policy.</para>
/// </summary>
public sealed class LinkConsentGateToUserHandlerTests
{
    private static readonly DateTime AcceptedAt = new(2026, 8, 20, 4, 30, 0, DateTimeKind.Utc);
    private static readonly DateTime LinkedAt = new(2026, 8, 27, 9, 15, 0, DateTimeKind.Utc);
    private static readonly Guid Farmer = Guid.Parse("c04e5a7e-0000-0000-0000-00000000000a");
    private const string Session = "preauth-abc123";
    private const string Notice = "आम्ही तुमची माहिती कशी वापरतो\nनोटीस मजकूर";

    private static LinkConsentGateToUserCommand ValidCommand() => new(
        UserId: Farmer,
        PreRegistrationSessionId: Session,
        NoticeVersion: "notice-2026-08-16.1",
        PrivacyPolicyVersion: "privacy-2026-08-16.1",
        TermsVersion: "terms-2026-08-16.1",
        DisplayedLanguage: "mr",
        AcceptedPurposeCodes: new List<string> { "ACCOUNT_AUTHENTICATION", "FARM_OPERATIONS" },
        DataCategoryCodes: new List<string> { "IDENTITY_AND_CONTACT" },
        Source: "web",
        AppVersion: "1.2.3",
        DisplayedNoticeText: Notice);

    private static (LinkConsentGateToUserHandler Handler, CapturingRepo Repo) Build(
        TermsAcceptanceEvent? existingTermsLink = null,
        ConsentGrantEvent? existingGrantLink = null)
    {
        var repo = new CapturingRepo(existingTermsLink, existingGrantLink);
        var handler = new LinkConsentGateToUserHandler(
            repo,
            new SequentialIds(),
            new FixedClock(LinkedAt),
            NullLogger<LinkConsentGateToUserHandler>.Instance);
        return (handler, repo);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // THE FIX — the acceptance now has an owner, in both ledgers.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task A_linking_row_is_written_to_each_ledger_with_the_user_attached()
    {
        var (handler, repo) = Build();

        var result = await handler.HandleAsync(ValidCommand(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(repo.Terms);
        Assert.NotNull(repo.Grant);
        // The whole point: user_id is present. The row it links carries NULL and can
        // never be read by anyone; this one can be read by the farmer it belongs to.
        Assert.Equal(Farmer, repo.Terms!.UserId);
        Assert.Equal(Farmer, repo.Grant!.UserId);
        // Two rows, two ids, two ledgers — a Terms link without the consent link beside it
        // would say the contract is his while the legal basis for his data belongs to nobody.
        Assert.NotEqual(repo.Terms.Id, repo.Grant.Id);
        Assert.Equal(repo.Terms.Id, result.Value.TermsAcceptanceEventId);
        Assert.Equal(repo.Grant.Id, result.Value.ConsentGrantEventId);
        Assert.False(result.Value.AlreadyLinked);
        // ONE flush: both land or neither does.
        Assert.Equal(1, repo.SaveCount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NOT AN EDIT — the linking row is a different KIND of row, and says so.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task The_linking_row_carries_a_different_event_type_from_the_accepting_row()
    {
        var (handler, repo) = Build();

        await handler.HandleAsync(ValidCommand(), CancellationToken.None);

        Assert.Equal("TERMS_ACCEPTANCE_LINKED", repo.Terms!.EventType);
        Assert.Equal("CORE_DPDP_CONSENT_LINKED", repo.Grant!.EventType);
        // Explicitly NOT the accepting types. A reader holding only the data must be able
        // to tell "he agreed" from "we later worked out who he was" — collapsing the two
        // would turn a clerical act into a second act of consent that never happened.
        Assert.NotEqual(TermsAcceptanceEvent.TermsAcceptedEventType, repo.Terms.EventType);
        Assert.NotEqual(ConsentGrantEvent.CoreConsentGrantedEventType, repo.Grant.EventType);
    }

    [Fact]
    public async Task The_linking_row_carries_the_full_facts_not_a_pointer()
    {
        // A foreign key would name a row nothing in this system can dereference: both
        // ledgers are FORCE ROW LEVEL SECURITY and agrisync_admin holds neither rolsuper
        // nor rolbypassrls, so the orphan is unreadable by every role. The linking row has
        // to stand on its own as evidence of what the farmer was shown.
        var (handler, repo) = Build();

        await handler.HandleAsync(ValidCommand(), CancellationToken.None);

        foreach (var (session, notice, privacy, terms, lang, purposes, categories, source, app, hash, status)
                 in new[]
                 {
                     (repo.Terms!.PreRegistrationSessionId, repo.Terms.NoticeVersion,
                      repo.Terms.PrivacyPolicyVersion, repo.Terms.TermsVersion, repo.Terms.DisplayedLanguage,
                      repo.Terms.AcceptedPurposeCodes, repo.Terms.DataCategoryCodes, repo.Terms.Source,
                      repo.Terms.AppVersion, repo.Terms.NoticeHash, repo.Terms.Status),
                     (repo.Grant!.PreRegistrationSessionId, repo.Grant.NoticeVersion,
                      repo.Grant.PrivacyPolicyVersion, repo.Grant.TermsVersion, repo.Grant.DisplayedLanguage,
                      repo.Grant.AcceptedPurposeCodes, repo.Grant.DataCategoryCodes, repo.Grant.Source,
                      repo.Grant.AppVersion, repo.Grant.NoticeHash, repo.Grant.Status),
                 })
        {
            Assert.Equal(Session, session);                       // which acceptance this is about
            Assert.Equal("notice-2026-08-16.1", notice);
            Assert.Equal("privacy-2026-08-16.1", privacy);
            Assert.Equal("terms-2026-08-16.1", terms);
            Assert.Equal("mr", lang);                             // the language it was READ in
            Assert.Equal("ACCOUNT_AUTHENTICATION,FARM_OPERATIONS", purposes);
            Assert.Equal("IDENTITY_AND_CONTACT", categories);
            Assert.Equal(ConsentRecordSource.Web, source);
            Assert.Equal("1.2.3", app);
            // Same digest the accepting row stored — same function, called not re-written,
            // so the two rows can be seen to be about the same words.
            Assert.Equal(ExpectedHash(Notice), hash);
            Assert.Equal(ConsentRecordStatus.Granted, status);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NO BACK-DATING — the link is stamped when the link happened.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task The_linking_row_is_stamped_with_the_link_time_never_the_acceptance_time()
    {
        var (handler, repo) = Build();

        await handler.HandleAsync(ValidCommand(), CancellationToken.None);

        Assert.Equal(LinkedAt, repo.Terms!.RecordedAtUtc);
        Assert.Equal(LinkedAt, repo.Grant!.RecordedAtUtc);
        // The acceptance moment stays on the row that recorded it. Stamping this one with
        // the earlier time would back-date a legal record to make the chain look tidier
        // than it was — and the gap between the two is itself a true fact.
        Assert.NotEqual(AcceptedAt, repo.Terms.RecordedAtUtc);
        Assert.True(repo.Terms.RecordedAtUtc > AcceptedAt);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // REFUSES A NULL USER — at the domain factory, not only at the handler.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public void LinkToUser_refuses_facts_with_no_user()
    {
        var ownerless = FactsFor(userId: null);

        // A linking row with no user attaches nothing to nobody — it would be the defect
        // itself, wearing a fix's clothes. The domain refuses it whatever the caller is.
        Assert.Throws<ArgumentException>(
            () => TermsAcceptanceEvent.LinkToUser(Guid.NewGuid(), ownerless, LinkedAt));
        Assert.Throws<ArgumentException>(
            () => ConsentGrantEvent.LinkToUser(Guid.NewGuid(), ownerless, LinkedAt));
    }

    [Fact]
    public void LinkToUser_accepts_facts_that_name_a_user()
    {
        // The positive half of the guard above — proves the refusal is about the missing
        // user and not about the factory being unusable.
        var owned = FactsFor(Farmer);

        var terms = TermsAcceptanceEvent.LinkToUser(Guid.NewGuid(), owned, LinkedAt);
        var grant = ConsentGrantEvent.LinkToUser(Guid.NewGuid(), owned, LinkedAt);

        Assert.Equal(Farmer, terms.UserId);
        Assert.Equal(Farmer, grant.UserId);
    }

    [Fact]
    public async Task A_command_with_an_empty_user_writes_nothing()
    {
        // The handler's own guard: an outcome, not an exception, because the application
        // asks for outcomes (doctrine E2).
        var (handler, repo) = Build();

        var result = await handler.HandleAsync(
            ValidCommand() with { UserId = Guid.Empty }, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Null(repo.Terms);
        Assert.Null(repo.Grant);
        Assert.Equal(0, repo.SaveCount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INCOMPLETE EVIDENCE IS REFUSED — the linking row must answer "what was he shown?"
    // on its own, because the row it links cannot be read to fill in the blanks.
    // ─────────────────────────────────────────────────────────────────────────
    [Theory]
    [InlineData("session")]
    [InlineData("language")]
    [InlineData("noticeVersion")]
    [InlineData("privacyVersion")]
    [InlineData("termsVersion")]
    [InlineData("appVersion")]
    [InlineData("purposes")]
    [InlineData("categories")]
    [InlineData("noticeText")]
    [InlineData("source")]
    public async Task An_incomplete_link_writes_nothing(string missing)
    {
        var (handler, repo) = Build();
        var cmd = missing switch
        {
            "session" => ValidCommand() with { PreRegistrationSessionId = "  " },
            "language" => ValidCommand() with { DisplayedLanguage = "" },
            "noticeVersion" => ValidCommand() with { NoticeVersion = "" },
            "privacyVersion" => ValidCommand() with { PrivacyPolicyVersion = "" },
            "termsVersion" => ValidCommand() with { TermsVersion = "" },
            "appVersion" => ValidCommand() with { AppVersion = "" },
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

    // ─────────────────────────────────────────────────────────────────────────
    // RETRYABLE, NOT BLOCKING (doctrine P9) — a repeat call writes nothing and
    // still succeeds, so the client can keep retrying until it lands.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task A_repeat_link_writes_nothing_and_returns_the_same_two_ids()
    {
        var facts = FactsFor(Farmer);
        var alreadyTerms = TermsAcceptanceEvent.LinkToUser(Guid.NewGuid(), facts, LinkedAt);
        var alreadyGrant = ConsentGrantEvent.LinkToUser(Guid.NewGuid(), facts, LinkedAt);
        var (handler, repo) = Build(alreadyTerms, alreadyGrant);

        var result = await handler.HandleAsync(ValidCommand(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.AlreadyLinked);
        Assert.Equal(alreadyTerms.Id, result.Value.TermsAcceptanceEventId);
        Assert.Equal(alreadyGrant.Id, result.Value.ConsentGrantEventId);
        // Nothing appended. These ledgers have UPDATE, DELETE and TRUNCATE revoked, so a
        // duplicate written on a retry would be permanent noise in a legal record.
        Assert.Null(repo.Terms);
        Assert.Null(repo.Grant);
        Assert.Equal(0, repo.SaveCount);
    }

    [Fact]
    public async Task A_half_linked_account_converges_on_the_missing_ledger_only()
    {
        // Both rows are flushed together, so this should not arise — but "linked in BOTH
        // ledgers" is the post-condition that matters, and an account stuck half-linked
        // must be able to finish rather than be told it is already done.
        var facts = FactsFor(Farmer);
        var alreadyTerms = TermsAcceptanceEvent.LinkToUser(Guid.NewGuid(), facts, LinkedAt);
        var (handler, repo) = Build(alreadyTerms, existingGrantLink: null);

        var result = await handler.HandleAsync(ValidCommand(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.AlreadyLinked);
        Assert.Null(repo.Terms);                                  // not written again
        Assert.NotNull(repo.Grant);                               // the missing half, written
        Assert.Equal(alreadyTerms.Id, result.Value.TermsAcceptanceEventId);
        Assert.Equal(repo.Grant!.Id, result.Value.ConsentGrantEventId);
        Assert.Equal(1, repo.SaveCount);
    }

    [Fact]
    public async Task The_idempotency_read_is_keyed_on_the_caller_and_the_session()
    {
        // Not on the user alone: one device can pass the gate more than once (a reinstall
        // mints a new session id), and each acceptance deserves its own link.
        var (handler, repo) = Build();

        await handler.HandleAsync(ValidCommand(), CancellationToken.None);

        Assert.Equal(Farmer, repo.AskedForUserId);
        Assert.Equal(Session, repo.AskedForSessionId);
    }

    private static ConsentLedgerFacts FactsFor(Guid? userId) => new(
        userId, Session, "notice-2026-08-16.1", "privacy-2026-08-16.1", "terms-2026-08-16.1",
        "mr", "ACCOUNT_AUTHENTICATION,FARM_OPERATIONS", "IDENTITY_AND_CONTACT",
        ConsentRecordSource.Web, "1.2.3", ExpectedHash(Notice));

    private static string ExpectedHash(string text)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant();

    private sealed class FixedClock(DateTime utcNow) : IClock { public DateTime UtcNow => utcNow; }

    private sealed class SequentialIds : IIdGenerator
    {
        public Guid New() => Guid.NewGuid();
    }

    private sealed class CapturingRepo(
        TermsAcceptanceEvent? existingTermsLink,
        ConsentGrantEvent? existingGrantLink) : FakeShramSafalRepository
    {
        public TermsAcceptanceEvent? Terms { get; private set; }
        public ConsentGrantEvent? Grant { get; private set; }
        public int SaveCount { get; private set; }
        public Guid? AskedForUserId { get; private set; }
        public string? AskedForSessionId { get; private set; }

        public override Task AddTermsAcceptanceEventAsync(TermsAcceptanceEvent e, CancellationToken ct = default)
        { Terms = e; return Task.CompletedTask; }

        public override Task AddConsentGrantEventAsync(ConsentGrantEvent e, CancellationToken ct = default)
        { Grant = e; return Task.CompletedTask; }

        public override Task<TermsAcceptanceEvent?> FindTermsAcceptanceLinkAsync(
            Guid userId, string preRegistrationSessionId, CancellationToken ct = default)
        {
            AskedForUserId = userId;
            AskedForSessionId = preRegistrationSessionId;
            return Task.FromResult(existingTermsLink);
        }

        public override Task<ConsentGrantEvent?> FindConsentGrantLinkAsync(
            Guid userId, string preRegistrationSessionId, CancellationToken ct = default)
            => Task.FromResult(existingGrantLink);

        public override Task SaveChangesAsync(CancellationToken ct = default)
        { SaveCount++; return Task.CompletedTask; }
    }
}
