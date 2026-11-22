namespace ShramSafal.Application.Ports.External;

/// <summary>
/// Lane DFES-Q (founder D-B, D-G, 2026-11-21) — turns the look-line ids a phone says it used into the sources those lines carry
/// in Shram Safal's OWN published schedule (never a PDF, never a phone's claim). Implemented in Infrastructure over the embedded
/// schedule the Schedule Maker publishes.
/// </summary>
public interface IQuestionSourceResolver
{
    /// <summary>
    /// The sources of every line, or <c>null</c> when the list is empty, ANY id is unknown, or any line carries no source or is
    /// marked as the schedule's own choice. All or nothing: one unknown line rejects the question (fail closed).
    /// </summary>
    IReadOnlyList<QuestionSourceRef>? Resolve(IReadOnlyList<string> lookLineIds);
}

/// <summary>One source of one look line: the line, the document and the page.</summary>
public sealed record QuestionSourceRef(string LineId, string DocId, string Page);
