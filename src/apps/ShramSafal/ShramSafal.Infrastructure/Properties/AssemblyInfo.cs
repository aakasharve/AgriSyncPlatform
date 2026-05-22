using System.Runtime.CompilerServices;

[assembly: InternalsVisibleTo("ShramSafal.Domain.Tests")]
[assembly: InternalsVisibleTo("ShramSafal.Admin.IntegrationTests")]
// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 1.10 — the Sync
// integration test for TranscriptBackfillWorker constructs the worker
// directly (rather than driving it through hosted-service lifecycle)
// so the test asserts on RunBatchAsync's return value. The worker is
// internal-sealed, so the test project needs InternalsVisibleTo.
[assembly: InternalsVisibleTo("ShramSafal.Sync.IntegrationTests")]
