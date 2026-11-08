// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2, Task 1)
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Inputs;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2; founders D-92 / D-95) - <c>ssf.input_identity_assertions</c>: his
/// हो / नाही / फोटो answers about the products of saved records, one unchangeable row each. FORCE row security, the tenant
/// policy, the Active-member read policy and the app-role REVOKE (append-only by privilege) live in the migration
/// (<c>AddInputIdentityAssertions</c>), because EF cannot express them.
///
/// <para>The verdict is stored as its lower-case wire word (<c>confirmed</c> / <c>rejected</c> / <c>photo</c>), so the column
/// reads the same in SQL, in the pull and in the audit trail. The CHECK constraints keep the table honest on their own: a
/// known answer, a confirmed answer that names its product, a slot that is not negative.</para>
/// </summary>
internal sealed class InputIdentityAssertionConfiguration : IEntityTypeConfiguration<InputIdentityAssertion>
{
    public void Configure(EntityTypeBuilder<InputIdentityAssertion> builder)
    {
        builder.ToTable("input_identity_assertions", t =>
        {
            t.HasCheckConstraint(
                "ck_input_identity_assertions_verdict",
                "verdict IN ('confirmed', 'rejected', 'photo')");
            t.HasCheckConstraint(
                "ck_input_identity_assertions_confirmed_has_product",
                "verdict <> 'confirmed' OR catalog_product_id IS NOT NULL");
            t.HasCheckConstraint(
                "ck_input_identity_assertions_mix_index",
                "mix_index >= 0");
        });

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        builder.Property(x => x.PlotId)
            .HasColumnName("plot_id");

        builder.Property(x => x.DailyLogId)
            .HasColumnName("daily_log_id")
            .IsRequired();

        builder.Property(x => x.InputEventId)
            .HasColumnName("input_event_id")
            .HasMaxLength(InputIdentityAssertion.MaxInputEventId)
            .IsRequired();

        builder.Property(x => x.MixIndex)
            .HasColumnName("mix_index")
            .IsRequired();

        builder.Property(x => x.SpokenName)
            .HasColumnName("spoken_name")
            .HasMaxLength(InputIdentityAssertion.MaxSpokenName)
            .IsRequired();

        builder.Property(x => x.CatalogProductId)
            .HasColumnName("catalog_product_id")
            .HasMaxLength(InputIdentityAssertion.MaxCatalogProductId);

        builder.Property(x => x.Verdict)
            .HasColumnName("verdict")
            .HasMaxLength(16)
            .HasConversion(
                v => IdentityVerdictWire.ToWire(v),
                s => ReadVerdict(s))
            .IsRequired();

        builder.Property(x => x.AttachmentId)
            .HasColumnName("attachment_id");

        builder.Property(x => x.CatalogVersion)
            .HasColumnName("catalog_version")
            .HasMaxLength(InputIdentityAssertion.MaxCatalogVersion)
            .IsRequired();

        builder.Property(x => x.AssertedByUserId)
            .HasColumnName("asserted_by_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.AssertedAtUtc)
            .HasColumnName("asserted_at_utc")
            .IsRequired();

        builder.Property(x => x.ClientMutationId)
            .HasColumnName("client_mutation_id")
            .HasMaxLength(InputIdentityAssertion.MaxClientMutationId)
            .IsRequired();

        builder.Property(x => x.IsCheck)
            .HasColumnName("is_check")
            .HasDefaultValue(false)
            .IsRequired();

        // The key to ssf.farms is RESTRICT. The one tool that deletes a farm is the Bootstrapper's dev-only demo clear
        // (PurveshDemoSeeder.ClearPurveshDemoAsync, outside this lane): once an answer exists on the demo farm it fails loudly
        // (23503) until the answers are removed through the admin path first. See the migration's remarks.
        builder.HasOne<Farm>()
            .WithMany()
            .HasForeignKey(x => x.FarmId)
            .OnDelete(DeleteBehavior.Restrict);

        // daily_log_id carries NO foreign key, on purpose: the demo-farm clear and the test-fixture reset (Bootstrapper) delete saved
        // records and know nothing of this table, so a RESTRICT key would make them fail with 23503 the day a farm answers a
        // product. The handler reads the record under the sender's scope and the answer's farm is its record's farm (E4); the
        // pull re-checks both before it sends a row, so a row left behind by such a reset is never sent.

        // The newest answer of an item, newest first: the speaker's and the check both read this way.
        builder.HasIndex(x => new { x.DailyLogId, x.InputEventId, x.MixIndex, x.AssertedAtUtc })
            .IsDescending(false, false, false, true)
            .HasDatabaseName("ix_input_identity_assertions_item_asserted");

        // The pull's delta: the answers a farm kept after a phone's cursor.
        builder.HasIndex(x => new { x.FarmId, x.AssertedAtUtc })
            .HasDatabaseName("ix_input_identity_assertions_farm_asserted");

        // A re-sent answer is the same row: one answer per sync request per farm.
        builder.HasIndex(x => new { x.FarmId, x.ClientMutationId })
            .IsUnique()
            .HasDatabaseName("ux_input_identity_assertions_farm_mutation");

        builder.Ignore(x => x.DomainEvents);
    }

    /// <summary>A value the column cannot hold is refused by its CHECK; reading one back is never silently another answer.</summary>
    private static IdentityVerdict ReadVerdict(string stored) =>
        IdentityVerdictWire.TryParse(stored, out var verdict)
            ? verdict
            : throw new InvalidOperationException($"Unknown identity answer '{stored}' in ssf.input_identity_assertions.verdict.");
}
