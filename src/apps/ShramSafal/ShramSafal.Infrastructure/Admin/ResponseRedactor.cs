using ShramSafal.Application.Admin;
using ShramSafal.Application.Admin.Ports;

namespace ShramSafal.Infrastructure.Admin;

/// <summary>
/// STUB — real implementation lands in W0-A Task 5.2 (reflection-based field
/// redactor driven by RedactionMatrix). Returning input unchanged is a safe
/// identity fallback while the DI container has something to resolve.
/// </summary>
public sealed class ResponseRedactor : IResponseRedactor
{
    public T Redact<T>(T dto, AdminScope scope, string moduleKey) where T : class
        => dto;

    public IReadOnlyList<T> RedactMany<T>(IEnumerable<T> dtos, AdminScope scope, string moduleKey) where T : class
        => dtos.ToList();
}
