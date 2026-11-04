using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.UseCases.Labour.WorkerIdentity;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Identity;
using ShramSafal.Domain.Labour;
using Xunit;

namespace ShramSafal.Domain.Tests.Identity;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID (founder D-54 FINAL). The pure rules of a worker's
/// ShramSafal identity: the card code (R6), the phone number and home PIN (R11, R12), whose PIN another farm may see
/// (R10), the verified-number lifecycle (R3), one-time codes, merge and erasure (R8), and the level ladder.
/// </summary>
public sealed class WorkerIdentityDomainTests
{
    private static readonly Guid FarmA = Guid.Parse("aaaaaaaa-0000-4000-8000-00000000000a");
    private static readonly Guid FarmB = Guid.Parse("bbbbbbbb-0000-4000-8000-00000000000b");
    private static readonly Guid Owner = Guid.Parse("11111111-1111-4111-8111-111111111111");
    private static readonly DateTime At = new(2026, 11, 2, 9, 0, 0, DateTimeKind.Utc);

    // ── the card code (R6) ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_new_card_code_is_eight_characters_of_the_card_alphabet_and_random()
    {
        var codes = Enumerable.Range(0, 2000).Select(_ => ShramCardCode.NewBody()).ToList();
        Assert.All(codes, c => Assert.Matches("^[0-9A-HJKMNP-TV-Z]{8}$", c));
        Assert.Equal(codes.Count, codes.Distinct().Count());
    }

    [Theory]
    [InlineData("SS-7K4M-29QX", "7K4M29QX")]
    [InlineData("ss 7k4m 29qx", "7K4M29QX")]
    [InlineData("7K4M29QX", "7K4M29QX")]
    [InlineData("https://shramsafal.in/w/SS-7K4M-29QX", "7K4M29QX")]
    [InlineData("shramsafal.in/w/7k4m-29qx", "7K4M29QX")]
    [InlineData("SS-7K4M-29QO", "7K4M29Q0")]
    [InlineData("SS-7K4M-29IL", "7K4M2911")]
    public void Every_form_of_a_scanned_or_typed_code_reads_as_the_same_code(string input, string body)
        => Assert.Equal(body, ShramCardCode.Normalize(input));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("SS-7K4M")]
    [InlineData("SS-7K4M-29QX-1")]
    [InlineData("SS-7K4M-29QU")]
    [InlineData("रमेश पाटील")]
    [InlineData("9876543210")]
    public void Anything_that_is_not_a_card_code_reads_as_none(string? input)
        => Assert.Null(ShramCardCode.Normalize(input));

    [Fact]
    public void The_QR_holds_only_the_shramsafal_address_and_the_code()
    {
        Assert.Equal("https://shramsafal.in/w/SS-7K4M-29QX", ShramCardCode.QrPayload("7K4M29QX"));
        Assert.Equal("SS-7K4M-29QX", ShramCardCode.Display("7K4M29QX"));
    }

    // ── the phone number and the home PIN ───────────────────────────────────────────────────────

    [Theory]
    [InlineData("6000000101", "+916000000101")]
    [InlineData("+91 60000 00101", "+916000000101")]
    [InlineData("916000000101", "+916000000101")]
    [InlineData("06000000101", "+916000000101")]
    [InlineData("98xxx xx412", null)]
    [InlineData("5000000101", null)]
    [InlineData("600000010", null)]
    [InlineData("", null)]
    public void An_Indian_mobile_number_is_plus_91_and_ten_digits_starting_6_to_9(string input, string? e164)
        => Assert.Equal(e164, IndianMobile.Normalize(input));

    [Theory]
    [InlineData("413304", "413304")]
    [InlineData(" 413 304 ", "413304")]
    [InlineData("013304", null)]
    [InlineData("41330", null)]
    [InlineData("4133045", null)]
    [InlineData("41330a", null)]
    public void A_home_PIN_is_six_digits_and_never_starts_with_zero(string input, string? pin)
        => Assert.Equal(pin, HomePinCode.Normalize(input));

    // ── the person: PIN (R10), merge, erasure (R8) ─────────────────────────────────────────────

    [Fact]
    public void His_PIN_is_seen_and_changed_only_by_the_farm_that_recorded_it()
    {
        var person = ShramPerson.Create(Guid.NewGuid(), "रमेश पाटील", Owner, At);
        Assert.Equal(PinOutcome.Set, person.SetHomePin("413304", FarmA));
        Assert.Equal("413304", person.PinVisibleTo(FarmA));
        Assert.Null(person.PinVisibleTo(FarmB));

        Assert.Equal(PinOutcome.HeldElsewhere, person.SetHomePin("411001", FarmB));
        Assert.Equal("413304", person.HomePinCode);

        Assert.Equal(PinOutcome.Unchanged, person.SetHomePin("413304", FarmA));
        Assert.Equal(PinOutcome.Set, person.SetHomePin("411001", FarmA));
        Assert.Equal("411001", person.PinVisibleTo(FarmA));
    }

    [Fact]
    public void A_merge_keeps_both_ids_and_can_be_undone()
    {
        var a = ShramPerson.Create(Guid.NewGuid(), "रमेश", Owner, At);
        var b = ShramPerson.Create(Guid.NewGuid(), "रमेश पाटील", Owner, At);
        Assert.Throws<InvalidOperationException>(() => a.MergeInto(a.Id));
        a.MergeInto(b.Id);
        Assert.Equal(b.Id, a.MergedIntoPersonId);
        Assert.Throws<InvalidOperationException>(() => a.MergeInto(b.Id));
        a.Unmerge();
        Assert.Null(a.MergedIntoPersonId);
        Assert.Throws<InvalidOperationException>(() => a.Unmerge());
    }

    [Fact]
    public void Erasure_waits_keeps_the_first_date_can_be_cancelled_and_then_anonymises_the_person()
    {
        var person = ShramPerson.Create(Guid.NewGuid(), "रमेश पाटील", Owner, At);
        person.SetHomePin("413304", FarmA);
        Assert.True(person.RequestErasure(Owner, At));
        Assert.True(person.RequestErasure(Owner, At.AddDays(3)));
        Assert.Equal(At, person.ErasureRequestedAtUtc);
        Assert.True(person.CancelErasure());
        Assert.Null(person.ErasureRequestedAtUtc);
        Assert.False(person.CancelErasure());

        person.RequestErasure(Owner, At);
        person.Anonymise(At.AddDays(30));
        Assert.Equal(ShramPerson.ErasedName, person.CardName);
        Assert.Null(person.HomePinCode);
        Assert.True(person.IsErased);
        Assert.False(person.CancelErasure());
        Assert.False(person.RequestErasure(Owner, At));
        Assert.Throws<InvalidOperationException>(() => person.SetHomePin("413304", FarmA));
    }

    // ── a phone: verified, released, erased (R3, R8) ───────────────────────────────────────────

    [Fact]
    public void A_phone_is_proved_released_with_its_history_kept_and_erased_without_its_number()
    {
        var phone = ShramPersonPhone.Add(Guid.NewGuid(), Guid.NewGuid(), "6000000101", PhoneWhose.Family, FarmA, At);
        Assert.Equal("+916000000101", phone.PhoneE164);
        Assert.True(phone.IsActive);
        Assert.False(phone.IsActiveVerified);

        phone.MarkVerified(At);
        Assert.True(phone.IsActiveVerified);

        phone.Release(At.AddDays(1));
        Assert.False(phone.IsActive);
        Assert.Equal(At, phone.VerifiedAtUtc);
        Assert.Throws<InvalidOperationException>(() => phone.MarkVerified(At.AddDays(2)));

        phone.Erase(At.AddDays(3));
        Assert.Null(phone.PhoneE164);
        Assert.Equal(At.AddDays(1), phone.ReleasedAtUtc);

        Assert.Throws<ArgumentException>(() => ShramPersonPhone.Add(Guid.NewGuid(), Guid.NewGuid(), "12345", PhoneWhose.Own, FarmA, At));
    }

    // ── a card: issued, retired, never reissued ────────────────────────────────────────────────

    [Fact]
    public void A_card_is_issued_with_a_valid_code_and_retired_once()
    {
        Assert.Throws<ArgumentException>(() => ShramCard.Issue("SS-7K4M-29QX", Guid.NewGuid(), FarmA, At));
        var card = ShramCard.Issue("7K4M29QX", Guid.NewGuid(), FarmA, At);
        Assert.True(card.IsActive);
        card.Retire(At.AddDays(1), "ABCD2345");
        card.Retire(At.AddDays(2), "ZZZZ2345");
        Assert.False(card.IsActive);
        Assert.Equal(At.AddDays(1), card.RetiredAtUtc);
        Assert.Equal("ABCD2345", card.ReplacedByCode);
    }

    // ── a one-time code ────────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_code_proves_only_its_purpose_counts_wrong_tries_expires_and_is_spent_once()
    {
        var code = ShramPhoneChallenge.NewCode();
        Assert.Matches("^[0-9]{4}$", code);
        var wrong = code == "0000" ? "1111" : "0000";

        var challenge = ShramPhoneChallenge.Issue(Guid.NewGuid(), Guid.NewGuid(), "6000000101", ChallengePurpose.Verify, FarmA, Owner, code, At);
        Assert.NotEqual(code, challenge.CodeHash);
        Assert.Equal(ChallengeOutcome.WrongPurpose, challenge.TryConsume(code, ChallengePurpose.Link, At));
        Assert.Equal(ChallengeOutcome.Wrong, challenge.TryConsume(wrong, ChallengePurpose.Verify, At));
        Assert.Equal(ChallengeOutcome.Ok, challenge.TryConsume(code, ChallengePurpose.Verify, At.AddMinutes(1)));
        Assert.Equal(ChallengeOutcome.Spent, challenge.TryConsume(code, ChallengePurpose.Verify, At.AddMinutes(2)));

        var late = ShramPhoneChallenge.Issue(Guid.NewGuid(), Guid.NewGuid(), "6000000101", ChallengePurpose.Verify, FarmA, Owner, code, At);
        Assert.Equal(ChallengeOutcome.Expired, late.TryConsume(code, ChallengePurpose.Verify, At + ShramPhoneChallenge.Lifetime + TimeSpan.FromSeconds(1)));

        var guessed = ShramPhoneChallenge.Issue(Guid.NewGuid(), Guid.NewGuid(), "6000000101", ChallengePurpose.Verify, FarmA, Owner, code, At);
        for (var i = 0; i < ShramPhoneChallenge.MaxAttempts; i++)
        {
            Assert.Equal(ChallengeOutcome.Wrong, guessed.TryConsume(wrong, ChallengePurpose.Verify, At));
        }

        Assert.Equal(ChallengeOutcome.TooManyTries, guessed.TryConsume(code, ChallengePurpose.Verify, At));
    }

    // ── the farm record and the farm ───────────────────────────────────────────────────────────

    [Fact]
    public void Attaching_a_person_to_a_farm_record_changes_only_which_person_it_is()
    {
        var record = FieldOperator.Create(Guid.NewGuid(), "बाळू", "वरची वाडी", new FarmId(FarmA), new UserId(Owner), At);
        Assert.Null(record.PersonId);
        var person = Guid.NewGuid();
        record.AttachPerson(person);
        Assert.Equal(person, record.PersonId);
        Assert.Equal("बाळू", record.DisplayName);
        Assert.Equal("वरची वाडी", record.FullName);
        Assert.Throws<ArgumentException>(() => record.AttachPerson(Guid.Empty));
    }

    [Fact]
    public void A_farm_PIN_is_recorded_once_when_the_owner_says_so_and_never_overwritten()
    {
        var farm = Farm.Create(new FarmId(FarmA), "पाटील शेत", new UserId(Owner), At);
        Assert.Null(farm.PinCode);
        Assert.Throws<ArgumentException>(() => farm.RecordPinCodeOnce("013304", At));
        Assert.True(farm.RecordPinCodeOnce("413304", At));
        Assert.False(farm.RecordPinCodeOnce("411001", At));
        Assert.Equal("413304", farm.PinCode);
    }

    // ── the level ladder ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void His_level_is_card_on_add_phone_verified_once_proved_and_name_once_erased()
    {
        var person = ShramPerson.Create(Guid.NewGuid(), "रमेश पाटील", Owner, At);
        var group = new WorkerIdentityProjection.PersonGroup(person, [person]);
        var card = ShramCard.Issue("7K4M29QX", person.Id, FarmA, At);
        var phone = ShramPersonPhone.Add(Guid.NewGuid(), person.Id, "6000000101", PhoneWhose.Own, FarmA, At);

        Assert.Equal(IdentityLevel.Name, WorkerIdentityProjection.LevelOf(group, [], []));
        Assert.Equal(IdentityLevel.Card, WorkerIdentityProjection.LevelOf(group, [card], [phone]));
        phone.MarkVerified(At);
        Assert.Equal(IdentityLevel.PhoneVerified, WorkerIdentityProjection.LevelOf(group, [card], [phone]));
        person.Anonymise(At);
        Assert.Equal(IdentityLevel.Name, WorkerIdentityProjection.LevelOf(group, [card], [phone]));
    }

    [Fact]
    public void Farm_B_is_shown_his_level_but_never_farm_As_number_or_PIN()
    {
        var person = ShramPerson.Create(Guid.NewGuid(), "रमेश पाटील", Owner, At);
        person.SetHomePin("413304", FarmA);
        var group = new WorkerIdentityProjection.PersonGroup(person, [person]);
        var card = ShramCard.Issue("7K4M29QX", person.Id, FarmA, At);
        var phone = ShramPersonPhone.Add(Guid.NewGuid(), person.Id, "6000000101", PhoneWhose.Own, FarmA, At);
        var inA = FieldOperator.Create(Guid.NewGuid(), "रमेश पाटील", null, new FarmId(FarmA), new UserId(Owner), At);
        var inB = FieldOperator.Create(Guid.NewGuid(), "रमेश", null, new FarmId(FarmB), new UserId(Owner), At);

        var a = WorkerIdentityProjection.ViewFor(inA, group, FarmA, [card], [phone]);
        Assert.Equal(("0101", "413304", "Own", false), (a.PhoneTail, a.HomePin, a.PhoneWhose, a.NeedsPhoneAndPin));

        var b = WorkerIdentityProjection.ViewFor(inB, group, FarmB, [card], [phone]);
        Assert.Equal((null, null, null), (b.PhoneTail, b.HomePin, b.PhoneWhose));
        Assert.False(b.NeedsPhoneAndPin);
        Assert.Equal("SS-7K4M-29QX", b.CardCode);
        Assert.Equal("Card", b.IdentityLevel);
    }

    [Fact]
    public void A_name_only_worker_needs_his_phone_and_PIN()
    {
        var person = ShramPerson.Create(Guid.NewGuid(), "बाळू", Owner, At);
        var group = new WorkerIdentityProjection.PersonGroup(person, [person]);
        var record = FieldOperator.Create(Guid.NewGuid(), "बाळू", null, new FarmId(FarmA), new UserId(Owner), At);
        var card = ShramCard.Issue("7K4M29QX", person.Id, FarmA, At);
        Assert.True(WorkerIdentityProjection.ViewFor(record, group, FarmA, [card], []).NeedsPhoneAndPin);
        Assert.True(WorkerIdentityProjection.ViewFor(record, null, FarmA, [], []).NeedsPhoneAndPin);
    }

    [Fact]
    public void An_identity_event_names_its_farm_and_its_person()
    {
        Assert.Throws<ArgumentException>(() => ShramIdentityEvent.Record(
            Guid.NewGuid(), Guid.Empty, null, Guid.NewGuid(), IdentityEventKind.Linked, IdentityProof.CardShown, Owner, At));
        var e = ShramIdentityEvent.Record(
            Guid.NewGuid(), FarmA, Guid.NewGuid(), Guid.NewGuid(), IdentityEventKind.Unlinked, IdentityProof.OwnerConfirms, Owner, At,
            otherPersonId: Guid.NewGuid(), reversesEventId: Guid.NewGuid());
        Assert.Equal(IdentityEventKind.Unlinked, e.Kind);
        Assert.NotNull(e.ReversesEventId);
    }
}
