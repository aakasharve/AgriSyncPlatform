# AWS cost — today, and under the "Telegram model"

**Date:** 2026-08-14
**Account:** `951921970996`, region `ap-south-1` (Mumbai) — verified, single-account prod scope
**Method:** actual Cost Explorer billing data + AWS Price List Query API + read-only `describe`/`list` calls
**Nothing was mutated. Nothing was woken.** Both EC2 and RDS were already running when inspected (the
05:30 IST auto-wake had fired at `2026-08-14T00:00:49Z`).
**FX used:** ₹95.5 = $1 (Aug 13 2026 spot) — [estimated, market rate]

Every figure below is tagged **[MEASURED]** (from the real bill or a real API), **[AUTHORITATIVE]**
(from the AWS Price List API, i.e. current published ap-south-1 price), **[ESTIMATED]** (derived by
arithmetic from those), or **[ASSUMED]** (a stated modelling assumption that could be wrong).

---

## 0. The one-paragraph answer

He pays **₹4,951/month (~$51.84)** today and would pay **₹5,569/month (~$58.31)** the day he stops
hibernating. Almost all of it is fixed — the same bill arrives whether he has 1 farmer or 1,000. One
extra farmer's *data* costs between **₹2.8 and ₹16 per year**. The Telegram model (server holds
everything, any device sees everything) is essentially free at his scale; the thing that makes it
expensive later is not the idea, it is that **there is no image compression anywhere in the codebase**
— verified — so every photo is uploaded at full camera resolution. Fix that one thing and the
Telegram model costs him almost nothing up to 10,000 farmers. Leave it, and it costs ~₹18,500/month
more at 10,000 farmers than it needs to.

---

## 1. What is actually running

All **[MEASURED]** — from read-only `aws ec2 / rds / s3api / cloudfront / route53 describe|list`.

| Component | Actual configuration |
|---|---|
| **EC2** | 1 × `i-024b3537191712c76`, **t3.small** (2 vCPU / 2 GiB), ap-south-1a, Linux |
| **EBS** | 1 × `vol-0abefa380033a232b`, **30 GB gp3**, 3000 IOPS, 125 MB/s |
| **Elastic IP** | `43.205.20.55`, allocated + attached |
| **RDS** | `shramsafal-prod-db`, **db.t4g.micro** (2 vCPU / 1 GiB), PostgreSQL 16.13 |
| RDS storage | **20 GB gp3**, 3000 IOPS, **Single-AZ**, **not publicly accessible** |
| RDS backups | **7-day retention**; Performance Insights **off**; storage autoscaling **off** (`MaxAllocatedStorage = null`) |
| **S3** | 8 buckets, total **≈ 4.51 GB** across ~115,000 objects |
| **CloudFront** | 3 distributions — `app.` (PriceClass_200), `shramsafal.in`+`www.` (200), `admin.` (All) |
| CloudFront origins | **static-site buckets only** — `app-prod`, `marketing-prod`, `admin-prod` |
| **Route 53** | 1 public hosted zone `shramsafal.in.` (9 records) + **2 health checks** |
| **Secrets Manager** | **7 secrets** |
| **KMS** | 1 billable customer-managed key |
| **Load balancers** | **none** |
| **NAT gateways** | **none** |
| **EBS snapshots** | **none** |
| Hibernation | Lambda `agrisync-prod-nap`, sleeps 01:00 IST, wakes 05:30 IST — **4.5 h/day off** |

### S3 breakdown — [MEASURED] via CloudWatch `BucketSizeBytes` / `NumberOfObjects`

| Bucket | Size | Objects | What it is |
|---|---|---|---|
| `shramsafal-app-prod` | 3.47 GB | 4,764 | web app static site + accumulated deploy history |
| `shramsafal-uploads-prod` | 731.7 MB | 48 | `_deploy/ _deploys/ apk/ attachments/ deploys/` |
| `shramsafal-cloudtrail-prod-951921970996` | 148.6 MB | **109,980** | CloudTrail logs, **no lifecycle rule** |
| `agrisync-raw-ap-south-1` | 130.0 MB | 391 | |
| `shramsafal-marketing-prod` | 26.9 MB | 3 | |
| `shramsafal-admin-prod` | 1.9 MB | 97 | |
| `agrisync-snapshots-prod` | 5.8 KB | 4 | never used — no snapshot has run |
| `shramsafal-voice-retained-prod` | empty | 0 | |

> ### ⚠ The single most important measurement in this document
>
> `s3://shramsafal-uploads-prod/attachments/` contains **4 objects totalling 83 bytes** — all of them
> test files named `phase3-upload.txt` / `phase5-upload.txt` from March 2026. **[MEASURED]**
>
> And the database is using **1.76 GB of its 20 GB** (`FreeStorageSpace` = 18.24 GB) — which is schema
> plus the single Purvesh seed user. **[MEASURED]**
>
> **There is no farmer data in production.** Therefore every per-farmer number in this document is a
> model, not a measurement, and the entire current bill is fixed cost.

### Utilisation — [MEASURED], CloudWatch, 24 h to 2026-08-14

| | Average | Peak |
|---|---|---|
| RDS CPU | 3.9 – 4.1 % | 36 – 41 % |
| EC2 CPU | 1.1 % | 13 – 19 % |

Both are far below capacity — as expected with zero users. This tells us the hardware is not the
bottleneck today; it tells us **nothing** about what it does under load.

---

## 2. Today's bill, itemised

### 2.1 The real monthly totals — [MEASURED], Cost Explorer `UnblendedCost`

| Month | Usage | Credits | Tax (18% GST) | **Paid** |
|---|---:|---:|---:|---:|
| Apr 2026 | ~0 | — | 0 | **$0.00** |
| May 2026 | $58.55 | −$58.55 | $0 | **$0.00** |
| Jun 2026 | $69.38 | −$30.22 | $7.06 | **$46.22** |
| **Jul 2026** | **$43.93** | **none** | **$7.91** | **$51.84** |
| Aug 1–13 | $18.47 | none | $3.32 | $21.79 (→ **$50.96**/mo run-rate) |

> **Worth flagging: the credits ran out.** May was fully covered, June was half covered, **July is the
> first month he actually paid full price.** If his mental model of "what AWS costs" was formed before
> July, it is wrong by about ₹4,400/month. **[MEASURED]**

**July 2026 is the honest current answer: $51.84 = ₹4,951/month.**

### 2.2 July 2026 line by line — [MEASURED], grouped by `USAGE_TYPE`, GST-inclusive

| # | Line item | Quantity | USD | INR |
|---:|---|---|---:|---:|
| 1 | EC2 compute `t3.small` | 601.4 hrs | $15.89 | ₹1,518 |
| 2 | RDS compute `db.t4g.micro` | 602.4 hrs | $14.93 | ₹1,426 |
| 3 | Public IPv4 — in use | 604.9 hrs | $3.56 | ₹340 |
| 4 | Secrets Manager | 7 secrets | $3.30 | ₹315 |
| 5 | EBS gp3 | 30 GB | $3.23 | ₹308 |
| 6 | RDS gp3 storage | 19.4 GB-mo | $3.00 | ₹286 |
| 7 | Route 53 health checks | 2 | $2.36 | ₹225 |
| 8 | RDS backup storage (billable) | 17.9 GB-mo | $2.01 | ₹192 |
| 9 | KMS customer-managed key | 1 | $1.18 | ₹113 |
| 10 | Public IPv4 — idle (during nap) | 139.2 hrs | $0.83 | ₹79 |
| 11 | Route 53 hosted zone | 1 | $0.59 | ₹56 |
| 12 | Inter-region transfer (health checkers) | ~4.5 GB | $0.46 | ₹44 |
| 13 | S3 PUT requests | 24,615 | $0.14 | ₹14 |
| 14 | Route 53 DNS queries | 289,993 | $0.14 | ₹13 |
| 15 | S3 storage | 3.82 GB-mo | $0.12 | ₹11 |
| 16 | Misc API / ACM | — | $0.09 | ₹9 |
| 17 | S3 GET + regional transfer | 16,901 | $0.02 | ₹2 |
| | **TOTAL** | | **$51.84** | **₹4,951** |

Arithmetic check: `15.89+14.93+3.56+3.30+3.23+3.00+2.36+2.01+1.18+0.83+0.59+0.46+0.14+0.14+0.12+0.09+0.02 = 51.85` ✓
(matches the Cost Explorer total of $51.835 to rounding).

### 2.3 Unit prices confirmed by the real bill

Dividing measured spend by measured quantity, then removing 18% GST, reproduces the published
ap-south-1 list price to 3 decimal places on every line — a good cross-check that the model below is
built on real numbers. **[MEASURED → AUTHORITATIVE]**

| Resource | Derived from bill | Published ap-south-1 |
|---|---:|---:|
| EC2 t3.small | $0.02239/hr | **$0.0224/hr** ✓ |
| RDS db.t4g.micro | $0.02100/hr | **$0.0210/hr** ✓ |
| EBS gp3 | $0.09113/GB-mo | **$0.0912/GB-mo** ✓ |
| RDS gp3 | $0.13115/GB-mo | **$0.1310/GB-mo** ✓ |
| RDS backup | $0.09519/GB-mo | **$0.0950/GB-mo** ✓ |
| S3 Standard | $0.02562/GB-mo | **$0.0250/GB-mo** ✓ |
| Public IPv4 | $0.00499/hr | **$0.0050/hr** ✓ |
| Secrets Manager | $0.39949/secret-mo | **$0.4000/secret-mo** ✓ |

### 2.4 Hibernated vs awake

The nap only stops compute **4.5 hours a day** (01:00–05:30 IST = 19% of the day). So:

| Scenario | EC2 hrs | RDS hrs | Monthly USD | Monthly INR |
|---|---:|---:|---:|---:|
| **Today (auto-nap, 4.5 h/day off)** | 601 | 602 | **$51.84** | **₹4,951** |
| **Awake 24/7 (launch day)** | 730 | 730 | **$58.31** | **₹5,569** |
| Full manual hibernate (wake 2 h/day only) | 60 | 60 | $24.01 | ₹2,293 |

Arithmetic for awake: EC2 `$15.89 × 730/601.4 = $19.29`; RDS `$14.93 × 730/602.4 = $18.09`; the two
IPv4 lines merge into `730 × $0.005893 = $4.30` (idle and in-use are billed at the same rate, so the
nap saves nothing there); all other lines unchanged at `$51.84 − 15.89 − 14.93 − 3.56 − 0.83 = $16.63`.
Total `19.29 + 18.09 + 4.30 + 16.63 = $58.31`. **[ESTIMATED from MEASURED]**

> ### ⚠ Correction: `aws/hibernate/README.md` is stale
>
> It claims "always-on ~₹4,800/mo vs hibernated ~₹1,500–1,750/mo" and "saves ~₹500/mo".
> **Measured, the auto-nap saves ₹618/month** (₹5,569 − ₹4,951), and the hibernated bill is **₹4,951,
> not ₹1,500.** The README's numbers described the old manual workflow where things stayed off for
> days. Since the auto-nap went live (2026-06-26) prod is up 19.5 h/day, so the saving is a fifth of
> what the doc says. This is worth correcting because it is currently overstating how much the
> hibernation discipline is buying him.

**Day-one-of-launch answer: turning off the nap costs him ₹618/month.** That is the entire price of
"the app is never down." It is not a decision worth agonising over.

---

## 3. What scales with farmers, and what doesn't

### 3.1 Fixed — arrives whether he has 1 farmer or 10,000

| Item | USD/mo (awake) | INR/mo |
|---|---:|---:|
| EC2 compute | $19.29 | ₹1,842 |
| RDS compute | $18.09 | ₹1,728 |
| Public IPv4 | $4.30 | ₹411 |
| Secrets Manager (7) | $3.30 | ₹315 |
| EBS 30 GB | $3.23 | ₹308 |
| RDS storage (20 GB floor) | $3.00 | ₹286 |
| Route 53 health checks (2) | $2.36 | ₹225 |
| RDS backup floor | $2.01 | ₹192 |
| KMS key | $1.18 | ₹113 |
| Route 53 zone + queries | $0.73 | ₹70 |
| Inter-region (health checkers) | $0.46 | ₹44 |
| S3 for his own artifacts/APKs/CloudTrail | $0.28 | ₹27 |
| **Fixed total** | **$58.23** | **₹5,561** |

For modelling I split this into **compute ($37.38)**, **RDS storage+backup ($5.01)**, and
**everything-else-fixed ($15.64)** — the last bucket does not move at any farmer count.

### 3.2 Per-farmer — marginal cost of one more farmer

| Resource | Marginal price (pre-tax) | Source |
|---|---:|---|
| S3 Standard storage | $0.0250/GB-mo | **[AUTHORITATIVE]** Price List API |
| S3 Standard-IA | $0.0138/GB-mo | **[AUTHORITATIVE]** |
| S3 Glacier Instant Retrieval | $0.0050/GB-mo | **[AUTHORITATIVE]** |
| S3 Glacier Flexible | $0.0045/GB-mo | **[AUTHORITATIVE]** |
| S3 PUT | $0.005 / 1,000 | **[AUTHORITATIVE]** |
| S3 GET | $0.0004 / 1,000 | **[AUTHORITATIVE]** |
| RDS gp3 storage | $0.1310/GB-mo | **[AUTHORITATIVE]** |
| RDS backup (beyond allocated) | $0.0950/GB-mo | **[AUTHORITATIVE]** |
| **Egress to internet** (S3 or EC2) | **$0.1093/GB** (first 10 TB/mo) | **[AUTHORITATIVE]** |
| CloudFront → India | $0.1090/GB (first 10 TB/mo) | **[AUTHORITATIVE]** |

**Free allowances — confirmed live on this account [MEASURED]:** in July he transferred **1.10 GB out
to the internet** and **1.38 GB out of CloudFront** and was charged **$0.00 for both**. The AWS
always-free tiers (100 GB/mo internet egress, 1 TB/mo CloudFront egress) are active. This is not a
memory claim — it is visible in his own bill as a zero-cost line with a non-zero quantity.

### 3.3 The cliff edges — where he must spend a step-change

| # | Cliff | Trigger | Cost of stepping up |
|---|---|---|---|
| **1** | **RDS RAM — the real one.** `db.t4g.micro` has **1 GiB**. Postgres needs the working set in memory or every query hits disk. | **[ESTIMATED] ~300–1,000 active farmers** | → `db.t4g.small` (2 GiB) **$30.66/mo** (+$15.33) → `db.t4g.medium` (4 GiB) **$61.32/mo** |
| **2** | **RDS disk.** 20 GB allocated, **autoscaling OFF**. | ~3,300 farmer-years of text at 6 MB each | Storage is cheap ($0.131/GB-mo) — but **a full disk with autoscaling off is a hard outage, not a bill.** Turn autoscaling on; that is a reliability fix, not a cost one. |
| **3** | **EC2 request capacity.** t3.small, 2 vCPU burstable, 1% CPU today. | **[ESTIMATED] >10,000 farmers** on request volume alone (10k farmers × 20 calls/day ≈ 2.3 req/s average) | → `t4g.medium` (4 GiB) at **$16.35/mo — identical to today's t3.small** |
| **4** | **Redundancy.** One EC2, one RDS, no load balancer, Single-AZ. | When downtime costs revenue, not at a farmer count | Roughly doubles compute + adds a load balancer. **A business decision, not a scaling one.** |
| **5** | **Egress leaves the free tier.** 100 GB/month free. | **[ESTIMATED] ~3,000 farmers** if photos are uncompressed and pulled eagerly; **never below 10,000** if compressed | $0.1093/GB beyond 100 GB |

---

## 4. The Telegram-model delta

The model: server holds every farmer's full history; any device logs in and sees everything; nothing
is lost unless deliberately deleted.

### 4.1 Footprint assumptions — [ASSUMED], pending the parallel measurement

There is no farmer data in prod, so these are modelling inputs. Swap them when the real numbers land;
every figure downstream is linear in them.

| Input | Value | Basis |
|---|---|---|
| Durable text per farmer per day | 5 KB | **[ASSUMED]** — brief says "kilobytes per day" |
| → per farmer-year, raw | 1.8 MB | `5 KB × 365` |
| → with indexes + append-only audit overhead (×3) | **6 MB/farmer/year in RDS** | **[ASSUMED]** ×3 multiplier |
| Photos per farmer per week | 2 | **[ASSUMED]** |
| → per farmer-year | 104 photos | `2 × 52` |
| **Scenario A** — photo size **as the code stands today** | **4 MB** → **416 MB/farmer/yr** | **[ASSUMED]** typical Android camera JPEG |
| **Scenario B** — photo size **if compressed at capture** (1280 px long edge, q≈0.72) | **200 KB** → **20.8 MB/farmer/yr** | **[ASSUMED]** standard result for that setting |

> ### ⚠ Scenario A is the current state of the code — verified
>
> **There is no image compression anywhere in the frontend.** **[MEASURED]** The two upload paths —
> `features/logs/components/harvest/PattiUploadSheet.tsx:107` and
> `features/procurement/components/ReceiptCaptureSheet.tsx:266-267` — are plain
> `<input type="file" accept="image/*">` (the second adds `capture="environment"`). There is no
> `canvas`, no `toBlob`, no resize, no quality parameter, and no compression library in
> `package.json`. `@capacitor/camera` is installed but **never called** — `getPhoto` and
> `CameraResultType` appear nowhere in `src/`.
>
> **Whatever the phone's camera produces goes to S3 untouched.** The 20× gap between Scenario A and
> Scenario B is not a hypothetical optimisation — it is the difference between the code as written and
> the code with one utility function added.

### 4.2 Storage cost per farmer-year — [ESTIMATED]

Cost to hold **one farmer-year of data for a full 12 months**:

**Scenario A (uncompressed — today's code):**
```
S3 photos      0.416 GB × $0.0250/GB-mo × 12 mo = $0.1248
RDS text       0.006 GB × $0.1310/GB-mo × 12 mo = $0.0094
RDS backup     0.006 GB × $0.0950/GB-mo × 12 mo = $0.0068
S3 PUTs        ~500 writes/yr × $0.005/1,000     = $0.0025
                                          TOTAL   $0.1435/farmer/year
```
= **$0.144 = ₹13.7/farmer/year** pre-tax, **₹16.2 with GST**

**Scenario B (compressed):**
```
S3 photos     0.0208 GB × $0.0250/GB-mo × 12 mo = $0.0062
RDS text + backup + PUTs (unchanged)            = $0.0187
                                          TOTAL   $0.0249/farmer/year
```
= **$0.025 = ₹2.4/farmer/year** pre-tax, **₹2.8 with GST**

Note this **accumulates**: a farmer in year 3 is holding 3 farmer-years, so his year-3 storage cost is
~3× the above. Over 10 years a farmer generates `1+2+…+10 = 55` farmer-year-years of storage:

- Scenario A: `55 × $0.1435 = $7.89` = **₹754** pre-tax, **₹890 with GST** — averaging ₹89/year
- Scenario B: `55 × $0.0249 = $1.37` = **₹131** pre-tax, **₹154 with GST** — averaging ₹15/year

A **decade** of a farmer's complete history costs between ₹154 and ₹890 to hold. This is not a number
that constrains anything.

### 4.3 First login on a new device — the transfer question

This is where the Telegram model could genuinely bite, because **egress is the expensive direction**
($0.1093/GB out vs $0 in).

**Cost of one full-history download**, by strategy — **[ESTIMATED]**:

| Strategy | Bytes pulled (1 yr of history) | Egress cost | INR |
|---|---:|---:|---:|
| **Eager, uncompressed** (today's code, naive sync) | 418 MB | $0.0457 | ₹4.4 |
| Eager, uncompressed, **3 years** of history | 1.25 GB | $0.1366 | ₹13.0 |
| **Eager, compressed** | 23 MB | $0.0025 | ₹0.24 |
| **Text eager + thumbnails only, photos on demand** | 4 MB | $0.0004 | ₹0.04 |

> **The important nuance:** Telegram itself does **not** download your whole history on login. It
> pulls the message index and fetches media lazily as you scroll. If AgriSync pulls text eagerly
> (kilobytes — trivial) and photos on demand or thumbnail-first, the transfer question **disappears
> entirely**. If it pulls every full-resolution photo eagerly, egress becomes the largest per-farmer
> cost at scale. This is a sync-design choice, not an infrastructure cost.
>
> *(Stated as a fact about cost, not as an architecture proposal — he asked what it costs, and the
> answer depends on which of these the sync does.)*

**And for a long while it is free anyway.** The 100 GB/month free egress allowance covers
`100 / 0.418 = 239` full uncompressed re-syncs per month. At 1,000 farmers each replacing a phone once
a year, that is 83 re-syncs/month — **still inside the free tier**. Egress only starts costing money
somewhere around **3,000 farmers under Scenario A**, and essentially never under Scenario B.

### 4.4 Does the Telegram model force bigger compute?

**No, not from the storage side.** Bytes at rest in S3 cost nothing in CPU or RAM. What forces a bigger
RDS is **query working set** — how much history the database must keep hot to answer a farmer's normal
screen. Holding 10 years of history costs disk (cheap); *querying across* 10 years on every screen load
costs RAM (the cliff).

The cliff is driven by **active farmers**, not by history depth, provided queries are bounded by recency.
**[ESTIMATED] ~300–1,000 active farmers** for the `db.t4g.micro` → `db.t4g.small` step. That step would
happen with or without the Telegram model.

**Honest bottom line on the delta:** the Telegram model adds **₹2.8–₹16 per farmer per year** and does
not move the compute cliff. It is not an expensive idea.

---

## 5. The bill at 100 / 1,000 / 10,000 farmers

All figures are **awake 24/7, GST-inclusive, year-1 data volumes**, and **[ESTIMATED]** from the
measured base plus the assumptions in §4.1.

Fixed skeleton used throughout: **everything-else-fixed = $15.64/mo** (IPv4, Secrets, EBS, health
checks, KMS, Route 53, inter-region, his own S3 artifacts).

### Scenario A — uncompressed photos (the code as it stands today)

| Line | 100 farmers | 1,000 farmers | 10,000 farmers |
|---|---:|---:|---:|
| Everything-else-fixed | $15.64 | $15.64 | $15.64 |
| EC2 compute | $19.29 `t3.small` | $19.29 `t3.small` | $19.29 `t4g.medium` |
| RDS compute | $18.09 `t4g.micro` | $36.18 `t4g.small` | $72.36 `t4g.medium` |
| RDS storage | $3.00 (20 GB) | $7.73 (50 GB) | $23.19 (150 GB) |
| RDS backup | $2.01 | $4.00 | $5.00 |
| S3 storage | $1.23 (41.6 GB) | $12.27 (416 GB) | $122.72 (4.16 TB) |
| S3 requests | $0.02 | $0.20 | $3.00 |
| **Egress** | $0 *(free tier)* | $0 *(70 GB/mo — just inside)* | **$77.02** (697 GB/mo − 100 free) |
| **TOTAL / month** | **$59.28** | **$95.31** | **$338.22** |
| **TOTAL / month (INR)** | **₹5,661** | **₹9,102** | **₹32,300** |
| **TOTAL / year (INR)** | **₹67,932** | **₹109,224** | **₹387,600** |

### Scenario B — compressed photos

| Line | 100 farmers | 1,000 farmers | 10,000 farmers |
|---|---:|---:|---:|
| Everything-else-fixed | $15.64 | $15.64 | $15.64 |
| EC2 compute | $19.29 | $19.29 | $19.29 |
| RDS compute | $18.09 | $36.18 | $72.36 |
| RDS storage | $3.00 | $7.73 | $23.19 |
| RDS backup | $2.01 | $4.00 | $5.00 |
| S3 storage | $0.06 (2.1 GB) | $0.61 (20.8 GB) | $6.14 (208 GB) |
| S3 requests | $0.02 | $0.10 | $3.00 |
| Egress | $0 | $0 | $0 *(38 GB/mo — inside free tier)* |
| **TOTAL / month** | **$58.11** | **$83.55** | **$144.62** |
| **TOTAL / month (INR)** | **₹5,550** | **₹7,979** | **₹13,811** |
| **TOTAL / year (INR)** | **₹66,600** | **₹95,748** | **₹165,732** |

**Compression alone saves ₹18,489/month (₹221,868/year) at 10,000 farmers.**
Working: `$338.22 − $144.62 = $193.60/mo × ₹95.5 = ₹18,489/mo`.

---

## 6. Cost per farmer per year — the two very different stories

This is the section where the arithmetic is worth reading twice, because the two numbers tell opposite
stories and only one of them is a business fact.

### Story 1 — "the fixed bill divided by farmer count" (an accounting artefact, improves as he grows)

| Farmers | Total/yr (A) | **Per farmer/yr (A)** | Total/yr (B) | **Per farmer/yr (B)** |
|---:|---:|---:|---:|---:|
| 100 | ₹67,932 | **₹679** ($7.11) | ₹66,600 | **₹666** ($6.97) |
| 1,000 | ₹109,224 | **₹109** ($1.14) | ₹95,748 | **₹96** ($1.00) |
| 10,000 | ₹387,600 | **₹39** ($0.41) | ₹165,732 | **₹17** ($0.17) |

This number falls **17-fold to 39-fold** between 100 and 10,000 farmers — not because farmers get
cheaper, but because a mostly-fixed ₹67,000/year floor is spread over more of them. **It is a measure
of how empty the servers are, not of what a farmer costs.**

### Story 2 — genuinely marginal cost (what one more farmer actually adds)

| | Per farmer/yr |
|---|---:|
| Scenario A (uncompressed) | **₹16.2** ($0.17) |
| Scenario B (compressed) | **₹2.8** ($0.03) |

**This number is flat.** It does not improve with scale, and it does not get worse. It is what
"holding one farmer's data safe for a year" costs.

**The gap between the two stories at 100 farmers is 42×** (₹679 vs ₹16.2). At 10,000 farmers it is
2.4×. That convergence is the whole shape of his unit economics: he is not paying for data, he is
paying for an empty server, and the fix is farmers, not engineering.

---

## 7. The cheap wins, ranked by rupees saved per unit of effort

### 🥇 #1 — Compress photos before upload

- **Saves:** ₹0/month today. **₹18,489/month (₹222,000/year) at 10,000 farmers.**
- **Effort:** ~1 day. One canvas-resize utility, called from two existing places
  (`PattiUploadSheet.tsx:107`, `ReceiptCaptureSheet.tsx:266`).
- **Why it ranks first despite saving nothing today:** it is **20× cheaper to do before farmers upload
  than after.** Once 4 TB of full-resolution photos exist, fixing it means a bulk re-encode plus egress
  to read every object back. Today it means one function.
- **It is also not primarily a cost fix.** A 4 MB upload on rural 2G/3G is a failed upload. Compression
  is a product-reliability change that happens to save a fifth of a million rupees a year.
- **Verdict: do this before launch.** By a wide margin the best ratio on this page.

### 🥈 #2 — EC2 `t3.small` → Graviton `t4g.small`

- **Saves:** exactly half the hourly rate — `$0.0224 → $0.0112/hr` **[AUTHORITATIVE]**. Same 2 vCPU,
  same 2 GiB RAM. `$8.18/mo` pre-tax = `$9.65` with GST = **₹921/month = ₹11,057/year.**
- **Effort:** half a day-ish. The .NET app needs an arm64 build and a redeploy onto a new instance.
  **No `RuntimeIdentifier` or `linux-x64` pin exists anywhere in the csproj files or workflows**
  **[MEASURED]**, so nothing obvious blocks it — but this is an untested rebuild and a real deploy,
  with rollback risk. Verify before committing.
- **The better variant:** `t4g.medium` costs **$0.0224/hr — identical to what he pays today** — and
  gives **double the RAM (4 GiB)**. If he would rather have headroom than ₹921/month, that is a free
  upgrade. Both options are strictly better than the status quo.

### 🥉 #3 — Delete the 2 Route 53 health checks and prune Secrets Manager

- **Saves:** health checks `$2.36/mo` (₹225) + the inter-region transfer they cause (₹44)
  + ~3 unused secrets at `$0.40` each `$1.42/mo` (₹136) = **₹405/month = ₹4,860/year.**
- **Effort:** under an hour. Console clicks.
- **Why:** the health checks monitor an app that is *deliberately asleep* 4.5 hours a day and, by the
  README's own admission, "will fire a 'down' notification at ~01:00 and 'recovered' at ~05:30 —
  expected during the nap window, not an outage." **He is paying ₹225/month for an alarm he has
  trained himself to ignore.** They also generate the ₹44/month inter-region transfer line (health
  checkers worldwide hitting his API), so removing them saves ₹225 + ₹44 = **₹269/month on its own**,
  and **₹405/month** together with the secrets cleanup.
- On secrets: 7 exist. `agrisync/consent/hs256/prod-2026-05` sits alongside
  `agrisync/consent/hs256/current`, and `agrisync/snapshot/pg-prod` supports a snapshot workflow that
  `aws/snapshot/prod-resources.md` records as **never having run** (bucket verified empty, 4 objects /
  5.8 KB). Worth an audit.
- **Best rupees-per-minute on the page**, even though the absolute number is small.

### Honourable mention — one CloudTrail lifecycle rule

`shramsafal-cloudtrail-prod-951921970996` holds **109,980 objects in 148.6 MB** with **no lifecycle
rule** **[MEASURED]**. It costs ~₹5/month today, so this is genuinely a rounding error — but it grows
forever, and at that object count the *request* charges will overtake the *byte* charges. One
"expire after 90 days" rule is a five-minute job. Do it when he is next in the console, not as a task.

---

### What is premature — and why

| Idea | Verdict |
|---|---|
| **Reserved Instances / Savings Plans** | **Premature, and actively counterproductive right now.** RDS 1-yr no-upfront `db.t4g.micro` = `$0.0165/hr` vs `$0.021` on-demand **[AUTHORITATIVE]** — 21% off, saving $3.29/mo. But it locks the instance class for a year, and he is about to change instance class at launch (§3.3 cliff #1). His own `aws/hibernate/README.md` already gets this right: *"Do NOT combine with a Savings Plan / Reserved Instance."* **Revisit after the shape has been stable for 3 months post-launch.** |
| **S3 lifecycle → IA / Glacier** | **Premature.** IA saves 45% ($0.0138 vs $0.0250). On his current 3.82 GB that is **₹4/month**. At 4 TB it would be ₹4,400/month — real — but IA carries a 30-day minimum and a per-GB retrieval fee, and "farmer looks back at last season's photos" is precisely the access pattern that makes IA cost *more*. **Revisit above 1 TB.** |
| **gp3 over gp2** | **Already done.** Both EBS and RDS are on gp3 **[MEASURED]**. Nothing to do. |
| **CloudFront in front of the uploads bucket** | **No egress saving.** CloudFront→India is **$0.1090/GB**; S3→internet is **$0.1093/GB** **[AUTHORITATIVE]** — within 0.3%. A CDN only wins when many people fetch the same object, and a farmer's photos are fetched by one person. The one *real* benefit is the free allowance: CloudFront's always-free **1 TB/month** vs data transfer's **100 GB/month** — a 10× larger cushion. **Worth doing at the point egress starts being billed (~3,000 farmers uncompressed), not before.** |
| **Multi-AZ RDS, load balancer, read replicas** | **Premature.** Doubles the database bill to buy availability he does not need at zero farmers. Becomes correct when downtime costs revenue. |
| **Pruning append-only tables** | **Not a cost problem.** The trust ledger and audit tables are doctrine-locked as append-only, and they are kilobytes. At 6 MB/farmer/year *including* a ×3 overhead multiplier, 10,000 farmers for 10 years is 600 GB — ₹7,500/month of RDS disk, and that is the pessimistic end. This will not be his problem this decade. |
| **Snapshot retention tuning** | **Nothing to tune.** Backup retention is 7 days (already minimal for anything you would call a backup), there are **zero EBS snapshots**, and the S3 snapshot bucket has **never been written to**. Billable backup storage is ₹192/month. |

---

## 8. The farmer-pays question

> *"What does it cost in future for farmers to maintain their data safe?"*

**The number: ₹2.8/farmer/year compressed, ₹16.2/farmer/year uncompressed.** Under three rupees a year
to keep one farmer's entire history safe, replicated across three availability zones, backed up daily,
and retrievable from any device forever.

**Plainly: no, this is not worth charging for, and storage is not a business constraint at smallholder
scale.** Three considerations:

1. **The amount is beneath the threshold of a transaction.** A farmer will not pay ₹3/year, and the
   payment rail to collect ₹3 costs more than ₹3. Over a **decade** a farmer accumulates ₹154 of
   storage cost compressed, or ₹890 uncompressed — an average of ₹15 to ₹89 per year.

2. **Charging for it would contradict the product.** The Telegram-model promise is "nothing is lost."
   Metering that promise, at a price that rounds to zero, buys nothing and signals that the guarantee
   is conditional.

3. **The real constraint is the fixed floor, not the data.** He pays **₹5,569/month — ₹66,828/year —
   before a single farmer exists.** At 100 farmers that floor is ₹679/farmer/year: **42× the marginal
   cost of the data itself.** Every rupee of "cost per farmer" at his current scale is the cost of an
   empty server, and the only thing that fixes it is farmers.

### The caveat that matters more than everything above

**The AI bill is not in this analysis and will almost certainly dwarf it.**

He has `agrisync/prod/sarvam-api-subscription-key` in Secrets Manager **[MEASURED]**, and per project
memory the live voice-parse path runs server-side through Sarvam (STT + LLM). Those are billed **per
API call**, not per byte. A farmer logging by voice daily generates hundreds of calls a year, each
costing far more than the **₹2.8/year** his data costs to store.

**If he wants to know what a farmer costs to serve, storage is the wrong number to chase.** The
question worth answering next is "what does one voice log cost in Sarvam and Gemini calls, and how
many does a farmer make?" That is where the money goes, and it is the one cost that genuinely scales
linearly with farmers with no economy of scale to rescue it.

---

## 9. What I could not verify

**Assumptions that could move the numbers materially:**

1. **The per-farmer footprint is assumed, not measured** — because **there is no farmer data in
   production.** `attachments/` = 4 test objects / 83 bytes; RDS = 1.76 GB used of 20 GB, which is
   schema plus the Purvesh seed. The parallel agent's measurement should replace my 5 KB/day text and
   2 photos/week inputs. Every downstream figure is linear in them, so they rescale cleanly.

2. **Photo size (4 MB) is assumed.** Real Android camera JPEGs run 1.5–8 MB. The whole §5 Scenario A
   column scales directly with this.

3. **The RDS cliff at 300–1,000 farmers is engineering judgment, not a load test.** It is a claim about
   a 1 GiB working set. It could be 200 farmers; it could be 3,000. Measured CPU (3.9% avg / 41% peak)
   is meaningless with zero users.

4. **EC2 t3 burst-credit behaviour under real load is untested.** 1.1% average CPU tells us nothing
   about how burst credits behave with real traffic.

5. **The 10,000-farmer instance choices** (`t4g.medium` for both EC2 and RDS) are my judgment. He may
   need `db.t4g.large` ($121.91/mo) instead of `db.t4g.medium` ($61.32/mo) — a ₹5,800/month swing on
   the 10,000-farmer row.

6. **I did not price a load balancer or any redundancy**, because there is no ELB in the account today
   and adding one is a business decision I was not asked to make.

**Things I established as fact rather than assumption:**

- The bill, itemised, from Cost Explorer — not estimated.
- Every instance class, storage size, storage type, Multi-AZ setting, backup retention, bucket,
  distribution, and hosted zone — from read-only API calls, not from docs.
- All unit prices — from the AWS Price List Query API for `ap-south-1`, cross-checked against his own
  bill to 3 decimal places (§2.3).
- The free-tier allowances are live on his account — visible as $0 charges against non-zero transfer
  quantities in July.
- The absence of image compression — from reading the actual upload components.

**Two corrections to existing repo docs:**

- **`aws/hibernate/README.md` savings table is stale.** It claims always-on ₹4,800 vs hibernated
  ₹1,500–1,750. Measured: **₹5,569 vs ₹4,951** — the auto-nap saves **₹618/month, not ₹3,300**,
  because it only stops compute 4.5 hours a day.
- **Project memory records "idle cost ~$48/month" (2026-06-16).** July actuals are **$51.84**, and
  that is the first month without credits. The direction of travel is up, not down.

**Compliance with the brief:** all AWS calls were `describe` / `list` / `get-*` / `get-cost-and-usage`
/ `get-products`. Nothing was created, modified, started, stopped, or deleted. Nothing was woken —
both EC2 and RDS were already running from the scheduled 05:30 IST auto-wake before I looked.

---

## Sources

- Pricing: **AWS Price List Query API**, `ap-south-1` / "Asia Pacific (Mumbai)", queried
  2026-08-14 — services `AmazonEC2`, `AmazonRDS`, `AmazonS3`, `AWSDataTransfer`, `AmazonCloudFront`.
  This is AWS's own live price feed, not a recollection.
- Billing: **AWS Cost Explorer** `get-cost-and-usage`, account `951921970996`, Apr–Aug 2026,
  grouped by `SERVICE`, `USAGE_TYPE`, and `RECORD_TYPE`.
- Infrastructure: read-only `describe`/`list` against the live account, plus CloudWatch
  `BucketSizeBytes`, `NumberOfObjects`, `FreeStorageSpace`, `CPUUtilization`.
- CloudFront free tier: [CDN Pricing, Plans & Free Tier — Amazon CloudFront](https://aws.amazon.com/cloudfront/pricing/) —
  and independently confirmed by $0 charges on 1.38 GB of CloudFront egress in his own July bill.
- FX rate ₹95.5/USD: [US Dollar to Indian Rupee History: 2026](https://www.exchangerates.org.uk/USD-INR-spot-exchange-rates-history-2026.html),
  [Federal Reserve H.10](https://www.federalreserve.gov/releases/h10/hist/dat00_in.htm).
- Repo: `aws/hibernate/{README.md,sleep.sh,wake.sh}`, `aws/snapshot/prod-resources.md`,
  `src/clients/mobile-web/src/features/logs/components/harvest/PattiUploadSheet.tsx`,
  `src/clients/mobile-web/src/features/procurement/components/ReceiptCaptureSheet.tsx`,
  `src/clients/mobile-web/package.json`.
