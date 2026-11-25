using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Creators;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

// spec: plr-d10-schedule-approved-spec-2026-11-23 ("Making a schedule"); build plan slice 15 (the creator door), server half; migration AddCreatorDoor.
// Every table here is FORCE row security (see the migration): a creator sees his own rows, a staff checker sees what was sent, a farm sees nothing.

/// <summary><c>ssf.creator_profiles</c>: one invited outside schedule maker; an opaque id with no phone and no name once erased.</summary>
internal sealed class CreatorProfileConfiguration : IEntityTypeConfiguration<CreatorProfile>
{
    public void Configure(EntityTypeBuilder<CreatorProfile> builder)
    {
        builder.ToTable("creator_profiles", t =>
        {
            t.HasCheckConstraint("ck_creator_profiles_status", "status BETWEEN 0 AND 3");
            t.HasCheckConstraint("ck_creator_profiles_phone", "phone IS NULL OR phone ~ '^[6-9][0-9]{9}$'");
            t.HasCheckConstraint("ck_creator_profiles_erased", "(status = 3) = (phone IS NULL)");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(x => x.Phone).HasColumnName("phone").HasMaxLength(10);
        builder.Property(x => x.DisplayName).HasColumnName("display_name").HasMaxLength(CreatorProfile.MaxNameLength).IsRequired();
        builder.Property(x => x.Status).HasColumnName("status").HasConversion<short>().IsRequired();
        builder.Property(x => x.InvitedByUserId).HasColumnName("invited_by_user_id").IsRequired();
        builder.Property(x => x.InvitedAtUtc).HasColumnName("invited_at_utc").IsRequired();
        builder.Property(x => x.FirstSignedInAtUtc).HasColumnName("first_signed_in_at_utc");
        builder.Property(x => x.RevokedAtUtc).HasColumnName("revoked_at_utc");
        builder.Property(x => x.ErasedAtUtc).HasColumnName("erased_at_utc");
        builder.Property(x => x.ModifiedAtUtc).HasColumnName("modified_at_utc").IsRequired();

        builder.HasIndex(x => x.Phone).IsUnique().HasFilter("phone IS NOT NULL").HasDatabaseName("ux_creator_profiles_phone");
        builder.Ignore(x => x.MaySignIn);
        builder.Ignore(x => x.DomainEvents);
    }
}

/// <summary><c>ssf.creator_sign_in_codes</c>: the one-time codes of the creator door (its own, never the farmer door's).</summary>
internal sealed class CreatorSignInCodeConfiguration : IEntityTypeConfiguration<CreatorSignInCode>
{
    public void Configure(EntityTypeBuilder<CreatorSignInCode> builder)
    {
        builder.ToTable("creator_sign_in_codes", t =>
        {
            t.HasCheckConstraint("ck_creator_sign_in_codes_status", "status BETWEEN 0 AND 3");
            t.HasCheckConstraint("ck_creator_sign_in_codes_hash", "code_hash ~ '^[0-9a-f]{64}$'");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(x => x.Phone).HasColumnName("phone").HasMaxLength(10).IsRequired();
        builder.Property(x => x.CodeHash).HasColumnName("code_hash").HasMaxLength(64).IsRequired();
        builder.Property(x => x.IssuedAtUtc).HasColumnName("issued_at_utc").IsRequired();
        builder.Property(x => x.ExpiresAtUtc).HasColumnName("expires_at_utc").IsRequired();
        builder.Property(x => x.Attempts).HasColumnName("attempts").IsRequired();
        builder.Property(x => x.MaxAttempts).HasColumnName("max_attempts").IsRequired();
        builder.Property(x => x.Status).HasColumnName("status").HasConversion<short>().IsRequired();

        builder.HasIndex(x => new { x.Phone, x.IssuedAtUtc }).HasDatabaseName("ix_creator_sign_in_codes_phone_issued");
        builder.HasIndex(x => x.Phone).IsUnique().HasFilter("status = 0").HasDatabaseName("ux_creator_sign_in_codes_pending");
        builder.Ignore(x => x.DomainEvents);
    }
}

/// <summary><c>ssf.creator_sessions</c>: one signed-in browser of a creator; the refresh credential as a hash, bound to the browser's device id.</summary>
internal sealed class CreatorSessionConfiguration : IEntityTypeConfiguration<CreatorSession>
{
    public void Configure(EntityTypeBuilder<CreatorSession> builder)
    {
        builder.ToTable("creator_sessions", t =>
        {
            t.HasCheckConstraint("ck_creator_sessions_token_hash", "token_hash ~ '^[0-9a-f]{64}$'");
            t.HasCheckConstraint("ck_creator_sessions_device_hash", "device_id_hash ~ '^[0-9a-f]{64}$'");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(x => x.CreatorId).HasColumnName("creator_id").IsRequired();
        builder.Property(x => x.TokenHash).HasColumnName("token_hash").HasMaxLength(64).IsRequired();
        builder.Property(x => x.DeviceIdHash).HasColumnName("device_id_hash").HasMaxLength(64).IsRequired();
        builder.Property(x => x.IssuedAtUtc).HasColumnName("issued_at_utc").IsRequired();
        builder.Property(x => x.LastUsedAtUtc).HasColumnName("last_used_at_utc").IsRequired();
        builder.Property(x => x.ExpiresAtUtc).HasColumnName("expires_at_utc").IsRequired();
        builder.Property(x => x.RevokedAtUtc).HasColumnName("revoked_at_utc");

        builder.HasIndex(x => x.TokenHash).IsUnique().HasDatabaseName("ux_creator_sessions_token_hash");
        builder.HasIndex(x => x.CreatorId).HasDatabaseName("ix_creator_sessions_creator");
        builder.Ignore(x => x.DomainEvents);
    }
}

/// <summary><c>ssf.creator_submissions</c>: one round of a creator's work; a library row only after a staff checker approves it.</summary>
internal sealed class CreatorSubmissionConfiguration : IEntityTypeConfiguration<CreatorSubmission>
{
    public void Configure(EntityTypeBuilder<CreatorSubmission> builder)
    {
        builder.ToTable("creator_submissions", t =>
        {
            t.HasCheckConstraint("ck_creator_submissions_state", "state BETWEEN 0 AND 3");
            t.HasCheckConstraint("ck_creator_submissions_round", "round >= 1");
            t.HasCheckConstraint("ck_creator_submissions_library", "(state = 3) = (library_template_id IS NOT NULL)");
            t.HasCheckConstraint("ck_creator_submissions_sent", "(state = 0) = (submitted_at_utc IS NULL)");
            t.HasCheckConstraint("ck_creator_submissions_expiry", "(state = 0) = (expires_at_utc IS NOT NULL)");
            t.HasCheckConstraint("ck_creator_submissions_body_size", "octet_length(body::text) <= 1048576");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(x => x.CreatorId).HasColumnName("creator_id").IsRequired();
        builder.Property(x => x.WorkId).HasColumnName("work_id").IsRequired();
        builder.Property(x => x.Round).HasColumnName("round").IsRequired();
        builder.Property(x => x.Title).HasColumnName("title").HasMaxLength(CreatorSubmission.MaxTitleLength).IsRequired();
        builder.Property(x => x.BodyJson).HasColumnName("body").HasColumnType("jsonb").IsRequired();
        builder.Property(x => x.State).HasColumnName("state").HasConversion<short>().IsRequired();
        builder.Property(x => x.ContentHash).HasColumnName("content_hash").HasMaxLength(64);
        builder.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc").IsRequired();
        builder.Property(x => x.ModifiedAtUtc).HasColumnName("modified_at_utc").IsRequired();
        builder.Property(x => x.SubmittedAtUtc).HasColumnName("submitted_at_utc");
        builder.Property(x => x.DecidedAtUtc).HasColumnName("decided_at_utc");
        builder.Property(x => x.ExpiresAtUtc).HasColumnName("expires_at_utc");
        builder.Property(x => x.LibraryTemplateId).HasColumnName("library_template_id");

        builder.HasIndex(x => x.CreatorId).HasDatabaseName("ix_creator_submissions_creator");
        builder.HasIndex(x => new { x.WorkId, x.Round }).IsUnique().HasDatabaseName("ux_creator_submissions_work_round");
        builder.HasIndex(x => x.State).HasDatabaseName("ix_creator_submissions_state");
        builder.Ignore(x => x.DomainEvents);
    }
}

/// <summary><c>ssf.creator_submission_decisions</c>: what staff decided about a round, with the reasons of a return. APPEND-ONLY by privilege.</summary>
internal sealed class CreatorSubmissionDecisionConfiguration : IEntityTypeConfiguration<CreatorSubmissionDecision>
{
    public void Configure(EntityTypeBuilder<CreatorSubmissionDecision> builder)
    {
        builder.ToTable("creator_submission_decisions", t =>
        {
            t.HasCheckConstraint("ck_creator_submission_decisions_decision", "decision IN (0, 1)");
            t.HasCheckConstraint(
                "ck_creator_submission_decisions_shape",
                "(decision = 0 AND reasons IS NOT NULL AND length(btrim(reasons)) > 0 AND library_template_id IS NULL) OR (decision = 1 AND library_template_id IS NOT NULL)");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(x => x.SubmissionId).HasColumnName("submission_id").IsRequired();
        builder.Property(x => x.CreatorId).HasColumnName("creator_id").IsRequired();
        builder.Property(x => x.Decision).HasColumnName("decision").HasConversion<short>().IsRequired();
        builder.Property(x => x.Reasons).HasColumnName("reasons").HasMaxLength(CreatorSubmissionDecision.MaxReasonsLength);
        builder.Property(x => x.DecidedByUserId).HasColumnName("decided_by_user_id").IsRequired();
        builder.Property(x => x.DecidedAtUtc).HasColumnName("decided_at_utc").IsRequired();
        builder.Property(x => x.LibraryTemplateId).HasColumnName("library_template_id");
        builder.Property(x => x.ContentHash).HasColumnName("content_hash").HasMaxLength(64);

        builder.HasIndex(x => x.SubmissionId).IsUnique().HasDatabaseName("ux_creator_submission_decisions_submission");
        builder.HasIndex(x => x.CreatorId).HasDatabaseName("ix_creator_submission_decisions_creator");
        builder.Ignore(x => x.DomainEvents);
    }
}

/// <summary><c>ssf.creator_files</c>: the metadata of a creator's file; the bytes are under their own storage prefix. Quarantined until the scanner decides.</summary>
internal sealed class CreatorFileConfiguration : IEntityTypeConfiguration<CreatorFile>
{
    public void Configure(EntityTypeBuilder<CreatorFile> builder)
    {
        builder.ToTable("creator_files", t =>
        {
            t.HasCheckConstraint("ck_creator_files_state", "state BETWEEN 0 AND 2");
            t.HasCheckConstraint("ck_creator_files_size", "size_bytes > 0 AND size_bytes <= 10485760");
            t.HasCheckConstraint("ck_creator_files_hash", "content_hash ~ '^[0-9a-f]{64}$'");
            t.HasCheckConstraint("ck_creator_files_mime", "state = 2 OR mime_type IN ('application/pdf', 'image/jpeg', 'image/png')");
            t.HasCheckConstraint("ck_creator_files_blocked_words", "state <> 2 OR scan_words IS NOT NULL");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(x => x.CreatorId).HasColumnName("creator_id").IsRequired();
        builder.Property(x => x.WorkId).HasColumnName("work_id").IsRequired();
        builder.Property(x => x.SubmissionId).HasColumnName("submission_id").IsRequired();
        builder.Property(x => x.FileName).HasColumnName("file_name").HasMaxLength(CreatorFile.MaxNameLength).IsRequired();
        builder.Property(x => x.MimeType).HasColumnName("mime_type").HasMaxLength(60).IsRequired();
        builder.Property(x => x.SizeBytes).HasColumnName("size_bytes").IsRequired();
        builder.Property(x => x.ContentHash).HasColumnName("content_hash").HasMaxLength(64).IsRequired();
        builder.Property(x => x.StorageKey).HasColumnName("storage_key").HasMaxLength(200).IsRequired();
        builder.Property(x => x.State).HasColumnName("state").HasConversion<short>().IsRequired();
        builder.Property(x => x.ScannerName).HasColumnName("scanner_name").HasMaxLength(60);
        builder.Property(x => x.ScanWords).HasColumnName("scan_words").HasMaxLength(300);
        builder.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc").IsRequired();
        builder.Property(x => x.ScannedAtUtc).HasColumnName("scanned_at_utc");

        builder.HasIndex(x => x.WorkId).HasDatabaseName("ix_creator_files_work");
        builder.HasIndex(x => x.CreatorId).HasDatabaseName("ix_creator_files_creator");
        builder.Ignore(x => x.DomainEvents);
    }
}

/// <summary><c>ssf.creator_terms_acceptances</c>: a creator agreed to one version of the creator terms. APPEND-ONLY by privilege.</summary>
internal sealed class CreatorTermsAcceptanceConfiguration : IEntityTypeConfiguration<CreatorTermsAcceptance>
{
    public void Configure(EntityTypeBuilder<CreatorTermsAcceptance> builder)
    {
        builder.ToTable("creator_terms_acceptances");

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(x => x.CreatorId).HasColumnName("creator_id").IsRequired();
        builder.Property(x => x.TermsVersion).HasColumnName("terms_version").HasMaxLength(CreatorTermsAcceptance.MaxVersionLength).IsRequired();
        builder.Property(x => x.AcceptedAtUtc).HasColumnName("accepted_at_utc").IsRequired();

        builder.HasIndex(x => new { x.CreatorId, x.TermsVersion }).IsUnique().HasDatabaseName("ux_creator_terms_acceptances_creator_version");
        builder.Ignore(x => x.DomainEvents);
    }
}
