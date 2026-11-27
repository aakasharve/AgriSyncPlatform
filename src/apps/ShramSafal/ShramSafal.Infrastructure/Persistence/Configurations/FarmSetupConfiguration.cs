// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, farm setup on the server, per farm)
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

// The six tables of a farm's setup (migration AddFarmSetup). Rules every one of them follows:
//   - a DIRECT farm_id on every table, child tables too (F8): row security is keyed on it, and EF writes a parent and its children in ONE SaveChanges, where
//     an EXISTS-based WITH CHECK on the child fails;
//   - FORCE row security with the two standard policies, the place trigger and the grants (SELECT / INSERT / UPDATE; never DELETE: a removal is a state)
//     live in the migration;
//   - NO foreign key and NO navigation, on purpose (a foreign key's check runs outside row security and would tell a caller another farm's id exists): the
//     application checks the place under the farm's scope, and the trigger checks it again. The store attaches children to their parent after reading;
//   - `revision` is the concurrency token of each versioned unit (a source with its motors, the timetable, a machine, a plot's arrangement).

/// <summary><c>ssf.farm_water_sources</c>: one row per water source of a farm.</summary>
internal sealed class FarmWaterSourceConfiguration : IEntityTypeConfiguration<FarmWaterSource>
{
    public void Configure(EntityTypeBuilder<FarmWaterSource> builder)
    {
        builder.ToTable("farm_water_sources", t =>
        {
            t.HasCheckConstraint("ck_farm_water_sources_state", "state IN (0, 1)");
            t.HasCheckConstraint("ck_farm_water_sources_revision", "revision >= 1");
            t.HasCheckConstraint("ck_farm_water_sources_type", "source_type IN ('well', 'borewell', 'canal', 'farm_pond', 'tanker')");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(x => x.FarmId).HasColumnName("farm_id").HasConversion(TypedIdConverters.FarmId).IsRequired();
        builder.Property(x => x.Name).HasColumnName("name").HasMaxLength(80).IsRequired();
        builder.Property(x => x.SourceType).HasColumnName("source_type").HasMaxLength(12).IsRequired();
        builder.Property(x => x.IsAvailable).HasColumnName("is_available").HasDefaultValue(true).ValueGeneratedNever().IsRequired();
        builder.Property(x => x.Notes).HasColumnName("notes").HasMaxLength(300);
        FarmSetupColumns.MapStateAndRevision(builder);
        FarmSetupColumns.MapWhoAndWhen(builder);

        builder.HasIndex(x => x.FarmId).HasDatabaseName("ix_farm_water_sources_farm");
        builder.Ignore(x => x.Motors);
        builder.Ignore(x => x.DomainEvents);
    }
}

/// <summary><c>ssf.farm_motors</c>: one row per motor, child of a water source (no revision of its own: its source's counts).</summary>
internal sealed class FarmMotorConfiguration : IEntityTypeConfiguration<FarmMotor>
{
    public void Configure(EntityTypeBuilder<FarmMotor> builder)
    {
        builder.ToTable("farm_motors", t =>
        {
            t.HasCheckConstraint("ck_farm_motors_state", "state IN (0, 1)");
            t.HasCheckConstraint("ck_farm_motors_hp", "hp > 0 AND hp <= 500");
            t.HasCheckConstraint("ck_farm_motors_phase", "phase IN (1, 3)");
            t.HasCheckConstraint("ck_farm_motors_power_source", "power_source IN ('mseb', 'solar', 'generator')");
            t.HasCheckConstraint("ck_farm_motors_drip_flow", "drip_flow_lph > 0");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(x => x.FarmId).HasColumnName("farm_id").HasConversion(TypedIdConverters.FarmId).IsRequired();
        builder.Property(x => x.WaterSourceId).HasColumnName("water_source_id").IsRequired();
        builder.Property(x => x.Name).HasColumnName("name").HasMaxLength(80).IsRequired();
        builder.Property(x => x.Hp).HasColumnName("hp").HasColumnType("numeric(6,2)").IsRequired();
        builder.Property(x => x.Phase).HasColumnName("phase").HasColumnType("smallint").IsRequired();
        builder.Property(x => x.PowerSource).HasColumnName("power_source").HasMaxLength(10).IsRequired();
        builder.Property(x => x.PowerSourceName).HasColumnName("power_source_name").HasMaxLength(80);
        builder.Property(x => x.HasDrip).HasColumnName("has_drip").HasDefaultValue(false).ValueGeneratedNever().IsRequired();
        builder.Property(x => x.DripPipeSize).HasColumnName("drip_pipe_size").HasMaxLength(8);
        builder.Property(x => x.DripHasFilter).HasColumnName("drip_has_filter");
        builder.Property(x => x.DripFlowLph).HasColumnName("drip_flow_lph").HasColumnType("numeric(10,2)");
        builder.Property(x => x.State).HasColumnName("state").HasColumnType("smallint").HasConversion<short>().IsRequired();
        FarmSetupColumns.MapWhoAndWhen(builder);

        builder.HasIndex(x => x.FarmId).HasDatabaseName("ix_farm_motors_farm");
        builder.HasIndex(x => x.WaterSourceId).HasDatabaseName("ix_farm_motors_source");
        builder.Ignore(x => x.DomainEvents);
    }
}

/// <summary><c>ssf.farm_power_times</c>: one row per farm, the whole timetable as one validated document. The key IS the farm's id.</summary>
internal sealed class FarmPowerTimesConfiguration : IEntityTypeConfiguration<FarmPowerTimes>
{
    public void Configure(EntityTypeBuilder<FarmPowerTimes> builder)
    {
        builder.ToTable("farm_power_times", t =>
        {
            t.HasCheckConstraint("ck_farm_power_times_revision", "revision >= 1");
            t.HasCheckConstraint("ck_farm_power_times_hash", "content_hash ~ '^[0-9a-f]{64}$'");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("farm_id").ValueGeneratedNever();
        builder.Property(x => x.Content).HasColumnName("content").HasColumnType("jsonb").IsRequired();
        builder.Property(x => x.ContentHash).HasColumnName("content_hash").HasMaxLength(64).IsRequired();
        builder.Property(x => x.Revision).HasColumnName("revision").IsRequired().IsConcurrencyToken();
        builder.Property(x => x.UpdatedByUserId).HasColumnName("updated_by_user_id").HasConversion(TypedIdConverters.UserId).IsRequired();
        builder.Property(x => x.UpdatedAtUtc).HasColumnName("updated_at_utc").IsRequired();

        builder.Ignore(x => x.FarmId);
        builder.Ignore(x => x.DomainEvents);
    }
}

/// <summary><c>ssf.farm_machines</c>: one row per machine of a farm.</summary>
internal sealed class FarmMachineConfiguration : IEntityTypeConfiguration<FarmMachine>
{
    public void Configure(EntityTypeBuilder<FarmMachine> builder)
    {
        builder.ToTable("farm_machines", t =>
        {
            t.HasCheckConstraint("ck_farm_machines_state", "state IN (0, 1)");
            t.HasCheckConstraint("ck_farm_machines_revision", "revision >= 1");
            t.HasCheckConstraint("ck_farm_machines_type", "machine_type IN ('tractor', 'blower', 'sprayer', 'rotavator', 'harvester', 'other')");
            t.HasCheckConstraint("ck_farm_machines_ownership", "ownership IN ('owned', 'rented')");
            t.HasCheckConstraint("ck_farm_machines_hp", "hp > 0");
            t.HasCheckConstraint("ck_farm_machines_nozzles", "nozzle_count > 0");
            t.HasCheckConstraint("ck_farm_machines_tank", "tank_litres > 0");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(x => x.FarmId).HasColumnName("farm_id").HasConversion(TypedIdConverters.FarmId).IsRequired();
        builder.Property(x => x.Name).HasColumnName("name").HasMaxLength(80).IsRequired();
        builder.Property(x => x.MachineType).HasColumnName("machine_type").HasMaxLength(12).IsRequired();
        builder.Property(x => x.Ownership).HasColumnName("ownership").HasMaxLength(8).IsRequired();
        builder.Property(x => x.Company).HasColumnName("company").HasMaxLength(60);
        builder.Property(x => x.Model).HasColumnName("model").HasMaxLength(60);
        builder.Property(x => x.Hp).HasColumnName("hp").HasColumnType("numeric(6,2)");
        builder.Property(x => x.NozzleCount).HasColumnName("nozzle_count").HasColumnType("smallint");
        builder.Property(x => x.TankLitres).HasColumnName("tank_litres").HasColumnType("numeric(8,2)");
        builder.Property(x => x.DetailLine).HasColumnName("detail_line").HasMaxLength(200);
        FarmSetupColumns.MapStateAndRevision(builder);
        FarmSetupColumns.MapWhoAndWhen(builder);

        builder.HasIndex(x => x.FarmId).HasDatabaseName("ix_farm_machines_farm");
        builder.Ignore(x => x.DomainEvents);
    }
}

/// <summary><c>ssf.plot_water_setups</c>: one row per plot that has ANSWERED the water question. The key IS the plot's id.</summary>
internal sealed class PlotWaterSetupConfiguration : IEntityTypeConfiguration<PlotWaterSetup>
{
    public void Configure(EntityTypeBuilder<PlotWaterSetup> builder)
    {
        builder.ToTable("plot_water_setups", t =>
        {
            t.HasCheckConstraint("ck_plot_water_setups_revision", "revision >= 1");
            t.HasCheckConstraint("ck_plot_water_setups_method", "irrigation_method IN ('drip', 'flood', 'sprinkler', 'none')");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("plot_id").ValueGeneratedNever();
        builder.Property(x => x.FarmId).HasColumnName("farm_id").HasConversion(TypedIdConverters.FarmId).IsRequired();
        builder.Property(x => x.Method).HasColumnName("irrigation_method").HasMaxLength(10).IsRequired();
        builder.Property(x => x.Revision).HasColumnName("revision").IsRequired().IsConcurrencyToken();
        builder.Property(x => x.UpdatedByUserId).HasColumnName("updated_by_user_id").HasConversion(TypedIdConverters.UserId).IsRequired();
        builder.Property(x => x.UpdatedAtUtc).HasColumnName("updated_at_utc").IsRequired();

        builder.HasIndex(x => x.FarmId).HasDatabaseName("ix_plot_water_setups_farm");
        builder.Ignore(x => x.PlotId);
        builder.Ignore(x => x.Links);
        builder.Ignore(x => x.DomainEvents);
    }
}

/// <summary>
/// <c>ssf.plot_water_links</c>: the many-to-many link of a plot to a source and (or not) a motor. The unique pair index
/// <c>ux_plot_water_links_pair (plot_id, water_source_id, COALESCE(motor_id, zero))</c> is an expression index, written in the migration.
/// </summary>
internal sealed class PlotWaterLinkConfiguration : IEntityTypeConfiguration<PlotWaterLink>
{
    public void Configure(EntityTypeBuilder<PlotWaterLink> builder)
    {
        builder.ToTable("plot_water_links", t => t.HasCheckConstraint("ck_plot_water_links_state", "state IN (0, 1)"));

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(x => x.FarmId).HasColumnName("farm_id").HasConversion(TypedIdConverters.FarmId).IsRequired();
        builder.Property(x => x.PlotId).HasColumnName("plot_id").IsRequired();
        builder.Property(x => x.WaterSourceId).HasColumnName("water_source_id").IsRequired();
        builder.Property(x => x.MotorId).HasColumnName("motor_id");
        builder.Property(x => x.State).HasColumnName("state").HasColumnType("smallint").HasConversion<short>().IsRequired();
        FarmSetupColumns.MapWhoAndWhen(builder);

        builder.HasIndex(x => x.FarmId).HasDatabaseName("ix_plot_water_links_farm");
        builder.HasIndex(x => x.PlotId).HasDatabaseName("ix_plot_water_links_plot");
        builder.HasIndex(x => x.MotorId).HasDatabaseName("ix_plot_water_links_motor");
        builder.Ignore(x => x.DomainEvents);
    }
}

/// <summary>The columns the farm-setup tables share, mapped by name (each entity declares them with the same names).</summary>
internal static class FarmSetupColumns
{
    internal static void MapStateAndRevision<T>(EntityTypeBuilder<T> builder)
        where T : class
    {
        builder.Property<FarmSetupState>("State").HasColumnName("state").HasColumnType("smallint").HasConversion<short>().IsRequired();
        builder.Property<int>("Revision").HasColumnName("revision").IsRequired().IsConcurrencyToken();
    }

    internal static void MapWhoAndWhen<T>(EntityTypeBuilder<T> builder)
        where T : class
    {
        builder.Property<AgriSync.SharedKernel.Contracts.Ids.UserId>("CreatedByUserId").HasColumnName("created_by_user_id").HasConversion(TypedIdConverters.UserId).IsRequired();
        builder.Property<DateTime>("CreatedAtUtc").HasColumnName("created_at_utc").IsRequired();
        builder.Property<AgriSync.SharedKernel.Contracts.Ids.UserId>("UpdatedByUserId").HasColumnName("updated_by_user_id").HasConversion(TypedIdConverters.UserId).IsRequired();
        builder.Property<DateTime>("UpdatedAtUtc").HasColumnName("updated_at_utc").IsRequired();
    }
}
