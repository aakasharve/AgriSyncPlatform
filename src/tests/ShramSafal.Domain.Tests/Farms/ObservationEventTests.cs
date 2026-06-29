using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

public sealed class ObservationEventTests
{
    private static readonly Guid Log = Guid.Parse("77777777-7777-7777-7777-777777777777");

    [Fact]
    public void Create_sets_all_fields()
    {
        var id = Guid.NewGuid();
        var plot = Guid.NewGuid();
        var activity = Guid.NewGuid();
        var when = new DateTime(2025, 10, 19, 6, 30, 0, DateTimeKind.Utc);

        var obs = ObservationEvent.Create(
            id, Log, plotId: plot,
            noteType: ObservationNoteType.Issue,
            severity: ObservationSeverity.Important,
            source: ObservationSource.Voice,
            textRaw: "पानावर तांबडे डाग दिसले",
            textCleaned: "leaf rust spots observed",
            tagsJson: "[\"leaf\",\"rust\"]",
            linkedActivityId: activity,
            createdAtUtc: when);

        Assert.Equal(id, obs.Id);
        Assert.Equal(Log, obs.DailyLogId);
        Assert.Equal(plot, obs.PlotId);
        Assert.Equal(ObservationNoteType.Issue, obs.NoteType);
        Assert.Equal(ObservationSeverity.Important, obs.Severity);
        Assert.Equal(ObservationSource.Voice, obs.Source);
        Assert.Equal("पानावर तांबडे डाग दिसले", obs.TextRaw);
        Assert.Equal("leaf rust spots observed", obs.TextCleaned);
        Assert.Equal("[\"leaf\",\"rust\"]", obs.TagsJson);
        Assert.Equal(activity, obs.LinkedActivityId);
        Assert.Equal(when, obs.CreatedAtUtc);
    }

    [Fact]
    public void Create_accepts_null_optionals()
    {
        var obs = ObservationEvent.Create(
            Guid.NewGuid(), Log, plotId: null,
            noteType: ObservationNoteType.Observation,
            severity: ObservationSeverity.Normal,
            source: ObservationSource.Manual,
            textRaw: "watered the field",
            textCleaned: null,
            tagsJson: null,
            linkedActivityId: null,
            createdAtUtc: DateTime.UtcNow);

        Assert.Null(obs.PlotId);
        Assert.Null(obs.TextCleaned);
        Assert.Null(obs.TagsJson);
        Assert.Null(obs.LinkedActivityId);
        Assert.Equal("watered the field", obs.TextRaw);   // free-text always present
        Assert.Equal(ObservationNoteType.Observation, obs.NoteType);
        Assert.Equal(ObservationSeverity.Normal, obs.Severity);
        Assert.Equal(ObservationSource.Manual, obs.Source);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Create_throws_on_blank_textRaw(string blank)
    {
        Assert.Throws<ArgumentException>(() => ObservationEvent.Create(
            Guid.NewGuid(), Log, plotId: null,
            noteType: ObservationNoteType.Observation,
            severity: ObservationSeverity.Normal,
            source: ObservationSource.Manual,
            textRaw: blank,
            textCleaned: null,
            tagsJson: null,
            linkedActivityId: null,
            createdAtUtc: DateTime.UtcNow));
    }

    [Fact]
    public void Create_trims_textRaw()
    {
        var obs = ObservationEvent.Create(
            Guid.NewGuid(), Log, plotId: null,
            noteType: ObservationNoteType.Tip,
            severity: ObservationSeverity.Normal,
            source: ObservationSource.Manual,
            textRaw: "  leaf curl  ",
            textCleaned: null,
            tagsJson: null,
            linkedActivityId: null,
            createdAtUtc: DateTime.UtcNow);

        Assert.Equal("leaf curl", obs.TextRaw);
    }
}
