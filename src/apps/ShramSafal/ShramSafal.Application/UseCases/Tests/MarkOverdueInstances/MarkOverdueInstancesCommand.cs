namespace ShramSafal.Application.UseCases.Tests.MarkOverdueInstances;

/// <summary>
/// Sweeper command — transitions every <see cref="ShramSafal.Domain.Tests.TestInstance"/>
/// in <c>Due</c> state with <c>PlannedDueDate &lt; today</c> to <c>Overdue</c>.
///
/// Invoked by the <c>TestOverdueSweeper</c> background service at 02:00 UTC daily.
/// Returns the number of instances that were transitioned. See CEI §4.5.
/// </summary>
public sealed record MarkOverdueInstancesCommand();
