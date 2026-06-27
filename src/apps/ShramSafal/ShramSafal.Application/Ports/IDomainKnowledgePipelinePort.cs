using System.Text.Json.Nodes;

namespace ShramSafal.Application.Ports;

// spec: ai-intelligence-plan-2026-06-25
// Task 8 — Application port for the domain-knowledge pipeline.
//
// The concrete implementation (DomainKnowledgePipeline) lives in
// ShramSafal.Infrastructure.AI.DomainKnowledge, which is the legal
// location for pure normalizers (no EF / no I/O).  This port keeps
// the Application layer free of an Infrastructure project reference,
// satisfying the Clean Architecture layering rule enforced by
// Application_Does_Not_Depend_On_Its_Own_Infrastructure.
//
// Registration: ShramSafal.Infrastructure.DependencyInjection
//   services.AddSingleton<IDomainKnowledgePipelinePort, DomainKnowledgePipelineAdapter>();
public interface IDomainKnowledgePipelinePort
{
    /// <summary>
    /// Runs all 7 domain-knowledge normalizers on <paramref name="root"/> in
    /// the required pipeline order (C1→C7, see DomainKnowledgePipeline.cs).
    /// </summary>
    /// <param name="root">The structured JSON object produced by the LLM/STT
    /// pipeline.  Modified in-place.</param>
    /// <param name="transcript">The full Marathi/Devanagari transcript string.</param>
    void RunPipeline(JsonObject root, string transcript);
}
