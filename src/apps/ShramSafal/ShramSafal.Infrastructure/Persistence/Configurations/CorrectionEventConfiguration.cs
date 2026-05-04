// spec: correctionevent-server-persistence
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Corrections;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class CorrectionEventConfiguration : IEntityTypeConfiguration<CorrectionEvent>
{
    public void Configure(EntityTypeBuilder<CorrectionEvent> builder)
    {
        builder.ToTable("correction_events", "ssf");
        builder.HasKey(x => x.Id);

        builder.Property(x => x.UserId).IsRequired();
        builder.Property(x => x.OriginalParseId).IsRequired();
        builder.Property(x => x.OriginalParseRaw).IsRequired().HasColumnType("jsonb");
        builder.Property(x => x.CorrectedParse).IsRequired().HasColumnType("jsonb");
        builder.Property(x => x.PromptVersion).IsRequired().HasMaxLength(20);
        builder.Property(x => x.Locale).IsRequired().HasMaxLength(10);
        builder.Property(x => x.Trigger).IsRequired()
            .HasConversion<string>().HasMaxLength(30);
        builder.Property(x => x.CapturedAtUtc).IsRequired();

        builder.HasIndex(x => x.UserId);
        builder.HasIndex(x => x.PromptVersion);
        builder.HasIndex(x => x.CapturedAtUtc);
    }
}
