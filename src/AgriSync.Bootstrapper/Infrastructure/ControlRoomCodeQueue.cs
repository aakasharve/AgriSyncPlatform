// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A6, AM2, K29)
using System.Threading.Channels;

namespace AgriSync.Bootstrapper.Infrastructure;

/// <summary>
/// One approved number's code, waiting for <see cref="ControlRoomCodeSender"/>. <see cref="TenDigits"/> is the normalised
/// number (never the typed text, so a 0-prefixed number cannot reach a different account); it lives only in this
/// in-memory queue. <see cref="PhoneTail"/> is the most History or a log line ever holds of it.
/// <para>
/// Fix wave S-A6 (AU-M6, FR-M4): a refused send is queued too, as a <see cref="Refusal"/> to record, so its History row is
/// written after the answer exactly as an approved send's work is (outside the timed window). A refusal carries no number
/// at all: <see cref="TenDigits"/> is empty and only the last four digits travel.
/// </para>
/// </summary>
public sealed record ControlRoomCodeRequest(string TenDigits, string PhoneTail, string DeviceId, string IpHash, DateTime QueuedAtUtc)
{
    /// <summary>Set when this is a refused send to record (<c>door_refused</c>), not a code to send.</summary>
    public ControlRoomRefusal? Refusal { get; init; }

    /// <summary>A refused send to record: the subject (the matched person, else the door), the step and the reason.</summary>
    public static ControlRoomCodeRequest ForRefusal(
        Guid subjectId, string step, string reason, string phoneTail, string deviceId, string ipHash, DateTime queuedAtUtc) =>
        new(string.Empty, phoneTail, deviceId, ipHash, queuedAtUtc) { Refusal = new ControlRoomRefusal(subjectId, step, reason) };
}

/// <summary>What a queued <c>door_refused</c> row says, besides the last four digits and the audit claims.</summary>
public sealed record ControlRoomRefusal(Guid SubjectId, string Step, string Reason);

/// <summary>
/// The console door's bounded code queue (AM2): the door answers on its floor and never texts inside the request; the
/// background sender texts after the answer. Bounded at <see cref="DefaultCapacity"/> with
/// <see cref="BoundedChannelFullMode.DropWrite"/>, so a full queue is a refusal the caller sees, never a block.
/// <para>
/// A channel in DropWrite mode reports a dropped write as written (<c>TryWrite</c> returns true and calls the
/// item-dropped callback instead). <see cref="TryEnqueue"/> therefore watches that callback, so a dropped request is
/// answered <c>false</c> and the door writes it as <c>code_not_sent</c> / <c>queue_full</c>: it never silently vanishes.
/// </para>
/// </summary>
public sealed class ControlRoomCodeQueue
{
    public const int DefaultCapacity = 100;

    private readonly Channel<ControlRoomCodeRequest> _channel;
    private readonly object _writeGate = new();
    private readonly int _refusalCeiling;
    private ControlRoomCodeRequest? _dropped;

    public ControlRoomCodeQueue() : this(DefaultCapacity)
    {
    }

    public ControlRoomCodeQueue(int capacity)
    {
        _refusalCeiling = Math.Max(1, capacity / 2);
        _channel = Channel.CreateBounded<ControlRoomCodeRequest>(
            new BoundedChannelOptions(capacity)
            {
                FullMode = BoundedChannelFullMode.DropWrite,
                SingleReader = true,
            },
            itemDropped: request => _dropped = request);
    }

    /// <summary>The sender's end.</summary>
    public ChannelReader<ControlRoomCodeRequest> Reader => _channel.Reader;

    /// <summary>Codes waiting to be sent.</summary>
    public int Count => _channel.Reader.Count;

    /// <summary>True once the sender has stopped: nothing more is taken (<see cref="TryEnqueue"/> answers false).</summary>
    public bool IsClosed { get; private set; }

    /// <summary>
    /// True when the request is queued; false when the queue is full (the request was dropped) or closed. A refused send
    /// to record (S-A6) is taken only while the queue is under half full, so refused tries can never crowd out an approved
    /// number's code; the door writes a refusal it was not given room for at once.
    /// </summary>
    public bool TryEnqueue(ControlRoomCodeRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        lock (_writeGate)
        {
            if (request.Refusal is not null && _channel.Reader.Count >= _refusalCeiling)
            {
                return false;
            }

            _dropped = null;
            var written = _channel.Writer.TryWrite(request);
            var dropped = ReferenceEquals(_dropped, request);
            _dropped = null;
            return written && !dropped;
        }
    }

    /// <summary>The sender is stopping: refuse new codes; what is already queued stays readable for the shutdown drain.</summary>
    public void Close()
    {
        lock (_writeGate)
        {
            IsClosed = true;
            _channel.Writer.TryComplete();
        }
    }
}
