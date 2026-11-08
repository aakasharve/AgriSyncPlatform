using System.Text.Json.Serialization;
using ShramSafal.Domain.Inputs;

namespace ShramSafal.Application.Contracts.Dtos;

// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT3, Task 2; founder 2026-11-06 "one number score, one place").
// One plot's understanding for one farm-local day, derived on read from that plot's own records. Shown only on the result
// screen, right after the understanding screen: no meter, bar or number goes on the farm overview, and points are never listed.
//
//   PlotId     - the plot (a plot the caller's seat covers).
//   Score0To10 - the plot's /10, or null when the plot has no record that day, the day was declared no-work, or nothing applies
//                (a null is never a zero). Wire name: "score0to10".
//   Understood - what the app understood, one short line per fully understood part (Marathi and English).
//   NextHint   - the single most valuable part still missing: the unearned part with the highest weight (ties: by name), as a
//                line telling him what to say; null when nothing is missing.
//
// The three internal lenses and every dimension weight stay server-side; only the /10 and the words cross.
public sealed record PlotDayUnderstandingDto(
    Guid PlotId,
    [property: JsonPropertyName("score0to10")] int? Score0To10,
    IReadOnlyList<LocalizedText> Understood,
    LocalizedText? NextHint);
