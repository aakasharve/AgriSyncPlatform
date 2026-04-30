# Security Policy

AgriSyncPlatform handles farm operations data for smallholder farmers, including phone-based identity, memberships, crop activity logs, cost records, worker verification flows, offline device data, location-related context, voice/audio inputs, transcripts, and AI-extracted structured records. Security reports are taken seriously because a weakness can expose farmer privacy, business-sensitive farm economics, or operational records used for trust and verification.

Do not open public GitHub issues for suspected vulnerabilities. Use the private reporting process below.

## Supported Versions

This repository is currently pre-1.0 and follows branch-based security support.

| Version / branch                                              | Supported for security fixes                        |
| ------------------------------------------------------------- | --------------------------------------------------- |
| `main`                                                      | Yes                                                 |
| Latest production deployment built from `main`              | Yes                                                 |
| Active release branches explicitly named by maintainers       | Yes                                                 |
| Feature branches, forks, local developer builds, and old tags | No                                                  |
| Historical snapshots, including `pre-deploy-*` tags         | No, unless a maintainer explicitly confirms support |

When stable public releases begin, this table should be replaced with SemVer release ranges such as `1.x`, `0.9.x`, and unsupported end-of-life versions.

## Reporting a Vulnerability

Preferred channel:

1. Use GitHub Private Vulnerability Reporting for this repository:
   `https://github.com/aakasharve/AgriSyncPlatform/security/advisories/new`
2. If that link is unavailable, contact the repository owner privately on GitHub and include `[SECURITY] AgriSyncPlatform` in the message subject.

Before public launch, maintainers should add a monitored security email address, such as `security@<project-domain>`, and list it here as the fallback channel.

Please include:

- A clear description of the vulnerability and affected component.
- Steps to reproduce, proof of concept, or screenshots where appropriate.
- The affected branch, commit, version, environment, URL, or API route.
- Whether authentication is required and what role/account type is involved.
- Security impact: data exposure, account takeover, privilege escalation, data tampering, replay, denial of service, or privacy violation.
- Any evidence needed to verify the issue, using the minimum amount of data possible.

Do not include real farmer data, production secrets, private keys, access tokens, session cookies, or full database dumps in the report.

## Response Targets

| Severity | Examples                                                                                                                            | Initial response | Target fix window |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------- |
| Critical | Account takeover, production secret exposure, broad farmer data disclosure, unauthenticated data tampering                          | 1 business day   | 7 days            |
| High     | Privilege escalation, cross-tenant or cross-farm data access, exploitable auth/session flaw, stored XSS in authenticated app        | 3 business days  | 14 days           |
| Medium   | Limited data exposure, reflected XSS with user interaction, sync replay weakness with narrow impact, missing server-side validation | 5 business days  | 30 days           |
| Low      | Hardening gaps, low-impact information disclosure, defense-in-depth improvements                                                    | 7 business days  | 90 days           |

If a fix needs more time, maintainers should provide periodic updates through the private advisory thread.

## In Scope

Reports are especially valuable in these areas:

- Authentication, authorization, JWT handling, role and membership boundaries.
- Cross-farm, cross-user, or cross-operator data access.
- Offline-first sync, outbox replay, idempotency, conflict handling, and mutation ordering.
- Tampering with activity logs, cost records, verification workflows, or audit-relevant records.
- Exposure of phone numbers, farmer identity data, location context, voice recordings, transcripts, or AI-extracted records.
- Stored or reflected XSS in the React/Vite mobile PWA, admin web app, or Astro marketing site.
- Unsafe handling of IndexedDB, local storage, service workers, push/pull sync, or cached authenticated data.
- API input validation, file/media handling, CORS, CSRF if cookie auth is introduced, and security headers.
- Secrets in code, GitHub Actions, logs, build artifacts, mobile bundles, or frontend environment variables.
- Dependency, package, CI/CD, or supply-chain vulnerabilities with a credible exploit path.
- AI provider integration risks where prompt injection or model output could cause unauthorized state changes, privacy leakage, or unsafe automated decisions.

## Out of Scope

The following are generally out of scope unless they demonstrate a concrete security impact:

- Social engineering, phishing, spam, or physical attacks.
- Denial-of-service testing that degrades service for real users.
- Automated scanner output without a reproducible exploit or meaningful impact.
- Missing TLS or secure-cookie flags in local development environments.
- Local demo credentials, seeded test users, or development database passwords that are not used in production.
- Self-XSS requiring a user to paste code into developer tools.
- Reports requiring access to an already compromised user device, unlocked phone, browser profile, or developer machine.
- Clickjacking, CORS, or missing header findings with no sensitive action or data exposure path.
- Dependency advisories that do not affect reachable code paths, unless the advisory is critical or actively exploited.

## Safe Harbor

Security research is authorized when it follows these rules:

- Test only accounts, tenants, farms, devices, or data that you own or have explicit permission to use.
- Do not access, modify, delete, exfiltrate, or retain data belonging to other users.
- Stop testing and report immediately if you encounter real user data, production secrets, or broad access.
- Do not deploy malware, persistence, crypto miners, destructive payloads, or automated exploit chains.
- Do not perform high-volume, destructive, or availability-impacting testing.
- Do not publicly disclose the vulnerability until maintainers have confirmed a fix or coordinated disclosure plan.

Reports made in good faith under this policy will not be treated as hostile activity by the project maintainers.

## Coordinated Disclosure

Maintainers will triage the report, reproduce the issue, assign severity, and decide whether to fix privately before publishing an advisory. Once a fix or mitigation is available, maintainers may publish a GitHub Security Advisory, release notes, or a CVE if the issue affects distributed users.

If a report is declined, maintainers should explain why, such as duplicate report, out-of-scope issue, no reproducible impact, or intended behavior.

## Security Expectations for Contributors

Contributors must not commit secrets, production credentials, private keys, API tokens, or personal data. Frontend environment variables and mobile app bundles are public by design and must not contain secrets.

Security-sensitive changes should preserve these expectations:

- Server-side authorization is required for every protected resource and action.
- Client-side role checks are for user experience only and are not security controls.
- Public resource IDs should not be guessable where enumeration would expose sensitive data.
- State-changing API operations should validate input server-side and enforce idempotency where retries are expected.
- Offline and cached data should be scoped to the authenticated user/farm and cleared on logout or account switch.
- User-controlled text, transcripts, AI output, and imported data must be rendered safely to prevent XSS.
- Third-party scripts, analytics, AI providers, and SDKs should be minimized, reviewed, and pinned through lockfiles.
- Logs must avoid tokens, passwords, phone OTPs, sensitive headers, raw audio, and full personal records.

## Maintainer GitHub Security Checklist

Before relying on this policy publicly, maintainers should enable and review:

- GitHub Private Vulnerability Reporting.
- Dependabot alerts and Dependabot security updates.
- Secret scanning and push protection where available.
- Branch protection for `main`, requiring CI and review before merge.
- CodeQL or equivalent code scanning for .NET and JavaScript/TypeScript.
- Required `npm ci`, `dotnet restore`, build, test, and lint workflows on pull requests.
- A private incident response owner and a monitored security contact.
