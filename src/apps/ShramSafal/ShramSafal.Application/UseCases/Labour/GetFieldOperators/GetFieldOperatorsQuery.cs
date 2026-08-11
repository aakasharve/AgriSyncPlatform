using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Labour.GetFieldOperators;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 12) —
/// the field-operator LIST read for a farm.
///
/// <para>
/// Deliberately its OWN read model, never unioned with
/// <c>GetLabourDataQuery</c>'s People roster. That roster is built from
/// <c>farm_memberships</c> filtered to Mukadam/Worker, and its <c>Id</c> is a
/// raw user GUID — it answers "who has access". A Field Operator answers
/// "whose work can be attributed"; its <c>Id</c> is a work-subject id that is
/// never a <c>UserId</c> and never linked to one. Mixing the two roster
/// shapes in one field would conflate two different identity systems — the
/// exact separation Labour V1 (Task 9 onward) exists to establish.
/// </para>
/// </summary>
public sealed record GetFieldOperatorsQuery(FarmId FarmId, UserId CallerUserId);
