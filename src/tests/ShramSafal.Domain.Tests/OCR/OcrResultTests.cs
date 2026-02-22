using ShramSafal.Domain.OCR;
using Xunit;

namespace ShramSafal.Domain.Tests.OCR;

public sealed class OcrResultTests
{
    [Fact]
    public void OcrResult_IsImmutable_AfterCreation()
    {
        var mutableProperties = typeof(OcrResult)
            .GetProperties()
            .Where(property => property.SetMethod?.IsPublic == true)
            .Select(property => property.Name)
            .ToArray();

        Assert.Empty(mutableProperties);
    }

    [Fact]
    public void OcrResult_LinksToAttachment()
    {
        var attachmentId = Guid.NewGuid();
        var result = OcrResult.Create(
            Guid.NewGuid(),
            attachmentId,
            "total 500",
            [
                new ExtractedField
                {
                    FieldName = "amount",
                    Value = "500",
                    Confidence = 0.92m
                }
            ],
            0.92m,
            "gemini-test",
            1250,
            DateTime.UtcNow);

        Assert.Equal(attachmentId, result.AttachmentId);
        Assert.Single(result.GetFields());
    }

    [Theory]
    [InlineData(-0.2, 0.0)]
    [InlineData(0.55, 0.55)]
    [InlineData(1.4, 1.0)]
    public void OcrResult_NormalizesConfidenceThresholds(decimal input, decimal expected)
    {
        var result = OcrResult.Create(
            Guid.NewGuid(),
            Guid.NewGuid(),
            string.Empty,
            [],
            input,
            "gemini-test",
            300,
            DateTime.UtcNow);

        Assert.Equal(expected, result.OverallConfidence);
    }
}
