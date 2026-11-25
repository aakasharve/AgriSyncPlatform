// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12, "ShramSathi asks from the schedule"; CTO rulings askOnlyWithSource, ownExperienceIsLabelled)
using System.Linq;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

/// <summary>
/// Which of a task's questions ShramSathi may ask, and what each stands on. Pure: the rules the server applies to the task of the schedule a plot follows or to the
/// plot's own works (the real-Postgres proof is <c>SathiAsksFromScheduleRealPostgresTests</c>).
/// </summary>
public sealed class TaskQuestionLinesTests
{
    private static ScheduleTaskContent Task(
        ScheduleBasis basis, ScheduleSource[]? sources = null, ScheduleTaskLook? look = null, ScheduleTaskAsk? ask = null, string key = "t-look") =>
        new(key, "फुलोरा तपासणी", ScheduleTaskKind.Observe, ScheduleTaskTiming.OnDays(40), basis, 0, 0, Sources: sources, Look: look, Ask: ask);

    private static readonly ScheduleTaskLook SomeLook = new(Sign: "फुलोऱ्याची कळी उघडलेली");

    // ---- askOnlyWithSource ----------------------------------------------------------------------------------------

    [Fact]
    public void askOnlyWithSource_a_reference_task_that_names_no_document_is_never_asked()
    {
        Assert.Null(TaskQuestionLines.SourcesOf(Task(ScheduleBasis.Stated), TaskWorkKind.Reference));
        Assert.Null(TaskQuestionLines.SourcesOf(Task(ScheduleBasis.Stated, [new ScheduleSource("  ", "5")]), TaskWorkKind.Reference));
    }

    [Fact]
    public void askOnlyWithSource_a_reference_task_that_cannot_claim_the_experience_label_even_when_its_basis_says_experience()
    {
        // The label "your experience" belongs to the farmer's own hand-made work only.
        Assert.Null(TaskQuestionLines.SourcesOf(Task(ScheduleBasis.Experience), TaskWorkKind.Reference));
    }

    [Theory]
    [InlineData(ScheduleBasis.OurChoice)]
    [InlineData(ScheduleBasis.Assumed)]
    public void askOnlyWithSource_our_own_choice_and_an_assumption_are_not_a_source_even_with_a_document(ScheduleBasis basis)
    {
        var task = Task(basis, [new ScheduleSource("book-on-grape-2023", "71")]);

        Assert.Null(TaskQuestionLines.SourcesOf(task, TaskWorkKind.Reference));
        Assert.Null(TaskQuestionLines.SourcesOf(task, TaskWorkKind.OwnByHand));
    }

    [Fact]
    public void askOnlyWithSource_a_reference_task_with_a_document_stands_on_exactly_that_document_and_page()
    {
        var sources = TaskQuestionLines.SourcesOf(
            Task(ScheduleBasis.Stated, [new ScheduleSource("gap-table-grapes-2013", "19"), new ScheduleSource("book-on-grape-2023", null)]), TaskWorkKind.Reference);

        Assert.NotNull(sources);
        Assert.Equal(["gap-table-grapes-2013 p19", "book-on-grape-2023 p"], sources!.Select(s => $"{s.Document} p{s.Page}").ToArray());
    }

    // ---- ownExperienceIsLabelled ----------------------------------------------------------------------------------

    [Fact]
    public void ownExperienceIsLabelled_a_hand_made_work_with_no_document_is_asked_and_its_source_is_the_farmers_own_experience()
    {
        var sources = TaskQuestionLines.SourcesOf(Task(ScheduleBasis.Experience), TaskWorkKind.OwnByHand);

        var only = Assert.Single(sources!);
        Assert.Equal(TaskQuestionLines.OwnExperienceDocument, only.Document);
        Assert.Equal(string.Empty, only.Page);
        // never a book, an institution or ShramSafal
        Assert.DoesNotContain("shramsafal", only.Document, System.StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("gap-", only.Document, System.StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ownExperienceIsLabelled_a_hand_made_work_that_states_a_document_keeps_that_document_not_the_experience_label()
    {
        var sources = TaskQuestionLines.SourcesOf(Task(ScheduleBasis.Experience, [new ScheduleSource("शेजारच्या शेतकऱ्याची वही", "2")]), TaskWorkKind.OwnByHand);

        Assert.Equal("शेजारच्या शेतकऱ्याची वही", Assert.Single(sources!).Document);
    }

    [Fact]
    public void ownExperienceIsLabelled_a_hand_made_work_not_written_as_experience_and_with_no_document_is_not_asked()
    {
        Assert.Null(TaskQuestionLines.SourcesOf(Task(ScheduleBasis.Stated), TaskWorkKind.OwnByHand));
    }

    [Fact]
    public void a_taken_work_keeps_the_source_of_the_task_it_was_taken_from_and_is_never_labelled_as_own_experience()
    {
        var withCopy = TaskQuestionLines.SourcesOf(Task(ScheduleBasis.Stated, [new ScheduleSource("gap-table-grapes-2013", "20")]), TaskWorkKind.OwnTaken);
        var fromOrigin = TaskQuestionLines.SourcesOf(Task(ScheduleBasis.Stated), TaskWorkKind.OwnTaken, [new ScheduleSource("gap-table-grapes-2013", "20")]);
        var nothing = TaskQuestionLines.SourcesOf(Task(ScheduleBasis.Experience), TaskWorkKind.OwnTaken);

        Assert.Equal("gap-table-grapes-2013", Assert.Single(withCopy!).Document);
        Assert.Equal("gap-table-grapes-2013", Assert.Single(fromOrigin!).Document);
        Assert.Null(nothing); // a taken work whose origin names no source is not relabelled as his own experience
    }

    // ---- the line ids and the words -----------------------------------------------------------------------------------

    [Theory]
    [InlineData("task:t-look:look", "t-look", TaskQuestionPart.Look)]
    [InlineData("task:flower.1:ask", "flower.1", TaskQuestionPart.Ask)]
    public void a_line_names_the_task_and_which_of_its_two_questions(string line, string key, TaskQuestionPart part)
    {
        Assert.True(TaskQuestionLines.TryParse(line, out var parsedKey, out var parsedPart));
        Assert.Equal(key, parsedKey);
        Assert.Equal(part, parsedPart);
        Assert.Equal(line, TaskQuestionLines.LineId(key, part));
    }

    [Theory]
    [InlineData("grapes-table-oct-fruit-pruning/sprout.0")]
    [InlineData("task:t-look")]
    [InlineData("task::look")]
    [InlineData("task:bad key:look")]
    [InlineData("task:t:what")]
    [InlineData("")]
    public void anything_else_is_not_a_task_line(string line) => Assert.False(TaskQuestionLines.TryParse(line, out _, out _));

    [Fact]
    public void a_task_with_no_words_for_a_question_has_nothing_to_ask()
    {
        var onlyLook = Task(ScheduleBasis.Stated, look: SomeLook);
        var onlyAsk = Task(ScheduleBasis.Stated, ask: new ScheduleTaskAsk("कळ्या फुटल्या का?"));

        Assert.True(TaskQuestionLines.HasWords(onlyLook, TaskQuestionPart.Look));
        Assert.False(TaskQuestionLines.HasWords(onlyLook, TaskQuestionPart.Ask));
        Assert.True(TaskQuestionLines.HasWords(onlyAsk, TaskQuestionPart.Ask));
        Assert.False(TaskQuestionLines.HasWords(onlyAsk, TaskQuestionPart.Look));
        Assert.False(TaskQuestionLines.HasWords(Task(ScheduleBasis.Stated, look: new ScheduleTaskLook(Where: "द्राक्षवेल")), TaskQuestionPart.Look));
    }
}
