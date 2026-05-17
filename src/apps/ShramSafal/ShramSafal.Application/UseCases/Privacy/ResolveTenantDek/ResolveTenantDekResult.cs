// spec: data-principle-spine-2026-05-05/05.2
//
// Sub-phase 05.2 — wire-shape of the resolved DEK. The endpoint returns
// 404 (no body) when the underlying ITenantDekService.ResolveAsync hands
// back null, so the success path always carries a non-null DekBase64.

namespace ShramSafal.Application.UseCases.Privacy.ResolveTenantDek;

public sealed record ResolveTenantDekResult(string DekBase64);
