namespace ShramSafal.Domain.Dfes;

/// <summary>
/// Lane DFES-Q (founder, via the schedule-making session, 2026-11-21) — the eight reasons a farmer can tap when Sathi asks why a
/// schedule task whose window has fully passed was not done. Codes are stored; the Marathi labels live on the phone, exactly as
/// the founder gave them: पाऊस आला / औषध मिळालं नाही / मजूर मिळाले नाहीत / पैसे कमी पडले / वेळ गेली-विसरलो /
/// दुकानदार किंवा तज्ज्ञाने वेगळं सांगितलं / केलं, पण नोंद केली नाही / दुसरं काही.
/// </summary>
public static class DeviationReasons
{
    public static readonly IReadOnlySet<string> Codes = new HashSet<string>(StringComparer.Ordinal)
    {
        "rain",
        "input_unavailable",
        "labour_unavailable",
        "money_short",
        "time_forgot",
        "advised_otherwise",
        "done_not_logged",
        "other",
    };

    /// <summary>The longest challenge ("अडचण") kept, in characters.</summary>
    public const int MaxChallengeLength = 1000;

    public static bool IsKnown(string? code) => code is not null && Codes.Contains(code);
}
