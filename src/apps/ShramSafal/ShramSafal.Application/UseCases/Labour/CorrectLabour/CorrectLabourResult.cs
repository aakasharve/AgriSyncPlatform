namespace ShramSafal.Application.UseCases.Labour.CorrectLabour;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 12b) —
/// what is TRUE NOW on the corrected engagement, plus how many history rows the
/// review action produced.
///
/// <para>This shape is also the idempotency response payload: it is serialized
/// into <c>ssf.sync_mutations.response_payload_json</c> before the writes land,
/// so a retry of the same (deviceId, clientRequestId) replays this exact answer
/// without touching the database. Changing the shape therefore changes what old
/// queued retries deserialize into — treat it as a wire contract.</para>
/// </summary>
/// <param name="AttributedFieldOperatorIds">
/// The LIVE attribution set after the correction — not a delta. Attribution
/// NEVER changes <see cref="WorkerCount"/>: removing बाळू and adding गणेश on an
/// 8-worker engagement leaves it at 8 (Constraint 3).
/// </param>
/// <param name="CorrectionsRecorded">
/// How many <c>labour_corrections</c> rows this action appended — one per
/// CHANGED field. Zero is a legitimate answer: a reviewer who confirms the
/// record unchanged corrects nothing.
/// </param>
/// <param name="AlreadyApplied">
/// <c>true</c> when this exact (deviceId, clientRequestId) had already been
/// applied and this response was replayed from the mutation store. A SUCCESS
/// outcome, never an error — and the proof that a retry did not double-write.
/// </param>
public sealed record CorrectLabourResult(
    Guid LabourAssignmentId,
    int? WorkerCount,
    int? MaleCount,
    int? FemaleCount,
    decimal DurationHours,
    string TimeBasis,
    IReadOnlyList<Guid> AttributedFieldOperatorIds,
    int CorrectionsRecorded,
    bool AlreadyApplied);
