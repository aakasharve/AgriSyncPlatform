namespace ShramSafal.Domain.Common;

/// <summary>
/// wave-3.12, spec Ruling 5 (2026-08-15) — <b>every number remembers how sure the farmer
/// was.</b>
///
/// <para><b>Certainty is a DIFFERENT AXIS from provenance (doctrine P8).</b> Provenance
/// says how the system came by a value — spoken, confirmed, derived, assumed. Certainty
/// says how sure the FARMER was of it. "अंदाजे ५०० मिली" is spoken AND approximate; the two
/// are orthogonal and neither may be overloaded to carry the other. That is why this is a
/// separate enum on separate columns and not a fifth member of <c>FieldProvenance</c>.</para>
///
/// <para><b>Certainty belongs to each NUMBER, not to the log.</b> A farmer can be exact
/// about the wage he paid and vague about the dose in the same sentence, so it is stored
/// beside the number it qualifies — the dose on an input item, the water on an irrigation
/// entry, the cost on a labour or machinery row.</para>
///
/// <para><b>NULL means "not asked, not stated"</b> — every column carrying this is
/// nullable, and every row written before wave-3.12 has NULL. It is never defaulted to
/// <see cref="Reported"/>: claiming a farmer was confident about a number nobody asked him
/// about is exactly the fabrication doctrine P4 forbids.</para>
///
/// <para><b><see cref="Unknown"/> never becomes zero.</b> "आठवत नाही" persists as Unknown
/// with a NULL amount. It must never produce a <c>CostEntry</c> either —
/// <c>CostEntry.Create</c> throws on <c>amount &lt;= 0</c>, so the certainty columns are
/// the only place an unknown cost can honestly live.</para>
/// </summary>
public enum NumericCertainty
{
    /// <summary>He stated the number plainly, with no hedge. The ordinary case.</summary>
    Reported = 0,

    /// <summary>He explicitly marked it an estimate — "अंदाजे", "साधारण", "जवळपास".</summary>
    Approximate = 1,

    /// <summary>He said he does not remember. There is NO numeric value, and none is invented.</summary>
    Unknown = 2,
}
