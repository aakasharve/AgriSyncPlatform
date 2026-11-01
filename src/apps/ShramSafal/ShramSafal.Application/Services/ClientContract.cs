namespace ShramSafal.Application.Services;

/// <summary>
/// lane MU-3 fix 2 (N1; doctrine P4 / P11) — WHICH INSTALLED PHONE CAN SHOW A WITHHELD PAY. Fix 1 sends a job card's
/// rates and payout, and a worker page's earnings, as <c>null</c> to a seat that does not see wages, and the new phone
/// shows "नियमानुसार दिसत नाही" in their place. An installed 1.0.17 phone draws that null as a number
/// (<c>Math.round(null)</c> = "INR 0" / "0k": <c>JobCardRow.tsx:139</c>, <c>JobCardDetailPage.tsx:282,297</c>,
/// <c>WorkerProfilePage.tsx:157</c> at <c>b3d28967</c>) — a made-up ₹0. So a phone is answered with withheld pay only
/// when it says (<c>X-App-Version</c>) it is newer than 1.0.17; any other caller — 1.0.17 or older, a malformed
/// version, or none (1.0.17's job-card and worker-page calls send no version header at all) — gets what
/// <c>edee6667</c> gave a seat that may not read the pay: a refusal, which 1.0.17 shows as its own honest "could not
/// load", never as ₹0.
/// </summary>
public static class ClientContract
{
    /// <summary>The first app version that shows a withheld pay as withheld (W3) instead of drawing it as 0.</summary>
    public static readonly Version FirstVersionShowingWithheldPay = new(1, 0, 18);

    /// <summary>
    /// Does a phone that reports <paramref name="appVersion"/> show a withheld pay as withheld? Only a well-formed
    /// version (1 to 4 groups of digits, as the phone's own <c>appVersion.ts</c> reads them) at or after
    /// <see cref="FirstVersionShowingWithheldPay"/>; anything else is answered as the installed 1.0.17.
    /// </summary>
    public static bool ShowsWithheldPay(string? appVersion) =>
        TryParse(appVersion, out var version) && version >= FirstVersionShowingWithheldPay;

    private static bool TryParse(string? value, out Version version)
    {
        version = new Version(0, 0);
        var text = value?.Trim();
        if (string.IsNullOrEmpty(text))
        {
            return false;
        }

        var parts = text.Split('.');
        if (parts.Length is < 1 or > 4 || parts.Any(p => p.Length is 0 or > 5 || !p.All(char.IsAsciiDigit)))
        {
            return false;
        }

        var numbers = parts.Select(int.Parse).Concat(Enumerable.Repeat(0, 4 - parts.Length)).ToArray();
        version = new Version(numbers[0], numbers[1], numbers[2], numbers[3]);
        return true;
    }
}
