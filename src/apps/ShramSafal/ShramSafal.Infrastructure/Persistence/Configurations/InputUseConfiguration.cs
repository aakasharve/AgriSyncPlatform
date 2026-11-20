// spec: facts-card-input-truth-2026-11-19 (lane FACTS, slice B)
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Inputs;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// <c>ssf.input_use_facts</c>: the derived row of one used product (see <see cref="InputUseFact"/>). Farm isolation (FORCE row security
/// on <c>farm_id</c>, the member read policy) and the app role's grants live in the migration (<c>AddInputUseFacts</c>), because EF
/// cannot express them. No foreign keys, on purpose: the rows are derived and rebuildable, and the demo-farm clear and the test-fixture
/// reset delete saved records and know nothing of this table, so a key would make them fail with 23503; the ledger reads only rows whose
/// record is still the current version, so a row left behind is never shown.
/// </summary>
internal sealed class InputUseFactConfiguration : IEntityTypeConfiguration<InputUseFact>
{
    public void Configure(EntityTypeBuilder<InputUseFact> builder)
    {
        builder.ToTable("input_use_facts", t =>
        {
            t.HasCheckConstraint("ck_input_use_facts_day_of_season", "day_of_season IS NULL OR day_of_season >= 0");
            t.HasCheckConstraint("ck_input_use_facts_day_zero_source", "day_zero_source IS NULL OR day_zero_source IN ('schedule', 'crop-cycle-start')");
        });
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.FarmId).HasColumnName("farm_id").IsRequired();
        builder.Property(x => x.PlotId).HasColumnName("plot_id");
        builder.Property(x => x.OperationId).HasColumnName("operation_id").IsRequired();
        builder.Property(x => x.InputItemId).HasColumnName("input_item_id").IsRequired();
        builder.Property(x => x.UseDate).HasColumnName("use_date").IsRequired();
        builder.Property(x => x.ProductSaid).HasColumnName("product_said").HasMaxLength(InputUseFact.MaxName).IsRequired();
        builder.Property(x => x.LibraryProductId).HasColumnName("library_product_id").HasMaxLength(128);
        builder.Property(x => x.LibraryVersion).HasColumnName("library_version").HasMaxLength(64).IsRequired();
        builder.Property(x => x.FactsVersion).HasColumnName("facts_version").HasMaxLength(64).IsRequired();
        builder.Property(x => x.CropName).HasColumnName("crop_name").HasMaxLength(InputUseFact.MaxText);
        builder.Property(x => x.DayZeroDate).HasColumnName("day_zero_date");
        builder.Property(x => x.DayZeroSource).HasColumnName("day_zero_source").HasMaxLength(24);
        builder.Property(x => x.ScheduleTemplateId).HasColumnName("schedule_template_id");
        builder.Property(x => x.DayOfSeason).HasColumnName("day_of_season");
        builder.Property(x => x.StageName).HasColumnName("stage_name").HasMaxLength(InputUseFact.MaxText);
        builder.Property(x => x.GroupCodes).HasColumnName("group_codes").HasMaxLength(InputUseFact.MaxText);
        builder.Property(x => x.DerivedAtUtc).HasColumnName("derived_at_utc").IsRequired();

        // One derived row per saved input item at a time: a re-derivation replaces it.
        builder.HasIndex(x => x.InputItemId).IsUnique().HasDatabaseName("ux_input_use_facts_item");
        // The season ledger: a farm's uses in date order.
        builder.HasIndex(x => new { x.FarmId, x.UseDate }).HasDatabaseName("ix_input_use_facts_farm_date");

        builder.Ignore(x => x.DomainEvents);
    }
}

/// <summary><c>ssf.input_use_ingredients</c>: the ingredients of one derived use, one row each (see <see cref="InputUseIngredient"/>).</summary>
internal sealed class InputUseIngredientConfiguration : IEntityTypeConfiguration<InputUseIngredient>
{
    public void Configure(EntityTypeBuilder<InputUseIngredient> builder)
    {
        builder.ToTable("input_use_ingredients", t =>
            t.HasCheckConstraint("ck_input_use_ingredients_ordinal", "ordinal >= 0"));
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.FarmId).HasColumnName("farm_id").IsRequired();
        builder.Property(x => x.InputUseFactId).HasColumnName("input_use_fact_id").IsRequired();
        builder.Property(x => x.Ordinal).HasColumnName("ordinal").IsRequired();
        builder.Property(x => x.IngredientKey).HasColumnName("ingredient_key").HasMaxLength(64);
        builder.Property(x => x.IngredientName).HasColumnName("ingredient_name").HasMaxLength(200).IsRequired();
        builder.Property(x => x.IngredientNameMr).HasColumnName("ingredient_name_mr").HasMaxLength(200);
        builder.Property(x => x.Percent).HasColumnName("percent").HasMaxLength(40);
        builder.Property(x => x.GroupCode).HasColumnName("group_code").HasMaxLength(40);

        builder.HasIndex(x => x.InputUseFactId).HasDatabaseName("ix_input_use_ingredients_fact");
        builder.HasIndex(x => new { x.FarmId, x.IngredientKey }).HasDatabaseName("ix_input_use_ingredients_farm_key");

        builder.Ignore(x => x.DomainEvents);
    }
}
