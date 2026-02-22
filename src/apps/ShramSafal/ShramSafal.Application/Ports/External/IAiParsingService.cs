using ShramSafal.Domain.AI;

namespace ShramSafal.Application.Ports.External;

public interface IAiParsingService
{
    Task<VoiceParseResult> ParseAsync(string textOrTranscript, FarmContext context, CancellationToken ct = default);
}
