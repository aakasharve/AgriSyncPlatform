namespace ShramSafal.Domain.Tests;

/// <summary>
/// Cadence at which a <see cref="TestProtocol"/> is expected to run on a crop cycle.
/// </summary>
public enum TestProtocolPeriodicity
{
    /// <summary>One-shot test for the whole crop cycle.</summary>
    OneTime = 0,

    /// <summary>Repeat once per attached stage.</summary>
    PerStage = 1,

    /// <summary>Repeat on a fixed interval in days — see <see cref="TestProtocol.EveryNDays"/>.</summary>
    EveryNDays = 2
}
