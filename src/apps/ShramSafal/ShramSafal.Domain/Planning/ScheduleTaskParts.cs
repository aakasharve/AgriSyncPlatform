namespace ShramSafal.Domain.Planning;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 2, "Task format and three timers"; approved spec plr-d10-schedule-approved-spec-2026-11-23)
// The parts a schedule task is made of. All of them are plain, immutable values: the task's CONTENT (ScheduleTaskContent) is what the content hash
// covers, and every part below is a field of it, so nothing here can be left out of the hash by accident.

/// <summary>A refused task, challenge or stage sign: a stable code and the words that say why (English, for the staff console).</summary>
public sealed record ScheduleTaskProblem(string Code, string Message);

/// <summary>What kind of work a task is (the five kinds of the approved design: a separate card for each).</summary>
public enum ScheduleTaskKind
{
    Irrigation = 0,
    Nutrition = 1,
    Spray = 2,
    Work = 3,
    Observe = 4,
}

/// <summary>
/// P8, provenance over precision: WHY a value is what it is, recorded beside the value. <see cref="Stated"/> = a source states it;
/// <see cref="OurChoice"/> = ShramSafal's own call where sources disagree or are silent; <see cref="Experience"/> = a grower's practice;
/// <see cref="Assumed"/> = a placeholder nobody has confirmed. A reader never shows an assumed value as a stated one.
/// </summary>
public enum ScheduleBasis
{
    Stated = 0,
    OurChoice = 1,
    Experience = 2,
    Assumed = 3,
}

/// <summary>One product a task uses, exactly as the source writes it. Nothing here is converted or computed (P4).</summary>
/// <param name="Name">The product, as farmers say it (1..200).</param>
/// <param name="DoseAsWritten">The dose in the source's own words ("३०–४० मिली"), never parsed into a number.</param>
/// <param name="Unit">The unit when the source gives it apart from the dose.</param>
/// <param name="PerWhat">Per litre, per acre, per vine: the source's own base for the dose.</param>
/// <param name="Water">How much water, as written.</param>
public sealed record ScheduleProduct(
    string Name,
    string? DoseAsWritten = null,
    string? Unit = null,
    string? PerWhat = null,
    string? Water = null);

/// <summary>Where a line comes from: a document and where in it (a page, or a week of an advisory).</summary>
public sealed record ScheduleSource(string Document, string? Page = null);

/// <summary>One "if this, then that" the source gives (weather, soil, vigour, a symptom seen).</summary>
public sealed record ScheduleIfThen(string If, string Then);

/// <summary>What to look at after the work: where, how many to look at, what to see, the limit that matters, the if-thens, and a picture to compare with.</summary>
public sealed record ScheduleTaskLook(
    string? Where = null,
    string? Sample = null,
    string? Sign = null,
    string? Threshold = null,
    IReadOnlyList<ScheduleIfThen>? IfThen = null,
    string? PhotoRef = null);

/// <summary>One answer to a question, and what that answer changes (the answer is a code such as <c>yes</c> / <c>no</c>, never words).</summary>
public sealed record ScheduleAnswer(string Answer, string Changes);

/// <summary>The one question a task asks (when it asks it, and what each answer changes). It never refuses a save and never decides by itself.</summary>
public sealed record ScheduleTaskAsk(string Question, string? When = null, IReadOnlyList<ScheduleAnswer>? Answers = null);

/// <summary>The sign a stage starts or ends on, for one stage of a version (by its position, first stage = 0). Words, or absent.</summary>
public sealed record ScheduleStageSign(int StageIndex, string? StartSign = null, string? EndSign = null);
