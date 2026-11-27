// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S1) - the pure rules of a person's own identity card.
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using User.Domain.Identity;
using Xunit;

namespace UserIdentityTests;

public sealed class IdentityRulesTests
{
    [Theory]
    [InlineData("पूर्वेश चंद्रशेखर आरवे")]
    [InlineData("र‍या पाटील")] // the joiner Marathi writing uses
    [InlineData("सौ. सुनीता-ताई")]
    public void A_Marathi_name_of_Marathi_letters_is_accepted(string name) => IdentityRules.IsMarathiName(name).Should().BeTrue();

    [Theory]
    [InlineData("Ravi Patil")]
    [InlineData("रवी Patil")]
    [InlineData("रवी 2")]
    [InlineData(" . - ")]
    public void A_Marathi_name_with_other_letters_or_no_letter_is_not(string name) => IdentityRules.IsMarathiName(name).Should().BeFalse();

    [Theory]
    [InlineData("Purvesh Chandrashekhar Arve")]
    [InlineData("D'Souza-Pinto Jr.")]
    [InlineData("José")]
    public void An_English_name_of_English_letters_is_accepted(string name) => IdentityRules.IsEnglishName(name).Should().BeTrue();

    [Theory]
    [InlineData("रवी पाटील")]
    [InlineData("Ravi2")]
    [InlineData("Ravi_Patil")]
    public void An_English_name_with_other_characters_is_not(string name) => IdentityRules.IsEnglishName(name).Should().BeFalse();

    [Theory]
    [InlineData("रमेश पाटील", "deva")]
    [InlineData("Ramesh Patil", "latn")]
    [InlineData("रमेश Patil", "other")]
    [InlineData("123", "other")]
    public void The_full_name_script_is_reported_and_never_guessed(string name, string tag) => IdentityRules.ScriptTag(name).Should().Be(tag);

    [Theory]
    [InlineData("413304", "413304")]
    [InlineData("४१३३०४", "413304")]
    [InlineData(" 413 304 ", "413304")]
    [InlineData("012345", null)]
    [InlineData("4133", null)]
    [InlineData("41330a", null)]
    [InlineData("", null)]
    public void A_PIN_is_six_ASCII_digits_not_starting_with_zero(string typed, string? stored) =>
        IdentityRules.NormalizePin(typed).Should().Be(stored);

    [Theory]
    [InlineData(" 1234-AB 9 ", "1234-AB 9")]
    [InlineData("१२३४५६७८९०१", "12345678901")]
    [InlineData("", "")]
    [InlineData("AB#12", null)]
    [InlineData("123456789012345678901234567890123", null)]
    public void A_Farmer_ID_keeps_digits_letters_spaces_and_dashes_up_to_32(string typed, string? stored) =>
        IdentityRules.NormalizeFarmerId(typed).Should().Be(stored);

    [Fact]
    public void The_app_version_is_kept_to_32_characters_and_nothing_when_blank()
    {
        IdentityRules.AppVersionOf(" 1.0.19 ").Should().Be("1.0.19");
        IdentityRules.AppVersionOf(new string('9', 40)).Should().HaveLength(32);
        IdentityRules.AppVersionOf("  ").Should().BeNull();
    }

    [Fact]
    public void Each_save_moves_the_version_on_and_the_Farmer_ID_stays_Unverified()
    {
        var card = UserIdentityProfile.Start(new UserId(Guid.NewGuid()));
        card.Version.Should().Be(0);
        var now = new DateTime(2026, 11, 27, 9, 0, 0, DateTimeKind.Utc);
        var values = new IdentityValues(
            new IdentityName("पूर्वेश", NameBasis.Typed), null, "123", new IdentityPlace(944182, "पंढरपूर", "Pandharpur", PlaceBasis.List),
            null, null, "lgd-mh-2026-11-26", new IdentityPin("413304", PinBasis.FromVillageList));

        card.Apply(values, now, "1.0.19");
        card.Apply(values with { FarmerId = null }, now.AddMinutes(1), null);

        card.Version.Should().Be(2);
        card.FarmerIdStatus.Should().Be(FarmerIdStatus.Unverified);
        card.Values.Should().Be(values with { FarmerId = null }, "a whole replace: what is not sent is cleared");
        card.UpdatedAppVersion.Should().BeNull();
    }

    [Theory]
    [MemberData(nameof(BrokenCards))]
    public void A_card_that_breaks_a_rule_is_never_applied(IdentityValues values)
    {
        var card = UserIdentityProfile.Start(new UserId(Guid.NewGuid()));

        var act = () => card.Apply(values, DateTime.UtcNow, null);

        act.Should().Throw<ArgumentException>();
        card.Version.Should().Be(0);
    }

    public static IEnumerable<object[]> BrokenCards() =>
    [
        [IdentityValues.None with { NameMr = new IdentityName("Ravi", NameBasis.Typed) }],
        [IdentityValues.None with { NameEn = new IdentityName("रवी", NameBasis.Typed) }],
        [IdentityValues.None with { Village = new IdentityPlace(null, null, "Pandharpur", PlaceBasis.List) }],
        [IdentityValues.None with { Village = new IdentityPlace(944182, null, "Pandharpur", PlaceBasis.NotInList) }],
        [IdentityValues.None with { Taluka = new IdentityPlace(4249, null, null, PlaceBasis.List) }],
        [IdentityValues.None with { Pin = new IdentityPin("012345", PinBasis.Typed) }],
        [IdentityValues.None with { FarmerId = "AB#12" }],
    ];
}
