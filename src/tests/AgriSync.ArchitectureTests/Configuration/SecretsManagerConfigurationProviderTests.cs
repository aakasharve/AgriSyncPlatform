using System.Threading;
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Configuration;
using Amazon.Runtime;
using Amazon.SecretsManager;
using Amazon.SecretsManager.Model;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace AgriSync.ArchitectureTests.Configuration;

/// <summary>
/// Unit tests for the AWS Secrets Manager configuration provider that
/// the prod-deploy runbook leans on. Hand-rolled fake — no Moq dep.
/// </summary>
public sealed class SecretsManagerConfigurationProviderTests
{
    [Fact]
    public void Disabled_source_does_not_call_AWS_and_adds_no_keys()
    {
        var fake = new FakeSecretsManager(_ =>
            throw new System.InvalidOperationException("AWS must NOT be called when Enabled=false"));

        var configuration = BuildConfiguration(new SecretsManagerConfigurationSource
        {
            SecretId = "irrelevant",
            Region = "ap-south-1",
            Enabled = false,
            ClientOverride = fake,
        });

        configuration.GetConnectionString("UserDb").Should().BeNull();
    }

    [Fact]
    public void Enabled_source_flattens_top_level_string_keys_into_configuration()
    {
        var fake = new FakeSecretsManager(req =>
        {
            req.SecretId.Should().Be("shramsafal/prod/db-connection-string");
            return new GetSecretValueResponse
            {
                SecretString = """
                {
                  "ConnectionStrings:UserDb": "Host=u;Username=app",
                  "ConnectionStrings:ShramSafalDb": "Host=s;Username=app",
                  "ConnectionStrings:AnalyticsDb": "Host=a;Username=app"
                }
                """,
            };
        });

        var configuration = BuildConfiguration(new SecretsManagerConfigurationSource
        {
            SecretId = "shramsafal/prod/db-connection-string",
            Region = "ap-south-1",
            ClientOverride = fake,
        });

        configuration.GetConnectionString("UserDb").Should().Be("Host=u;Username=app");
        configuration.GetConnectionString("ShramSafalDb").Should().Be("Host=s;Username=app");
        configuration.GetConnectionString("AnalyticsDb").Should().Be("Host=a;Username=app");
    }

    [Fact]
    public void Secrets_manager_values_override_environment_variables()
    {
        var fake = new FakeSecretsManager(_ => new GetSecretValueResponse
        {
            SecretString = """{ "ConnectionStrings:UserDb": "from-secrets-manager" }""",
        });

        // Env var loaded FIRST, secrets-manager source registered LAST so it wins.
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new[]
            {
                new System.Collections.Generic.KeyValuePair<string, string?>(
                    "ConnectionStrings:UserDb", "from-env-var"),
            })
            .Add(new SecretsManagerConfigurationSource
            {
                SecretId = "irrelevant",
                Region = "ap-south-1",
                ClientOverride = fake,
            })
            .Build();

        configuration.GetConnectionString("UserDb").Should().Be("from-secrets-manager");
    }

    [Fact]
    public void Empty_secret_string_throws_with_diagnostic_message()
    {
#pragma warning disable SecretsManager1000 // intentional: test the empty-string failure path
        var fake = new FakeSecretsManager(_ => new GetSecretValueResponse { SecretString = "" });
#pragma warning restore SecretsManager1000

        var act = () => BuildConfiguration(new SecretsManagerConfigurationSource
        {
            SecretId = "shramsafal/test/empty",
            Region = "ap-south-1",
            ClientOverride = fake,
        });

        act.Should()
            .Throw<System.InvalidOperationException>()
            .WithMessage("*shramsafal/test/empty*has no SecretString*");
    }

    [Fact]
    public void Non_object_secret_throws_with_diagnostic_message()
    {
        var fake = new FakeSecretsManager(_ => new GetSecretValueResponse { SecretString = "[1,2,3]" });

        var act = () => BuildConfiguration(new SecretsManagerConfigurationSource
        {
            SecretId = "shramsafal/test/array",
            Region = "ap-south-1",
            ClientOverride = fake,
        });

        act.Should()
            .Throw<System.InvalidOperationException>()
            .WithMessage("*shramsafal/test/array*JSON object*");
    }

    private static IConfiguration BuildConfiguration(SecretsManagerConfigurationSource source) =>
        new ConfigurationBuilder().Add(source).Build();

    /// <summary>
    /// Minimal hand-rolled <see cref="IAmazonSecretsManager"/> implementation:
    /// every method except <see cref="GetSecretValueAsync(GetSecretValueRequest, CancellationToken)"/>
    /// throws <see cref="System.NotImplementedException"/>. Tests configure
    /// a single delegate for the one operation the provider actually calls.
    /// </summary>
    private sealed class FakeSecretsManager : IAmazonSecretsManager
    {
        private readonly System.Func<GetSecretValueRequest, GetSecretValueResponse> _onGetSecretValue;

        public FakeSecretsManager(System.Func<GetSecretValueRequest, GetSecretValueResponse> onGetSecretValue)
        {
            _onGetSecretValue = onGetSecretValue;
        }

        public Task<GetSecretValueResponse> GetSecretValueAsync(
            GetSecretValueRequest request,
            CancellationToken cancellationToken = default)
            => Task.FromResult(_onGetSecretValue(request));

        // Everything below is unused by the provider — throw if anything
        // else gets called so tests fail loudly on accidental coupling.
        public IClientConfig Config => throw new System.NotImplementedException();
        public ISecretsManagerPaginatorFactory Paginators => throw new System.NotImplementedException();
        public void Dispose() { }

        public Task<BatchGetSecretValueResponse> BatchGetSecretValueAsync(BatchGetSecretValueRequest request, CancellationToken cancellationToken = default) => throw new System.NotImplementedException();
        public Task<CancelRotateSecretResponse> CancelRotateSecretAsync(CancelRotateSecretRequest request, CancellationToken cancellationToken = default) => throw new System.NotImplementedException();
        public Task<CreateSecretResponse> CreateSecretAsync(CreateSecretRequest request, CancellationToken cancellationToken = default) => throw new System.NotImplementedException();
        public Task<DeleteResourcePolicyResponse> DeleteResourcePolicyAsync(DeleteResourcePolicyRequest request, CancellationToken cancellationToken = default) => throw new System.NotImplementedException();
        public Task<DeleteSecretResponse> DeleteSecretAsync(DeleteSecretRequest request, CancellationToken cancellationToken = default) => throw new System.NotImplementedException();
        public Task<DescribeSecretResponse> DescribeSecretAsync(DescribeSecretRequest request, CancellationToken cancellationToken = default) => throw new System.NotImplementedException();
        public Task<GetRandomPasswordResponse> GetRandomPasswordAsync(GetRandomPasswordRequest request, CancellationToken cancellationToken = default) => throw new System.NotImplementedException();
        public Task<GetResourcePolicyResponse> GetResourcePolicyAsync(GetResourcePolicyRequest request, CancellationToken cancellationToken = default) => throw new System.NotImplementedException();
        public Task<ListSecretsResponse> ListSecretsAsync(ListSecretsRequest request, CancellationToken cancellationToken = default) => throw new System.NotImplementedException();
        public Task<ListSecretVersionIdsResponse> ListSecretVersionIdsAsync(ListSecretVersionIdsRequest request, CancellationToken cancellationToken = default) => throw new System.NotImplementedException();
        public Task<PutResourcePolicyResponse> PutResourcePolicyAsync(PutResourcePolicyRequest request, CancellationToken cancellationToken = default) => throw new System.NotImplementedException();
        public Task<PutSecretValueResponse> PutSecretValueAsync(PutSecretValueRequest request, CancellationToken cancellationToken = default) => throw new System.NotImplementedException();
        public Task<RemoveRegionsFromReplicationResponse> RemoveRegionsFromReplicationAsync(RemoveRegionsFromReplicationRequest request, CancellationToken cancellationToken = default) => throw new System.NotImplementedException();
        public Task<ReplicateSecretToRegionsResponse> ReplicateSecretToRegionsAsync(ReplicateSecretToRegionsRequest request, CancellationToken cancellationToken = default) => throw new System.NotImplementedException();
        public Task<RestoreSecretResponse> RestoreSecretAsync(RestoreSecretRequest request, CancellationToken cancellationToken = default) => throw new System.NotImplementedException();
        public Task<RotateSecretResponse> RotateSecretAsync(RotateSecretRequest request, CancellationToken cancellationToken = default) => throw new System.NotImplementedException();
        public Task<StopReplicationToReplicaResponse> StopReplicationToReplicaAsync(StopReplicationToReplicaRequest request, CancellationToken cancellationToken = default) => throw new System.NotImplementedException();
        public Task<TagResourceResponse> TagResourceAsync(TagResourceRequest request, CancellationToken cancellationToken = default) => throw new System.NotImplementedException();
        public Task<UntagResourceResponse> UntagResourceAsync(UntagResourceRequest request, CancellationToken cancellationToken = default) => throw new System.NotImplementedException();
        public Task<UpdateSecretResponse> UpdateSecretAsync(UpdateSecretRequest request, CancellationToken cancellationToken = default) => throw new System.NotImplementedException();
        public Task<UpdateSecretVersionStageResponse> UpdateSecretVersionStageAsync(UpdateSecretVersionStageRequest request, CancellationToken cancellationToken = default) => throw new System.NotImplementedException();
        public Task<ValidateResourcePolicyResponse> ValidateResourcePolicyAsync(ValidateResourcePolicyRequest request, CancellationToken cancellationToken = default) => throw new System.NotImplementedException();

        public System.Threading.Tasks.Task<Amazon.Runtime.Endpoints.Endpoint> DetermineServiceOperationEndpointAsync(AmazonWebServiceRequest request, CancellationToken cancellationToken = default) => throw new System.NotImplementedException();
        public Amazon.Runtime.Endpoints.Endpoint DetermineServiceOperationEndpoint(AmazonWebServiceRequest request) => throw new System.NotImplementedException();
    }
}
