using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSubscriptionProjection : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Subscription read-projection for ShramSafal. We do NOT persist
            // subscription state in the ssf schema — Accounts owns it. The
            // view is the integration seam: ShramSafal reads from `ssf`
            // only, never touches `accounts.subscriptions` directly, so
            // the app-boundary (Architecture Ref §7) stays clean.
            //
            // When the real Outbox + projection pipeline lands in a later
            // hardening pass, this view is replaced by a materialised
            // table without any ShramSafal code change.
            migrationBuilder.Sql(@"
                CREATE OR REPLACE VIEW ssf.subscription_projections AS
                SELECT
                    s.subscription_id          AS subscription_id,
                    s.owner_account_id         AS owner_account_id,
                    s.plan_code                AS plan_code,
                    s.status                   AS status,
                    s.valid_from_utc           AS valid_from_utc,
                    s.valid_until_utc          AS valid_until_utc,
                    s.trial_ends_at_utc        AS trial_ends_at_utc,
                    s.created_at_utc           AS created_at_utc,
                    s.updated_at_utc           AS updated_at_utc
                FROM accounts.subscriptions s;
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP VIEW IF EXISTS ssf.subscription_projections;");
        }
    }
}
