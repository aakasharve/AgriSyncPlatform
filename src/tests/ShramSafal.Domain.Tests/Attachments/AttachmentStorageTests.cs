using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using System.Reflection;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.Options;
using ShramSafal.Application.UseCases.Attachments.UploadAttachment;
using ShramSafal.Domain.Attachments;
using ShramSafal.Infrastructure.Storage;
using Xunit;

namespace ShramSafal.Domain.Tests.Attachments;

public sealed class AttachmentStorageTests
{
    [Fact]
    public void BuildRelativePath_UsesFarmYearMonthAttachmentIdAndGeneratedFileName()
    {
        var attachmentId = Guid.Parse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
        var farmId = new FarmId(Guid.Parse("11111111-2222-3333-4444-555555555555"));
        var createdByUserId = new UserId(Guid.Parse("99999999-8888-7777-6666-555555555555"));
        var attachment = Attachment.Create(
            attachmentId,
            farmId,
            Guid.Parse("12345678-1234-1234-1234-123456789012"),
            "DailyLog",
            "receipt final.jpg",
            "image/jpeg",
            createdByUserId,
            DateTime.UtcNow);

        var method = typeof(UploadAttachmentHandler).GetMethod(
            "BuildRelativePath",
            BindingFlags.NonPublic | BindingFlags.Static);

        Assert.NotNull(method);

        var result = (string?)method!.Invoke(null, [attachment, new DateTime(2026, 3, 8, 12, 0, 0, DateTimeKind.Utc), "receipt final.jpg"]);

        Assert.Equal(
            "attachments/11111111222233334444555555555555/2026/03/aaaaaaaabbbbccccddddeeeeeeeeeeee/aaaaaaaabbbbccccddddeeeeeeeeeeee.jpg",
            result);
    }

    [Fact]
    public async Task LocalFileStorageService_SaveAndOpenRead_WorksWithUpdatedContract()
    {
        var root = Path.Combine(Path.GetTempPath(), $"agrisync-storage-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);

        try
        {
            var service = new LocalFileStorageService(
                Options.Create(new StorageOptions
                {
                    DataDirectory = root,
                    Provider = "Local"
                }),
                new FakeHostEnvironment(root));

            await using var input = new MemoryStream(System.Text.Encoding.UTF8.GetBytes("hello-s3-phase"));
            var bytesWritten = await service.SaveAsync("attachments/farm/2026/03/file.txt", input, "text/plain");

            var output = await service.OpenReadAsync("attachments/farm/2026/03/file.txt");

            Assert.NotNull(output);
            Assert.Equal(14, bytesWritten);

            using var reader = new StreamReader(output!);
            var content = await reader.ReadToEndAsync();
            Assert.Equal("hello-s3-phase", content);
        }
        finally
        {
            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }

    [Fact]
    public async Task S3AttachmentStorageService_SaveAndOpenRead_UsesExpectedKeyContentTypeAndEncryption()
    {
        var fakeS3 = new FakeAmazonS3Client();
        var service = new S3AttachmentStorageService(
            fakeS3,
            Options.Create(new StorageOptions
            {
                Provider = "S3",
                BucketName = "shramsafal-uploads-prod",
                Region = "ap-south-1",
                KeyPrefix = "attachments/"
            }));

        await using var input = new MemoryStream(System.Text.Encoding.UTF8.GetBytes("phase3-s3"));
        var bytesWritten = await service.SaveAsync(
            "attachments/farm123/2026/03/attachment123/file.jpg",
            input,
            "image/jpeg");

        var output = await service.OpenReadAsync("attachments/farm123/2026/03/attachment123/file.jpg");

        Assert.Equal(9, bytesWritten);
        Assert.NotNull(output);
        Assert.Equal("shramsafal-uploads-prod", fakeS3.LastBucketName);
        Assert.Equal("attachments/farm123/2026/03/attachment123/file.jpg", fakeS3.LastKey);
        Assert.Equal("image/jpeg", fakeS3.LastContentType);
        Assert.Equal(ServerSideEncryptionMethod.AES256, fakeS3.LastEncryptionMethod);

        using var reader = new StreamReader(output!);
        var content = await reader.ReadToEndAsync();
        Assert.Equal("phase3-s3", content);
    }

    private sealed class FakeHostEnvironment(string contentRootPath) : Microsoft.Extensions.Hosting.IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Development";
        public string ApplicationName { get; set; } = "ShramSafal.Tests";
        public string ContentRootPath { get; set; } = contentRootPath;
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } =
            new Microsoft.Extensions.FileProviders.PhysicalFileProvider(contentRootPath);
    }

    private sealed class FakeAmazonS3Client : AmazonS3Client
    {
        private readonly Dictionary<string, byte[]> objects = new(StringComparer.Ordinal);

        public FakeAmazonS3Client()
            : base(new AnonymousAWSCredentials(), new AmazonS3Config
            {
                RegionEndpoint = Amazon.RegionEndpoint.APSouth1
            })
        {
        }

        public string LastBucketName { get; private set; } = string.Empty;
        public string LastKey { get; private set; } = string.Empty;
        public string? LastContentType { get; private set; }
        public ServerSideEncryptionMethod? LastEncryptionMethod { get; private set; }

        public override async Task<PutObjectResponse> PutObjectAsync(PutObjectRequest request, CancellationToken cancellationToken = default)
        {
            using var memory = new MemoryStream();
            await request.InputStream.CopyToAsync(memory, cancellationToken);
            objects[request.Key] = memory.ToArray();
            LastBucketName = request.BucketName;
            LastKey = request.Key;
            LastContentType = request.ContentType;
            LastEncryptionMethod = request.ServerSideEncryptionMethod;

            return new PutObjectResponse
            {
                HttpStatusCode = System.Net.HttpStatusCode.OK
            };
        }

        public override Task<GetObjectResponse> GetObjectAsync(string bucketName, string key, CancellationToken cancellationToken = default)
        {
            if (!objects.TryGetValue(key, out var content))
            {
                throw new AmazonS3Exception("Not found")
                {
                    StatusCode = System.Net.HttpStatusCode.NotFound,
                    ErrorCode = "NoSuchKey"
                };
            }

            return Task.FromResult(new GetObjectResponse
            {
                BucketName = bucketName,
                Key = key,
                ResponseStream = new MemoryStream(content)
            });
        }
    }
}
