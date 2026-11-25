namespace ShramSafal.Application.Ports.External;

// spec: plr-d10 schedule slice 15 (the creator door), server half.

public enum CreatorScanVerdict
{
    /// <summary>The scanner found nothing wrong: the file may be kept and read.</summary>
    Clean = 0,

    /// <summary>The scanner refuses the file: its bytes are not kept, and its words say why.</summary>
    Blocked = 1,

    /// <summary>The scanner has not decided yet (a real scanner working on its own time): the file stays quarantined and nobody can read it.</summary>
    Pending = 2,
}

public sealed record CreatorScanResult(CreatorScanVerdict Verdict, string ScannerName, string? Words);

/// <summary>
/// Decides about one file a creator sent, BEFORE its bytes are kept anywhere. The built-in scanner checks the kind (from the bytes), the size and the standard anti-virus
/// test file; a real anti-virus is another implementation the host registers (the founder's spend decision). It never reads what a file means: no text recognition, no AI.
/// </summary>
public interface ICreatorFileScanner
{
    string Name { get; }

    /// <summary>True for the built-in check only. Production refuses to open the creator door while this is the scanner.</summary>
    bool IsBuiltIn { get; }

    Task<CreatorScanResult> ScanAsync(ReadOnlyMemory<byte> bytes, string fileName, CancellationToken ct = default);
}

/// <summary>Sends a creator's one-time sign-in code to his phone (ten digits, no country code). False when it could not be sent.</summary>
public interface ICreatorSignInCodeSender
{
    Task<bool> SendAsync(string phone, string code, CancellationToken ct = default);
}
