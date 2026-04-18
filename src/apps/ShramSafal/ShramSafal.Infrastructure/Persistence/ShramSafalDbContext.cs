using Microsoft.EntityFrameworkCore;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Infrastructure.Persistence;

public sealed class ShramSafalDbContext(DbContextOptions<ShramSafalDbContext> options) : DbContext(options)
{
    public DbSet<Farm> Farms => Set<Farm>();
    public DbSet<FarmMembership> FarmMemberships => Set<FarmMembership>();
    public DbSet<Plot> Plots => Set<Plot>();
    public DbSet<CropCycle> CropCycles => Set<CropCycle>();
    public DbSet<DailyLog> DailyLogs => Set<DailyLog>();
    public DbSet<LogTask> LogTasks => Set<LogTask>();
    public DbSet<VerificationEvent> VerificationEvents => Set<VerificationEvent>();
    public DbSet<CostEntry> CostEntries => Set<CostEntry>();
    public DbSet<FinanceCorrection> FinanceCorrections => Set<FinanceCorrection>();
    public DbSet<DayLedger> DayLedgers => Set<DayLedger>();
    public DbSet<Attachment> Attachments => Set<Attachment>();
    public DbSet<PriceConfig> PriceConfigs => Set<PriceConfig>();
    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();
    public DbSet<AiJob> AiJobs => Set<AiJob>();
    public DbSet<AiJobAttempt> AiJobAttempts => Set<AiJobAttempt>();
    public DbSet<AiProviderConfig> AiProviderConfigs => Set<AiProviderConfig>();
    public DbSet<ScheduleTemplate> ScheduleTemplates => Set<ScheduleTemplate>();
    public DbSet<TemplateActivity> TemplateActivities => Set<TemplateActivity>();
    public DbSet<PlannedActivity> PlannedActivities => Set<PlannedActivity>();
    public DbSet<DocumentExtractionSession> DocumentExtractionSessions => Set<DocumentExtractionSession>();
    internal DbSet<SyncMutationRecord> SyncMutations => Set<SyncMutationRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("ssf");
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ShramSafalDbContext).Assembly);
    }
}
