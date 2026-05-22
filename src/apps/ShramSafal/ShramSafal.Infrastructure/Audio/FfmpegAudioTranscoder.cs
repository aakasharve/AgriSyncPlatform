using System.Globalization;
using System.Runtime.CompilerServices;
using System.Threading.Channels;
using FFMpegCore;
using FFMpegCore.Pipes;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports.External;

namespace ShramSafal.Infrastructure.Audio;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.3a — ffmpeg-backed
/// audio transcoder. Decodes the browser/mobile capture container
/// (WebM/Opus, mp4/m4a, ogg, mp3, …) and resamples to mono PCM s16le at
/// the target sample rate so the Sarvam streaming STT WebSocket can
/// consume it without any client-side codec assumptions.
///
/// <para>
/// <b>Container ffmpeg dependency.</b> The ECS production container image
/// MUST install the <c>ffmpeg</c> binary so <c>FFMpegCore</c> can shell
/// out to it. On Debian/Ubuntu base images:
/// <c>apt-get install -y ffmpeg</c>. Alpine: <c>apk add --no-cache ffmpeg</c>.
/// Local dev: <c>choco install ffmpeg</c> (Windows) or <c>brew install
/// ffmpeg</c> (macOS). Dockerfile edits are owned by ops-engineer; this
/// adapter documents the requirement but does not modify deployment
/// infra in this slice.
/// </para>
///
/// <para>
/// Output is yielded in roughly 4 KB chunks (~125 ms of 16 kHz mono
/// s16le) as ffmpeg writes them. Each chunk is aligned on a 2-byte
/// sample boundary so consumers can splice the stream at any chunk
/// boundary. The implementation buffers a small amount internally to
/// keep alignment; it does NOT buffer the whole transcoded payload.
/// </para>
/// </summary>
internal sealed class FfmpegAudioTranscoder : IAudioTranscoder
{
    // 4 KB read-side buffer keeps memory bounded while still being large
    // enough that StreamPipeSink's wakeups don't dominate latency. Equates
    // to ~125 ms of 16 kHz mono s16le (16000 samples/sec * 2 bytes/sample
    // = 32000 B/s; 4096 B / 32000 B/s ≈ 0.128 s). Smaller chunks raise
    // per-frame overhead; larger chunks add buffering latency on the
    // first-token path.
    private const int OutputChunkSize = 4096;

    private readonly ILogger<FfmpegAudioTranscoder> _logger;

    public FfmpegAudioTranscoder(ILogger<FfmpegAudioTranscoder> logger)
    {
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async IAsyncEnumerable<ReadOnlyMemory<byte>> ToPcm16kMonoAsync(
        Stream sourceAudio,
        string sourceMimeType,
        int targetSampleRateHz = 16000,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(sourceAudio);

        if (targetSampleRateHz <= 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(targetSampleRateHz),
                targetSampleRateHz,
                "Target sample rate must be positive.");
        }

        // ffmpeg -i pipe:0 -f s16le -ar <rate> -ac 1 -loglevel quiet pipe:1
        //   -f s16le         : raw 16-bit signed little-endian PCM (no header)
        //   -ar <rate>       : resample to <rate> Hz (default 16 kHz)
        //   -ac 1            : downmix to mono
        //   -loglevel quiet  : suppress ffmpeg's stderr chatter (it would
        //                      otherwise show up in container logs as noise)
        var rate = targetSampleRateHz.ToString(CultureInfo.InvariantCulture);

        // Channel-based hand-off between ffmpeg's stdout writer and this
        // async enumerator. Bounded so a slow consumer back-pressures ffmpeg
        // rather than buffering the whole transcode in memory. 16 chunks
        // ≈ 2 seconds of buffered PCM — small enough to bound memory,
        // large enough to absorb consumer hiccups.
        var channel = Channel.CreateBounded<ReadOnlyMemory<byte>>(
            new BoundedChannelOptions(16)
            {
                FullMode = BoundedChannelFullMode.Wait,
                SingleReader = true,
                SingleWriter = true,
            });

        // Run ffmpeg on a background task. The StreamPipeSource reads from
        // the caller-supplied source stream; ChannelPipeSink writes each
        // ffmpeg output chunk into the channel. We surface ffmpeg errors
        // through the channel's completion (writer.Complete(exception)) so
        // the consumer sees them as a thrown exception during MoveNextAsync.
        var ffmpegTask = Task.Run(async () =>
        {
            try
            {
                await FFMpegArguments
                    .FromPipeInput(new StreamPipeSource(sourceAudio))
                    .OutputToPipe(
                        new ChannelPipeSink(channel.Writer, OutputChunkSize, ct),
                        options => options
                            .ForceFormat("s16le")
                            .WithCustomArgument($"-ar {rate}")
                            .WithCustomArgument("-ac 1")
                            .WithCustomArgument("-loglevel quiet"))
                    .CancellableThrough(ct)
                    .ProcessAsynchronously();

                channel.Writer.TryComplete();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(
                    ex,
                    "FfmpegAudioTranscoder failed (sourceMime={SourceMime}, targetRate={Rate}).",
                    sourceMimeType,
                    targetSampleRateHz);
                channel.Writer.TryComplete(ex);
            }
        }, ct);

        // Drain the channel. Each read yields a ReadOnlyMemory<byte> chunk
        // already aligned on a 2-byte sample boundary by ChannelPipeSink.
        await foreach (var chunk in channel.Reader.ReadAllAsync(ct).ConfigureAwait(false))
        {
            yield return chunk;
        }

        // Surface any ffmpeg-side exception that the writer.Complete(ex)
        // call attached to the channel. ReadAllAsync() already threw it,
        // but we still await the background task so its exception isn't
        // observed as an unobserved-task fault if the consumer broke out
        // of the loop early.
        await ffmpegTask.ConfigureAwait(false);
    }

    /// <summary>
    /// FFMpegCore <see cref="IPipeSink"/> adapter that writes ffmpeg's
    /// stdout into a <see cref="ChannelWriter{T}"/>. Splits the incoming
    /// byte stream into <see cref="OutputChunkSize"/>-byte chunks and
    /// guarantees 2-byte sample alignment by buffering any odd-byte tail
    /// across reads.
    /// </summary>
    private sealed class ChannelPipeSink : IPipeSink
    {
        private readonly ChannelWriter<ReadOnlyMemory<byte>> _writer;
        private readonly int _chunkSize;
        private readonly CancellationToken _ct;

        public ChannelPipeSink(
            ChannelWriter<ReadOnlyMemory<byte>> writer,
            int chunkSize,
            CancellationToken ct)
        {
            _writer = writer ?? throw new ArgumentNullException(nameof(writer));
            _chunkSize = chunkSize > 0 ? chunkSize : 4096;
            _ct = ct;
        }

        public string GetFormat() => "s16le";

        public async Task ReadAsync(Stream inputStream, CancellationToken cancellationToken)
        {
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(_ct, cancellationToken);
            var token = linked.Token;

            var buffer = new byte[_chunkSize];
            // Tail buffer keeps a single byte across reads to guarantee
            // even-aligned output (s16le samples are 2 bytes). It's at
            // most 1 byte because we always pair tails with the next read.
            byte? tail = null;

            while (!token.IsCancellationRequested)
            {
                var read = await inputStream.ReadAsync(buffer.AsMemory(), token).ConfigureAwait(false);
                if (read <= 0)
                {
                    break;
                }

                // If we have a tail byte queued, prepend it to the current
                // payload so the output chunks always start on a sample
                // boundary.
                var payloadStart = 0;
                int payloadLength;
                byte[] payload;

                if (tail.HasValue)
                {
                    payload = new byte[read + 1];
                    payload[0] = tail.Value;
                    Buffer.BlockCopy(buffer, 0, payload, 1, read);
                    payloadLength = read + 1;
                    tail = null;
                }
                else
                {
                    payload = buffer;
                    payloadLength = read;
                }

                // If the resulting payload has an odd byte, hold the last
                // byte back as the next iteration's tail so every yielded
                // chunk is a whole number of s16le samples.
                if ((payloadLength & 1) == 1)
                {
                    tail = payload[payloadStart + payloadLength - 1];
                    payloadLength -= 1;
                }

                if (payloadLength == 0)
                {
                    continue;
                }

                // Copy out the aligned slice so the consumer can hold onto
                // the memory after the reusable `buffer` is overwritten.
                var emitted = new byte[payloadLength];
                Buffer.BlockCopy(payload, payloadStart, emitted, 0, payloadLength);
                await _writer.WriteAsync(emitted, token).ConfigureAwait(false);
            }

            // If a stray tail byte survived to EOF, drop it. A lone byte
            // cannot form a valid s16le sample, and the downstream STT
            // wouldn't accept it anyway.
        }
    }
}
