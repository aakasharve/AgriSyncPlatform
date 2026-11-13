// spec: plr-d10-redesign-real-integration-2026-10-25 - lane CMP-D3 (founder D-68 round 2): the reason kept on a record of work, without a database.
// The entity's own rules, the three kinds on the wire, and the work key the compare read shows (the one the write checks).
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Compare;

public sealed class LogPracticeReasonTests
{
    private static readonly DateTime Now = new(2026, 11, 13, 6, 0, 0, DateTimeKind.Utc);
    private static readonly FarmId Farm = new(Guid.Parse("3d030000-0000-4000-8000-0000000000a1"));
    private static readonly UserId Author = new(Guid.Parse("3d030000-0000-4000-8000-000000000011"));
    private static readonly Guid Log = Guid.Parse("3d030000-0000-4000-8000-000000000031");

    private static LogPracticeReason Make(
        string key = "work:op_tying", LogReasonKind kind = LogReasonKind.Weather, string? words = "पाऊस", bool voice = false,
        Guid? id = null, Guid? supersedes = null) =>
        LogPracticeReason.Create(id ?? Guid.NewGuid(), Farm, Log, key, kind, words, voice, Author, Now, supersedes);

    // ---- the three kinds ------------------------------------------------------------------------------------------

    [Theory]
    [InlineData("Practice", LogReasonKind.Practice)]
    [InlineData("Extra", LogReasonKind.Extra)]
    [InlineData("Weather", LogReasonKind.Weather)]
    public void The_three_kinds_parse_by_their_exact_words_and_round_trip(string wire, LogReasonKind kind)
    {
        Assert.True(LogReasonKindWire.TryParse(wire, out var parsed));
        Assert.Equal(kind, parsed);
        Assert.Equal(wire, LogReasonKindWire.ToWire(kind));
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData(null)]
    [InlineData("practice")]
    [InlineData("WEATHER")]
    [InlineData("Weather ")]
    [InlineData("Other")]
    [InlineData("1")]
    public void Nothing_else_is_a_kind(string? wire) => Assert.False(LogReasonKindWire.TryParse(wire, out _));

    [Fact]
    public void A_kind_outside_the_enum_cannot_be_put_on_the_wire_or_into_a_row()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => LogReasonKindWire.ToWire((LogReasonKind)9));
        Assert.Throws<ArgumentException>(() => Make(kind: (LogReasonKind)9));
        Assert.Throws<ArgumentException>(() => Make(kind: default));
    }

    // ---- the row's own rules --------------------------------------------------------------------------------------

    [Fact]
    public void A_reason_keeps_what_it_was_given_trimmed_and_utc()
    {
        var id = Guid.NewGuid();
        var supersedes = Guid.NewGuid();
        var r = Make(" work:op_tying ", LogReasonKind.Extra, "  जास्त तण  ", voice: true, id: id, supersedes: supersedes);
        Assert.Equal(id, r.Id);
        Assert.Equal(Farm, r.FarmId);
        Assert.Equal(Log, r.DailyLogId);
        Assert.Equal("work:op_tying", r.WorkKey);
        Assert.Equal(LogReasonKind.Extra, r.Kind);
        Assert.Equal("जास्त तण", r.Words);
        Assert.True(r.SaidByVoice);
        Assert.Equal(Author, r.AuthorUserId);
        Assert.Equal(supersedes, r.SupersedesId);
        Assert.Equal(DateTimeKind.Utc, r.CreatedAtUtc.Kind);
    }

    [Fact]
    public void Blank_words_are_no_words_and_a_voice_flag_without_words_is_not_said_by_voice()
    {
        foreach (var blank in new string?[] { null, "", "   " })
        {
            var r = Make(words: blank, voice: true);
            Assert.Null(r.Words);
            Assert.False(r.SaidByVoice, "nothing was said, so nothing was said by voice");
        }
    }

    [Fact]
    public void Words_are_limited_to_1000_characters_and_the_work_key_to_100()
    {
        Assert.Equal(1000, Make(words: new string('क', 1000)).Words!.Length);
        Assert.Throws<ArgumentException>(() => Make(words: new string('क', 1001)));
        Assert.Equal(100, Make(key: new string('k', 100)).WorkKey.Length);
        Assert.Throws<ArgumentException>(() => Make(key: new string('k', 101)));
        Assert.Throws<ArgumentException>(() => Make(key: ""));
        Assert.Throws<ArgumentException>(() => Make(key: "   "));
        Assert.Equal(1000, LogPracticeReason.MaxWordsLength);
        Assert.Equal(100, LogPracticeReason.MaxWorkKeyLength);
    }

    [Fact]
    public void Every_id_is_required_and_a_reason_cannot_supersede_itself()
    {
        Assert.Throws<ArgumentException>(() => Make(id: Guid.Empty));
        Assert.Throws<ArgumentException>(() => LogPracticeReason.Create(Guid.NewGuid(), default, Log, "work", LogReasonKind.Practice, null, false, Author, Now, null));
        Assert.Throws<ArgumentException>(() => LogPracticeReason.Create(Guid.NewGuid(), Farm, Guid.Empty, "work", LogReasonKind.Practice, null, false, Author, Now, null));
        Assert.Throws<ArgumentException>(() => LogPracticeReason.Create(Guid.NewGuid(), Farm, Log, "work", LogReasonKind.Practice, null, false, default, Now, null));
        var same = Guid.NewGuid();
        Assert.Throws<ArgumentException>(() => Make(id: same, supersedes: same));
    }

    [Fact]
    public void A_reason_has_no_quantity_and_no_member_that_can_change_it_after_it_is_made()
    {
        var type = typeof(LogPracticeReason);
        Assert.All(
            type.GetProperties(),
            p => Assert.True(p.SetMethod is null || !p.SetMethod.IsPublic, $"{p.Name} has a public setter: a reason is append-only (P3)"));
        var names = type.GetProperties().Select(p => p.Name).ToHashSet();
        Assert.DoesNotContain(names, n => n.Contains("Quantity", StringComparison.OrdinalIgnoreCase) || n.Contains("Amount", StringComparison.OrdinalIgnoreCase));
    }

    // ---- the work key ---------------------------------------------------------------------------------------------

    [Fact]
    public void The_key_of_nothing_and_of_unreadable_words_is_unrecognised()
    {
        Assert.Equal("unrecognised", CompareWorkKey.Unrecognised);
        Assert.Equal("unrecognised", CompareWorkKey.Of(null));
        Assert.Equal("unrecognised", CompareWorkKey.OfWords(null));
        Assert.Equal("unrecognised", CompareWorkKey.OfWords(""));
        Assert.Equal("unrecognised", CompareWorkKey.OfWords("   "));
        Assert.Equal("unrecognised", CompareWorkKey.OfWords("zxqv wlmk"));
    }

    [Fact]
    public void The_key_of_words_is_the_key_of_what_the_recogniser_reads_and_fits_the_column()
    {
        foreach (var words in new[] { "वेली बांधणी", "बुरशीनाशक फवारणी", "ठिबक सिंचन", "बोरॉन फवारणी", "जीए (संजीवक) बुडवणी" })
        {
            var identity = WorkRecogniser.Recognise(words);
            Assert.NotNull(identity);
            var key = CompareWorkKey.OfWords(words);
            Assert.Equal(CompareWorkKey.Of(identity), key);
            Assert.NotEqual(CompareWorkKey.Unrecognised, key);
            Assert.True(key.Length <= LogPracticeReason.MaxWorkKeyLength, $"'{key}' fits varchar(100)");
        }

        Assert.StartsWith("spray", CompareWorkKey.OfWords("बुरशीनाशक फवारणी"));
        Assert.StartsWith("irrigation", CompareWorkKey.OfWords("ठिबक सिंचन"));
        Assert.NotEqual(CompareWorkKey.OfWords("बुरशीनाशक फवारणी"), CompareWorkKey.OfWords("कीटकनाशक फवारणी"));
    }

    // ---- what the compare read says ---------------------------------------------------------------------------------

    [Fact]
    public void The_served_reason_is_exactly_its_kind_its_words_and_whether_they_were_spoken()
    {
        var dto = typeof(LogReasonDto);
        Assert.Equal(new[] { "Kind", "SaidByVoice", "Words" }, dto.GetProperties().Select(p => p.Name).OrderBy(n => n, StringComparer.Ordinal).ToArray());
        var own = typeof(OwnWorkDto).GetProperty(nameof(OwnWorkDto.Reason))!;
        Assert.Equal(typeof(LogReasonDto), own.PropertyType);
    }
}
