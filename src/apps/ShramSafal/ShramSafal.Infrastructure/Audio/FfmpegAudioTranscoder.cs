using System.Diagnostics;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports.External;

namespace ShramSafal.Infrastructure.Audio;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.3a — ffmpeg-backed audio
/// transcoder. Decodes the browser/mobile capture container (WebM/Opus,
/// mp4/m4a, ogg, mp3, WAV, …) and resamples to mono PCM s16le at the target
/// sample rate so the Sarvam streaming STT WebSocket can consume it.
///
/// <para>
/// <b>2026-06-13 — rewritten to invoke ffmpeg DIRECTLY via
/// <see cref="Process"/> instead of FFMpegCore.</b> On prod, the FFMpegCore
/// pipe path (<c>StreamPipeSource</c> → custom <c>IPipeSink</c>) produced
/// ZERO output bytes with no exception for valid input, while
/// <c>ffmpeg -i pipe:0 -f s16le -ar 16000 -ac 1 pipe:1</c> works perfectly from
/// the shell on the same box (verified: 64000 bytes for a 2 s 16 kHz clip). So
/// the FFMpegCore plumbing — not ffmpeg — was the failure that left the live
/// caption empty (transcribe-stream → "EmptyAudio: 0 PCM bytes" → fallback to
/// the batch path). The direct invocation feeds the source to ffmpeg's stdin
/// and reads PCM from stdout, with stdin/stdout/stderr drained concurrently so
/// the OS pipes never deadlock.
/// </para>
///
/// <para>
/// <b>Host ffmpeg dependency.</b> The host MUST have the <c>ffmpeg</c> binary
/// on PATH (prod EC2: <c>/usr/bin/ffmpeg</c>, verified v6.1.1). Debian/Ubuntu:
/// <c>apt-get install -y ffmpeg</c>.
/// </para>
///
/// <para>
/// Output is yielded in <see cref="OutputChunkSize"/>-byte chunks as ffmpeg
/// writes them. Callers reassemble the full PCM payload, so chunks are NOT
/// individually sample-aligned (the concatenation is); the previous
/// alignment-buffering is unnecessary for the buffer-then-send consumer.
/// </para>
/// </summary>
internal sealed class FfmpegAudioTranscoder : IAudioTranscoder
{
    private const int OutputChunkSize = 4096;

    /// <summary>
    /// PLR lane V-1 fix pass (review) — a decode that has not finished by then is killed and fails. A 10-minute
    /// 24 kbps recording decodes in about a second; this only ends a hung process (bad input, a stalled pipe).
    /// </summary>
    internal static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(120);

    private readonly ILogger<FfmpegAudioTranscoder> _logger;
    private readonly TimeSpan _timeout;

    public FfmpegAudioTranscoder(ILogger<FfmpegAudioTranscoder> logger)
        : this(logger, DefaultTimeout)
    {
    }

    internal FfmpegAudioTranscoder(ILogger<FfmpegAudioTranscoder> logger, TimeSpan timeout)
    {
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _timeout = timeout > TimeSpan.Zero ? timeout : DefaultTimeout;
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

        var rate = targetSampleRateHz.ToString(CultureInfo.InvariantCulture);

        // ffmpeg -hide_banner -loglevel error -i pipe:0 -f s16le -ar <rate> -ac 1 pipe:1
        //   -i pipe:0  : read source container from stdin (format auto-detected)
        //   -f s16le   : raw 16-bit signed little-endian PCM (no header)
        //   -ar <rate> : resample to <rate> Hz; -ac 1 : downmix to mono
        //   pipe:1     : write PCM to stdout
        var psi = new ProcessStartInfo
        {
            FileName = "ffmpeg",
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var arg in new[]
        {
            "-hide_banner", "-loglevel", "error",
            "-i", "pipe:0",
            "-f", "s16le", "-ar", rate, "-ac", "1",
            "pipe:1",
        })
        {
            psi.ArgumentList.Add(arg);
        }

        using var proc = new Process { StartInfo = psi };
        proc.Start();

        // PLR lane V-1 fix pass (review): a decode that hangs is KILLED at the deadline (or when the caller gives up,
        // or stops reading) — never left running on a 2 vCPU server.
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(_timeout);
        var token = deadline.Token;
        using var killOnCancel = token.Register(() => Kill(proc));

        // Drain stderr + feed stdin on background tasks so the three OS pipes
        // never deadlock (ffmpeg blocks writing stdout/stderr if we stop
        // reading; it blocks reading stdin if we stop writing).
        var stderr = new StringBuilder();
        var stderrTask = Task.Run(async () =>
        {
            try { stderr.Append(await proc.StandardError.ReadToEndAsync(token).ConfigureAwait(false)); }
            catch { /* best-effort diagnostics only */ }
        }, CancellationToken.None);

        var writeTask = Task.Run(async () =>
        {
            try
            {
                await sourceAudio.CopyToAsync(proc.StandardInput.BaseStream, token).ConfigureAwait(false);
                await proc.StandardInput.BaseStream.FlushAsync(token).ConfigureAwait(false);
            }
            catch
            {
                // Broken pipe if ffmpeg exits early on bad input — surfaced
                // via the non-zero exit code below.
            }
            finally
            {
                try { proc.StandardInput.Close(); } catch { /* already closed */ }
            }
        }, CancellationToken.None);

        try
        {
            var buffer = new byte[OutputChunkSize];
            while (true)
            {
                int read;
                try
                {
                    read = await proc.StandardOutput.BaseStream.ReadAsync(buffer.AsMemory(), token).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                {
                    throw new TimeoutException($"ffmpeg did not finish decoding within {_timeout.TotalSeconds:0} s; it was stopped.");
                }

                if (read <= 0)
                {
                    break;
                }

                var emitted = new byte[read];
                Buffer.BlockCopy(buffer, 0, emitted, 0, read);
                yield return emitted;
            }

            await writeTask.ConfigureAwait(false);
            try
            {
                await proc.WaitForExitAsync(token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                throw new TimeoutException($"ffmpeg did not finish decoding within {_timeout.TotalSeconds:0} s; it was stopped.");
            }

            await stderrTask.ConfigureAwait(false);
        }
        finally
        {
            // Whatever ended the read — done, a deadline, a caller that stopped enumerating — no process is left behind.
            Kill(proc);
        }

        if (proc.ExitCode != 0)
        {
            var err = stderr.ToString().Trim();
            _logger.LogWarning(
                "FfmpegAudioTranscoder: ffmpeg exited {Code} (sourceMime={SourceMime}, targetRate={Rate}). stderr={Stderr}",
                proc.ExitCode,
                sourceMimeType,
                targetSampleRateHz,
                string.IsNullOrWhiteSpace(err) ? "(empty)" : err);
            throw new InvalidOperationException(
                $"ffmpeg transcode failed (exit {proc.ExitCode}): {(string.IsNullOrWhiteSpace(err) ? "no stderr" : err)}");
        }
    }

    private static void Kill(Process proc)
    {
        try
        {
            if (!proc.HasExited)
            {
                proc.Kill(entireProcessTree: true);
            }
        }
        catch
        {
            // Already exited, or never started: nothing to stop.
        }
    }
}
