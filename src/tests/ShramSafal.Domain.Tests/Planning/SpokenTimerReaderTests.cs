// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 16, "voice fills the timer")
// The golden cases of the deterministic reader of the farmer's own words: what he says becomes ONE of the three timers a work holds
// (a day, after a work, when seen), with the exact words it was read from; anything unclear returns nothing - never a guess, never a default.
using FluentAssertions;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class SpokenTimerReaderTests
{
    [Fact]
    public void After_a_work_and_when_seen_together_keep_the_after_a_work_the_shape_holds_one_timer()
    {
        var timer = SpokenTimerReader.Read("पेस्टनंतर आठ दिवसांनी, फूट दिसली की");

        timer.Should().NotBeNull();
        timer!.Kind.Should().Be(ScheduleTimerKind.After);
        timer.AfterWorkWords.Should().Be("पेस्ट");
        timer.UsualDays.Should().Be(8);
        timer.HeardWords.Should().Be("पेस्टनंतर आठ दिवसांनी");
        timer.FromDay.Should().BeNull();
        timer.SignWords.Should().BeNull();
    }

    [Theory]
    [InlineData("पेस्टनंतर ८ दिवसांनी", "पेस्टनंतर ८ दिवसांनी")]
    [InlineData("पेस्टनंतर 8 दिवसांनी", "पेस्टनंतर 8 दिवसांनी")]
    [InlineData("फवारणी झाली. पेस्टनंतर आठ दिवसांनी.", "पेस्टनंतर आठ दिवसांनी")]
    public void After_a_work_reads_Devanagari_digits_Latin_digits_and_words(string said, string heard)
    {
        var timer = SpokenTimerReader.Read(said);

        timer.Should().NotBeNull();
        timer!.Kind.Should().Be(ScheduleTimerKind.After);
        timer.AfterWorkWords.Should().Be("पेस्ट");
        timer.UsualDays.Should().Be(8);
        timer.HeardWords.Should().Be(heard);
    }

    [Theory]
    [InlineData("दहाव्या दिवशी", 9)]
    [InlineData("आठव्या दिवशी", 7)]
    [InlineData("पहिल्या दिवशी", 0)]
    [InlineData("नवव्या दिवशी", 8)]
    [InlineData("साठाव्या दिवशी", 59)]
    [InlineData("१०व्या दिवशी", 9)]
    public void A_day_counted_from_the_start_is_stored_one_less_than_the_day_he_reads(string said, int storedDay)
    {
        var timer = SpokenTimerReader.Read(said);

        timer.Should().NotBeNull();
        timer!.Kind.Should().Be(ScheduleTimerKind.Day);
        timer.FromDay.Should().Be(storedDay);
        timer.HeardWords.Should().Be(said);
    }

    [Theory]
    [InlineData("छाटणीनंतर पंधरा दिवसांनी", 15)]
    [InlineData("छाटणीनंतर दहा दिवसांनी", 10)]
    [InlineData("छाटणीनंतर १५ दिवसांनी", 15)]
    [InlineData("छाटणीनंतर साठ दिवसांनी", 60)]
    public void N_days_after_pruning_is_the_stored_day_N(string said, int storedDay)
    {
        var timer = SpokenTimerReader.Read(said);

        timer.Should().NotBeNull();
        timer!.Kind.Should().Be(ScheduleTimerKind.Day);
        timer.FromDay.Should().Be(storedDay);
        timer.AfterWorkWords.Should().BeNull();
        timer.HeardWords.Should().Be(said);
    }

    [Theory]
    [InlineData("फूट दिसली की", "फूट")]
    [InlineData("फुटवे दिसताच", "फुटवे")]
    [InlineData("फूट दिसल्यावर", "फूट")]
    public void When_seen_keeps_the_words_of_the_sign(string said, string sign)
    {
        var timer = SpokenTimerReader.Read(said);

        timer.Should().NotBeNull();
        timer!.Kind.Should().Be(ScheduleTimerKind.Sign);
        timer.SignWords.Should().Be(sign);
        timer.HeardWords.Should().Be(said);
        timer.FromDay.Should().BeNull();
        timer.UsualDays.Should().BeNull();
    }

    [Theory]
    [InlineData("एक", 1)]
    [InlineData("दोन", 2)]
    [InlineData("तीन", 3)]
    [InlineData("चार", 4)]
    [InlineData("पाच", 5)]
    [InlineData("सहा", 6)]
    [InlineData("सात", 7)]
    [InlineData("आठ", 8)]
    [InlineData("नऊ", 9)]
    [InlineData("दहा", 10)]
    [InlineData("अकरा", 11)]
    [InlineData("बारा", 12)]
    [InlineData("पंधरा", 15)]
    [InlineData("वीस", 20)]
    [InlineData("एकवीस", 21)]
    [InlineData("पंचवीस", 25)]
    [InlineData("तीस", 30)]
    [InlineData("चाळीस", 40)]
    [InlineData("पन्नास", 50)]
    [InlineData("साठ", 60)]
    public void Marathi_number_words_one_to_sixty_are_read(string word, int number)
    {
        var timer = SpokenTimerReader.Read($"पेस्टनंतर {word} दिवसांनी");

        timer.Should().NotBeNull();
        timer!.UsualDays.Should().Be(number);
    }

    [Theory]
    [InlineData("दोन तीन दिवसांनी")]
    [InlineData("पेस्टनंतर दोन तीन दिवसांनी")]
    [InlineData("पेस्टनंतर आठ ते दहा दिवसांनी")]
    [InlineData("पेस्टनंतर ८-१० दिवसांनी")]
    [InlineData("पेस्टनंतर सुमारे आठ दिवसांनी")]
    [InlineData("लवकर")]
    [InlineData("पुढच्या आठवड्यात")]
    [InlineData("थोड्या दिवसांनी")]
    [InlineData("पेस्टनंतर थोड्या दिवसांनी")]
    [InlineData("आठ दिवसांनी")]
    [InlineData("पेस्टनंतर एकसष्ठ दिवसांनी")]
    [InlineData("पेस्टनंतर आठ दिवसांनी आणि खतानंतर दहा दिवसांनी")]
    [InlineData("फूट दिसली की आणि कळी दिसली की")]
    [InlineData("छाटणीनंतर दहा दिवसांनी, पेस्टनंतर आठ दिवसांनी")]
    [InlineData("आज पाणी दिलं")]
    [InlineData("   ")]
    [InlineData("")]
    [InlineData(null)]
    public void Anything_unclear_returns_nothing(string? said)
    {
        SpokenTimerReader.Read(said).Should().BeNull();
    }
}
