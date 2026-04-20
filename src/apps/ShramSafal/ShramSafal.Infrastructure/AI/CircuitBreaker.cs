namespace ShramSafal.Infrastructure.AI;

public enum CircuitBreakerState
{
    Closed = 0,
    Open = 1,
    HalfOpen = 2
}

public sealed class CircuitBreaker
{
    private readonly object _sync = new();
    private readonly int _threshold;
    private readonly TimeSpan _resetInterval;

    private int _failureCount;
    private DateTime? _openedAtUtc;
    private CircuitBreakerState _state = CircuitBreakerState.Closed;

    public CircuitBreaker(int threshold, TimeSpan resetInterval)
    {
        _threshold = Math.Max(1, threshold);
        _resetInterval = resetInterval <= TimeSpan.Zero ? TimeSpan.FromSeconds(60) : resetInterval;
    }

    public int Threshold => _threshold;

    public TimeSpan ResetInterval => _resetInterval;

    public CircuitBreakerState State
    {
        get
        {
            lock (_sync)
            {
                if (_state == CircuitBreakerState.Open && ShouldEnterHalfOpen(DateTime.UtcNow))
                {
                    _state = CircuitBreakerState.HalfOpen;
                }

                return _state;
            }
        }
    }

    public int FailureCount
    {
        get
        {
            lock (_sync)
            {
                return _failureCount;
            }
        }
    }

    public bool AllowRequest()
    {
        lock (_sync)
        {
            if (_state == CircuitBreakerState.Closed || _state == CircuitBreakerState.HalfOpen)
            {
                return true;
            }

            if (!ShouldEnterHalfOpen(DateTime.UtcNow))
            {
                return false;
            }

            _state = CircuitBreakerState.HalfOpen;
            return true;
        }
    }

    public void RecordSuccess()
    {
        lock (_sync)
        {
            _failureCount = 0;
            _openedAtUtc = null;
            _state = CircuitBreakerState.Closed;
        }
    }

    public void RecordFailure()
    {
        lock (_sync)
        {
            _failureCount++;

            if (_failureCount < _threshold)
            {
                if (_state == CircuitBreakerState.HalfOpen)
                {
                    _state = CircuitBreakerState.Open;
                    _openedAtUtc = DateTime.UtcNow;
                }

                return;
            }

            _state = CircuitBreakerState.Open;
            _openedAtUtc = DateTime.UtcNow;
        }
    }

    private bool ShouldEnterHalfOpen(DateTime nowUtc)
    {
        return _openedAtUtc.HasValue && nowUtc - _openedAtUtc.Value >= _resetInterval;
    }
}
