using ShramSafal.Application.Ports.External;

namespace ShramSafal.Infrastructure.AI.Dfes;

/// <summary>
/// Lane DFES-Q — the source resolver until Shram Safal's own published schedule is embedded in the server (the Schedule Maker's
/// output, plan Task 2). It resolves nothing, so every question that states agronomy is refused: fail closed, never a question
/// without a source. Replaced by the schedule-backed resolver when the schedule lands.
/// </summary>
internal sealed class NoScheduleSourceResolver : IQuestionSourceResolver
{
    public IReadOnlyList<QuestionSourceRef>? Resolve(IReadOnlyList<string> lookLineIds) => null;
}
