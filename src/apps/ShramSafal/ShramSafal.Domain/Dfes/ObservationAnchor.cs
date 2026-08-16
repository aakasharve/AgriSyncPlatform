namespace ShramSafal.Domain.Dfes;

/// <summary>
/// wave-3.11, founder decision 15 (2026-08-16) — <b>a filler answer earns zero extra,
/// never negative.</b>
///
/// <para><b>The founder's words:</b> "we are expecting clarity from the farmer, reward is
/// the anchor or hook — don't create a strict gate." Gate D is therefore CLOSED: there is
/// no bar the farmer can fail. Combined with ruling 22 ("it must preserve or improve,
/// nothing to take back") and founder decision 6 (monotonic non-decreasing, no
/// exceptions), the only shape this rule may take is: an unanchored answer ADDS NOTHING.
/// It may never subtract, and doctrine P7 is why — answering must never shrink the
/// number, because that punishes the farmer for being helpful.</para>
///
/// <para><b>What the rule actually is.</b> A real noticing names something observable
/// AND says something about its state or change. The three filler strings the founder
/// gave — <c>"ठीक आहे"</c>, <c>"काही नाही"</c>, <c>"सगळं बरोबर"</c> — are two-word
/// verdicts about the whole day; they name nothing to look at. The four real noticings
/// he gave carry a subject and a predicate about it, including a SPECIFIC "no change"
/// (<c>"कालचे डाग आज वाढले नाहीत."</c>), which is a genuine observation and is credited
/// as one.</para>
///
/// <para><b>Why the test is STRUCTURAL and ships no Marathi word list.</b> The plan's
/// first form of this rule matched a subject vocabulary against a state vocabulary. Those
/// lists are farmer-facing agronomic content and carry the same founder + agronomist
/// review gate as question copy (precedent: <c>{weather}</c> is excluded from the bank's
/// allowed token set for exactly this reason). Shipping an unreviewed Marathi keyword list
/// in code is not an option, so the rule is expressed with no vocabulary at all: a
/// minimum LENGTH (unchanged, <see cref="MinimumTextLength"/>) plus a minimum number of
/// WORDS. That is language-neutral, needs no agronomic review, and separates all seven of
/// the founder's own examples correctly. When the vocabularies come back approved they
/// refine this method; until then nothing unreviewed reaches a farmer.</para>
///
/// <para><b>Where it may be applied — and only there.</b> ONLY to an observation that
/// arrived as the ANSWER to a question (<c>ObservationEvent.SourceQuestionId is not
/// null</c>). A noticing the farmer VOLUNTEERED keeps <see cref="MinimumTextLength"/>
/// exactly as it has always been, so no existing day can lose a point. See
/// <c>DfesLensExtractor</c>'s call sites, which additionally run this under wave-3.5's
/// <c>appliesNewRules</c> version guard.</para>
///
/// <para><b>What happens to an unanchored answer.</b> It is PRESERVED, honestly — as the
/// raw response on <c>ssf.question_events</c> (append-only, KEEP on erasure — see
/// <c>QuestionEvent</c>) and, since the wave-3.11 wiring, as an <c>ObservationEvent</c> on
/// the log the question was about, carrying his words verbatim and stamped with the
/// question's id. Nothing about it is fabricated and nothing is discarded; it simply earns
/// no OBSERVATION credit. The farmer is not told it was insufficient and no second question
/// is asked that day. No new table, no new column.</para>
/// </summary>
public static class ObservationAnchor
{
    /// <summary>
    /// The content floor that has always governed a noticing — an empty or one-word note
    /// is never credited just because a row exists. Unchanged by this task, and it is
    /// what a VOLUNTEERED observation continues to be judged by.
    /// </summary>
    public const int MinimumTextLength = 8;

    /// <summary>
    /// A noticing names a thing and says something about it. Two words is a verdict
    /// ("it's fine", "nothing", "all correct"); three is the smallest utterance that can
    /// carry a subject and a statement about its state or change. Deliberately the
    /// weakest structural bar that separates the founder's own filler examples from his
    /// own real ones — decision 15 forbids a strict gate.
    /// </summary>
    private const int MinimumWords = 3;

    /// <summary>
    /// True when <paramref name="text"/> reads as an anchored noticing rather than filler.
    /// Null, blank, too short or too few words all return false — and false means
    /// "earns nothing extra", never "loses something".
    /// </summary>
    public static bool IsAnchored(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return false;

        var trimmed = text.AsSpan().Trim();
        return trimmed.Length >= MinimumTextLength && CountWords(trimmed) >= MinimumWords;
    }

    /// <summary>
    /// Words separated by whitespace or punctuation. Devanagari matras, anusvara and
    /// virama are combining marks rather than punctuation, so they never split a word;
    /// the danda (U+0964) is punctuation, so it ends one. No language-specific table.
    /// </summary>
    private static int CountWords(ReadOnlySpan<char> text)
    {
        var words = 0;
        var inWord = false;

        foreach (var c in text)
        {
            if (char.IsWhiteSpace(c) || char.IsPunctuation(c) || char.IsSeparator(c))
            {
                inWord = false;
                continue;
            }

            if (!inWord)
            {
                words++;
                inWord = true;
            }
        }

        return words;
    }
}
