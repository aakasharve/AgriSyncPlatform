using System.Text.Json.Nodes;
using ShramSafal.Application.Ports;

namespace ShramSafal.Infrastructure.AI.DomainKnowledge;

// spec: ai-intelligence-plan-2026-06-25
// Task 8 — Infrastructure adapter that exposes DomainKnowledgePipeline
// via the Application port IDomainKnowledgePipelinePort.
//
// Registered in DependencyInjection.AddShramSafalInfrastructure as a
// singleton (the pipeline is stateless).  ParseVoiceInputHandler resolves
// IDomainKnowledgePipelinePort and calls RunPipeline() when the config
// flag Ai:DomainKnowledgeLayer:Enabled is true.
internal sealed class DomainKnowledgePipelineAdapter : IDomainKnowledgePipelinePort
{
    /// <inheritdoc />
    public void RunPipeline(JsonObject root, string transcript) =>
        DomainKnowledgePipeline.RunDomainKnowledgePipeline(root, transcript);
}
