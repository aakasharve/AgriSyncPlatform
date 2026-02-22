# CAPACITOR-READY TRUST LEDGER ARCHITECTURE PLAN

**Date:** 2026-02-22
**Author:** Co-Founder Engineering Mode
**Predecessor:** THIN_CLIENT_MIGRATION_PLAN_2026-02-17.md (Phase 0-7 completed)
**Verdict:** Backend became server-authoritative. Now: fix repo discipline, add device capabilities, and make the trust ledger real.

---

## HOW TO USE THIS DOCUMENT

**Before starting work:** Read Phases 0 through 7 in order. Each phase has prerequisites. Do not skip.
**During work:** Check off subtasks as `[x]` when complete. Each phase has a GATE -- a single command or test that proves the phase is done.
**After completion:** Every `[ ]` in this document must be `[x]`. The DEFINITION OF DONE section at the bottom is the final audit.

**Rule for the developer agent:** If a subtask says "File: X" -- that is the EXACT file path. Do not create files at other paths. Do not rename folders. Do not create new projects unless explicitly stated. If a file path does not exist yet, it means CREATE it at that exact path. If it exists, MODIFY it as described.

**UI Freedom Rule:** UI flows, layouts, and interaction patterns are NOT frozen by this plan. Only system integrity rules (ledger correctness, sync protocol, authorization, attachment immutability, GPS immutability) are frozen. UI may be redesigned freely without architecture rewrites.

---

## GROUND TRUTH: Current State (Verified 2026-02-22)

### What the previous plan delivered (Phase 0-7 complete)

| Capability | Status |
|---|---|
| Verification: 5-state FSM with role-gated transitions | DONE |
| Finance: Allocation (EQUAL/BY_ACREAGE/CUSTOM), duplicate detection, flagging | DONE |
| Compare: Stage-aware engine with fuzzy match and health scoring | DONE |
| Plan: Dynamic derivation with frequency modes | DONE |
| AI: Voice parsing endpoint (Gemini key server-side) | DONE |
| Authorization: All use cases enforce role checks | DONE |
| Sync: Push/pull with idempotency, DayLedger, 5-state verification | DONE |
| Seed: Rich demo data (48 logs, 111 tasks, 24 cost entries, 32 verifications) | DONE |
| Frontend: Domain logic removed, delegates to backend via sync/API | DONE |

### What this plan fixes (Critical gaps)

| Gap | Impact | Phase |
|---|---|---|
| `dist/` committed to git, no build discipline | Blocks reproducible builds, inflates repo, hides logic | 0 |
| No Capacitor setup, no device abstraction layer | Cannot ship Android app, camera/GPS/file access impossible | 1 |
| No attachment/file upload support | Cannot capture photo receipts, cannot prove trust with evidence | 2 |
| No camera OCR pipeline | Cannot auto-extract cost data from receipts | 3 |
| No GPS metadata capture | Cannot prove location of work activities | 4 |
| No PDF export | Cannot save/share reports offline or to government | 5 |
| Plan templates still embedded in client dist bundle | Client is not truly thin -- hardcoded master data remains | 6 |
| Ledger correctness not fully append-only | Silent edits still possible in some paths | 7 |

### Repository Structure (Verified)
```
E:\APPS\Running App Versions\AgriSyncPlatform\
  src\
    AgriSync.sln
    AgriSync.Bootstrapper\           <-- ENTRY POINT
    AgriSync.BuildingBlocks\         <-- CROSS-CUTTING
    AgriSync.SharedKernel\           <-- TYPED IDS, CONTRACTS
    apps\
      ShramSafal\                    <-- 4-layer: Domain, Application, Infrastructure, Api
      User\                          <-- 4-layer: Domain, Application, Infrastructure, Api
    clients\
      mobile-web\                    <-- React 19 + Vite + Dexie
        src\                         <-- Source code EXISTS (not deleted)
        dist\                        <-- TRACKED IN GIT (problem)
        node_modules\                <-- GITIGNORED (correct)
        package.json                 <-- EXISTS
    tests\
      AgriSync.ArchitectureTests\
      ShramSafal.Sync.IntegrationTests\
      ShramSafal.Domain.Tests\
```

### Database (Verified)
```
Host:     localhost:5433
Database: agrisync
Schema "public": users, refresh_tokens, app_memberships
Schema "ssf":    farms, plots, crop_cycles, daily_logs, log_tasks,
                 verification_events, cost_entries, finance_corrections,
                 price_configs, schedule_templates, template_activities,
                 planned_activities, day_ledgers, sync_mutations
```

### Current Backend: 14 DbSets, 19 API endpoints, 19 use case handlers
### Current Frontend: Dexie v3, 8 tables, sync worker (15s interval), mutation queue with idempotency

---

## THE GAP: What Must Be Built

| Capability | Backend Today | Needed | Gap |
|---|---|---|---|
| Attachment Entity | Not implemented | Full attachment lifecycle (create, upload, finalize, link) | CRITICAL |
| File Upload API | Not implemented | Chunked upload, retry, immutable storage | CRITICAL |
| Camera Capture | Not implemented | Device abstraction, local-first save, upload queue | CRITICAL |
| OCR Pipeline | Not implemented | Server-side OCR, confidence scores, draft-not-truth | HIGH |
| GPS Capture | Not implemented | Device location, consent, immutable after submit | HIGH |
| PDF Export | Not implemented | Server-generated PDFs, device save/share | HIGH |
| Reference Data API | Hardcoded in client dist | Server serves templates, client caches | HIGH |
| Repo Hygiene | dist tracked, no CI | Clean git, reproducible builds | CRITICAL |
| Capacitor Shell | Not implemented | Android wrapper, device plugin abstraction | CRITICAL |
| Append-Only Audit | Partial (corrections exist) | No destructive updates on any ledger entity | MEDIUM |

---

## PHASE 0: REPO HYGIENE & BUILD DISCIPLINE

**Goal:** Remove build artifacts from git, add proper gitignore, ensure fresh clone -> install -> run works for both backend and frontend.

**Prerequisites:** Current codebase compiles (`dotnet build` + `npm run build` both pass).

### 0.1 Remove `dist/` from Git Tracking
- [x] **Run:** `git rm -r --cached src/clients/mobile-web/dist/`
- [x] Verify: `git status` shows dist files as "deleted" (staged)
- [x] Do NOT delete the local `dist/` folder -- only untrack from git

### 0.2 Create Frontend .gitignore
- [x] **File: `src/clients/mobile-web/.gitignore`** -- CREATE
  ```
  # Build output
  dist/

  # Dependencies (already in root .gitignore but explicit here)
  node_modules/

  # Environment files with secrets
  .env.local
  .env.production.local

  # Capacitor build artifacts (Phase 1)
  android/
  ios/

  # IDE
  .idea/
  .vscode/
  ```

### 0.3 Update Root .gitignore
- [x] **File: `.gitignore`** -- MODIFY
  - Add under `# Node` section:
    ```
    # Frontend build output
    **/dist/

    # Capacitor native projects (built, not committed)
    src/clients/mobile-web/android/
    src/clients/mobile-web/ios/
    ```

### 0.4 Verify Clean Build
- [x] `git stash` any uncommitted work
- [x] Delete `src/clients/mobile-web/dist/` locally
- [x] Delete `src/clients/mobile-web/node_modules/` locally
- [x] Run: `cd src/clients/mobile-web && npm install && npm run build`
- [x] Verify `dist/` recreated with valid build output
- [x] Verify `git status` does NOT show dist files (gitignored)

### 0.5 Add Convenience Scripts
- [x] **File: `src/clients/mobile-web/package.json`** -- MODIFY
  - Add scripts:
    ```json
    "start": "vite --host",
    "clean": "rimraf dist",
    "build:prod": "vite build --mode production"
    ```

### 0.6 Verify One-Command Startup
- [x] Backend: `dotnet run --project src/AgriSync.Bootstrapper` starts on localhost:5048
- [x] Frontend: `cd src/clients/mobile-web && npm run dev` starts on localhost:5173
- [x] Login with Ramu (9999999999 / ramu123) works end-to-end

### 0.7 Commit Clean State
- [x] Stage: `.gitignore`, `src/clients/mobile-web/.gitignore`, `package.json` changes
- [x] Stage: removal of `dist/` from tracking
- [x] Commit with message: "chore: remove dist from git, add build discipline"

### PHASE 0 GATE
**Status (2026-02-22):** PASSED (`git` commit `68597bd`)

```bash
# dist not tracked
git ls-files -- src/clients/mobile-web/dist/ | wc -l
# Should return 0

# Fresh install + build works
rm -rf src/clients/mobile-web/node_modules src/clients/mobile-web/dist
cd src/clients/mobile-web && npm install && npm run build
# Should succeed

# Backend still works
dotnet build src/AgriSync.sln
# Zero errors
```

---

## PHASE 1: CAPACITOR FOUNDATION & DEVICE ABSTRACTION LAYER

**Goal:** Add Capacitor to the frontend project. Create a device abstraction layer so ALL device access (camera, files, GPS, share) goes through service interfaces. Web implementations work immediately. Capacitor implementations plug in later.

**Prerequisites:** Phase 0 complete. Frontend builds cleanly.

### 1.1 Install Capacitor Core
- [x] **Run in `src/clients/mobile-web/`:**
  ```bash
  npm install @capacitor/core @capacitor/cli
  npx cap init "ShramSafal" "com.agrisync.shramsafal" --web-dir dist
  ```
- [x] Verify `capacitor.config.ts` created in `src/clients/mobile-web/`

### 1.2 Install Capacitor Plugins
- [x] **Run in `src/clients/mobile-web/`:**
  ```bash
  npm install @capacitor/camera @capacitor/filesystem @capacitor/geolocation @capacitor/share @capacitor/app @capacitor/haptics @capacitor/network @capacitor/status-bar
  ```

### 1.3 Add Android Platform
- [x] **Run:** `npx cap add android`
- [x] Verify `android/` folder created (it will be gitignored per Phase 0)
- [x] Verify `npx cap sync` succeeds

### 1.4 Device Service Interfaces
- [x] **File: `src/clients/mobile-web/src/infrastructure/device/DeviceCameraService.ts`** -- CREATE
  ```typescript
  export interface CaptureResult {
    localPath: string;       // Device-local file path or blob URL
    mimeType: string;        // image/jpeg, image/png, etc.
    sizeBytes: number;
    width?: number;
    height?: number;
  }

  export interface DeviceCameraService {
    isAvailable(): Promise<boolean>;
    capturePhoto(): Promise<CaptureResult>;
    pickFromGallery(): Promise<CaptureResult>;
  }
  ```

- [x] **File: `src/clients/mobile-web/src/infrastructure/device/DeviceFilesService.ts`** -- CREATE
  ```typescript
  export interface FilePickResult {
    localPath: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }

  export interface SaveFileOptions {
    fileName: string;
    data: Blob | ArrayBuffer;
    mimeType: string;
    directory?: 'documents' | 'downloads' | 'cache';
  }

  export interface DeviceFilesService {
    pickFile(accept?: string[]): Promise<FilePickResult>;
    saveFile(options: SaveFileOptions): Promise<string>;  // returns saved path
    readFile(localPath: string): Promise<ArrayBuffer>;
    deleteFile(localPath: string): Promise<void>;
    getFileInfo(localPath: string): Promise<{ exists: boolean; sizeBytes: number }>;
  }
  ```

- [x] **File: `src/clients/mobile-web/src/infrastructure/device/DeviceLocationService.ts`** -- CREATE
  ```typescript
  export interface LocationSnapshot {
    latitude: number;
    longitude: number;
    accuracy: number;          // meters
    altitude?: number;
    altitudeAccuracy?: number;
    heading?: number;
    speed?: number;
    timestamp: number;         // Unix ms
    provider: 'gps' | 'network' | 'fused' | 'unknown';
  }

  export interface PermissionState {
    location: 'granted' | 'denied' | 'prompt';
  }

  export interface DeviceLocationService {
    checkPermission(): Promise<PermissionState>;
    requestPermission(): Promise<PermissionState>;
    getCurrentPosition(highAccuracy?: boolean): Promise<LocationSnapshot>;
  }
  ```

- [x] **File: `src/clients/mobile-web/src/infrastructure/device/DeviceShareAndSaveService.ts`** -- CREATE
  ```typescript
  export interface ShareOptions {
    title?: string;
    text?: string;
    url?: string;
    files?: { path: string; mimeType: string }[];
  }

  export interface DeviceShareAndSaveService {
    canShare(): Promise<boolean>;
    share(options: ShareOptions): Promise<void>;
    saveToDownloads(fileName: string, data: Blob, mimeType: string): Promise<string>;
  }
  ```

- [x] **File: `src/clients/mobile-web/src/infrastructure/device/DevicePermissionsService.ts`** -- CREATE
  ```typescript
  export type PermissionType = 'camera' | 'location' | 'storage' | 'microphone';
  export type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'limited';

  export interface DevicePermissionsService {
    check(permission: PermissionType): Promise<PermissionStatus>;
    request(permission: PermissionType): Promise<PermissionStatus>;
    openSettings(): Promise<void>;
  }
  ```

- [x] **File: `src/clients/mobile-web/src/infrastructure/device/index.ts`** -- CREATE
  - Re-export all interfaces

### 1.5 Web Implementations (Work in Browser Without Capacitor)
- [x] **File: `src/clients/mobile-web/src/infrastructure/device/web/WebCameraService.ts`** -- CREATE
  - Uses `<input type="file" accept="image/*" capture="environment">` for photo
  - Uses `<input type="file" accept="image/*">` for gallery
  - Returns blob URL as localPath

- [x] **File: `src/clients/mobile-web/src/infrastructure/device/web/WebFilesService.ts`** -- CREATE
  - Uses `<input type="file">` for file pick
  - Uses `URL.createObjectURL()` / `<a download>` for save
  - Reads via FileReader

- [x] **File: `src/clients/mobile-web/src/infrastructure/device/web/WebLocationService.ts`** -- CREATE
  - Uses `navigator.geolocation.getCurrentPosition()`
  - Permission via `navigator.permissions.query({ name: 'geolocation' })`

- [x] **File: `src/clients/mobile-web/src/infrastructure/device/web/WebShareAndSaveService.ts`** -- CREATE
  - Uses `navigator.share()` if available, fallback to `<a download>`
  - Save via Blob + createObjectURL + click

- [x] **File: `src/clients/mobile-web/src/infrastructure/device/web/WebPermissionsService.ts`** -- CREATE
  - Uses `navigator.permissions.query()` for supported types
  - `openSettings()` shows alert with instructions (web cannot open OS settings)

### 1.6 Capacitor Implementations (Plug-In Later)
- [x] **File: `src/clients/mobile-web/src/infrastructure/device/capacitor/CapacitorCameraService.ts`** -- CREATE
  - Uses `@capacitor/camera` Camera.getPhoto()
  - Handles permission requests via Capacitor

- [x] **File: `src/clients/mobile-web/src/infrastructure/device/capacitor/CapacitorFilesService.ts`** -- CREATE
  - Uses `@capacitor/filesystem` for read/write/delete
  - Stores in Documents directory

- [x] **File: `src/clients/mobile-web/src/infrastructure/device/capacitor/CapacitorLocationService.ts`** -- CREATE
  - Uses `@capacitor/geolocation` for position + permissions

- [x] **File: `src/clients/mobile-web/src/infrastructure/device/capacitor/CapacitorShareAndSaveService.ts`** -- CREATE
  - Uses `@capacitor/share` for sharing
  - Uses `@capacitor/filesystem` for downloads

- [x] **File: `src/clients/mobile-web/src/infrastructure/device/capacitor/CapacitorPermissionsService.ts`** -- CREATE
  - Unified permission checking across Capacitor plugins

### 1.7 Platform Detection & Service Factory
- [x] **File: `src/clients/mobile-web/src/infrastructure/device/DeviceServiceFactory.ts`** -- CREATE
  ```typescript
  import { Capacitor } from '@capacitor/core';

  export function createDeviceServices() {
    const isNative = Capacitor.isNativePlatform();

    return {
      camera: isNative ? new CapacitorCameraService() : new WebCameraService(),
      files: isNative ? new CapacitorFilesService() : new WebFilesService(),
      location: isNative ? new CapacitorLocationService() : new WebLocationService(),
      share: isNative ? new CapacitorShareAndSaveService() : new WebShareAndSaveService(),
      permissions: isNative ? new CapacitorPermissionsService() : new WebPermissionsService(),
    };
  }
  ```

- [x] **File: `src/clients/mobile-web/src/app/compositionRoot.ts`** -- MODIFY
  - Add `createDeviceServices()` to composition root
  - Expose via React context or direct import

### 1.8 Capacitor Build Verification
- [x] `npm run build` still succeeds (web build)
- [x] `npx cap sync` succeeds (copies web to Android)
- [x] Android project opens in Android Studio (manual verification)

### 1.9 Vite Config for Capacitor
- [x] **File: `src/clients/mobile-web/vite.config.ts`** -- MODIFY
  - Ensure `base: './'` for relative asset paths (required for Capacitor file:// protocol)

### PHASE 1 GATE
**Status (2026-02-22):** PASSED (web build, cap sync, TypeScript compile, and Android Studio/Gradle verification complete)

```bash
# Frontend builds
cd src/clients/mobile-web && npm run build
# Zero errors

# Capacitor syncs
npx cap sync
# No errors

# TypeScript compiles with device interfaces
npx tsc --noEmit
# Zero errors

# Web camera service exists and exports
grep "WebCameraService" src/clients/mobile-web/src/infrastructure/device/web/WebCameraService.ts
# Found
```

---

## PHASE 2: ATTACHMENT DOMAIN & FILE UPLOAD PIPELINE

**Goal:** Backend gains a first-class Attachment entity. Files can be uploaded, stored, and linked to ledger records (DailyLogs, CostEntries). Frontend captures files locally and uploads via a retry-capable queue.

**Prerequisites:** Phase 1 complete. Device abstraction layer operational.

### 2.1 Attachment Domain Entity
- [x] **File: `src/apps/ShramSafal/ShramSafal.Domain/Attachments/Attachment.cs`** -- CREATE
  ```csharp
  public class Attachment
  {
      public Guid Id { get; private set; }
      public Guid FarmId { get; private set; }
      public Guid? LinkedEntityId { get; private set; }       // DailyLog, CostEntry, etc.
      public string LinkedEntityType { get; private set; }    // "DailyLog", "CostEntry"
      public Guid UploadedByUserId { get; private set; }
      public string OriginalFileName { get; private set; }
      public string MimeType { get; private set; }
      public long SizeBytes { get; private set; }
      public string StoragePath { get; private set; }         // Server-side storage path
      public AttachmentStatus Status { get; private set; }
      public DateTime CreatedAtUtc { get; private set; }
      public DateTime? FinalizedAtUtc { get; private set; }

      // Factory
      public static Attachment Create(Guid id, Guid farmId, Guid uploadedByUserId,
          string originalFileName, string mimeType, long sizeBytes, string storagePath);

      // Lifecycle
      public void Finalize();                    // Status -> Finalized
      public void LinkToEntity(Guid entityId, string entityType);
      // NO Delete() or Update() -- attachments are IMMUTABLE after finalize
  }
  ```

### 2.2 Attachment Status Enum
- [x] **File: `src/apps/ShramSafal/ShramSafal.Domain/Attachments/AttachmentStatus.cs`** -- CREATE
  - Enum: `Pending=0, Uploading=1, Finalized=2, Failed=3`
  - Store as string in database

### 2.3 Attachment Storage Port
- [x] **File: `src/apps/ShramSafal/ShramSafal.Application/Ports/External/IAttachmentStorageService.cs`** -- CREATE
  ```csharp
  public interface IAttachmentStorageService
  {
      Task<string> StoreFileAsync(Stream fileStream, string farmId, string fileName, CancellationToken ct);
      Task<Stream> RetrieveFileAsync(string storagePath, CancellationToken ct);
      Task<bool> ExistsAsync(string storagePath, CancellationToken ct);
  }
  ```

### 2.4 Local File Storage Implementation (Dev)
- [x] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Storage/LocalFileStorageService.cs`** -- CREATE
  - Implements `IAttachmentStorageService`
  - Stores files under `{dataDir}/attachments/{farmId}/{yyyy-MM}/{fileName}`
  - Data directory configurable via `appsettings.json`

- [x] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Storage/StorageOptions.cs`** -- CREATE
  - Config: `DataDirectory` (default: `./data`), `MaxFileSizeMB` (default: 25)

### 2.5 Attachment Use Cases
- [x] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Attachments/CreateAttachment/CreateAttachmentHandler.cs`** -- CREATE
  - Command: `{ farmId, originalFileName, mimeType, sizeBytes, linkedEntityId?, linkedEntityType? }`
  - Logic: Validate farm membership, create Attachment record (Pending), return upload URL/token

- [x] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Attachments/UploadAttachment/UploadAttachmentHandler.cs`** -- CREATE
  - Command: `{ attachmentId, fileStream }`
  - Logic: Store via IAttachmentStorageService, update status to Finalized, set FinalizedAtUtc

- [x] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Attachments/GetAttachment/GetAttachmentHandler.cs`** -- CREATE
  - Query: `{ attachmentId }`
  - Returns: Attachment metadata (NOT the file itself)

- [x] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Attachments/GetAttachmentFile/GetAttachmentFileHandler.cs`** -- CREATE
  - Query: `{ attachmentId }`
  - Returns: File stream for download

### 2.6 Repository Updates
- [x] **File: `src/apps/ShramSafal/ShramSafal.Application/Ports/IShramSafalRepository.cs`** -- MODIFY
  - Add: `AddAttachmentAsync(Attachment attachment)`
  - Add: `GetAttachmentByIdAsync(Guid id)`
  - Add: `GetAttachmentsByEntityAsync(Guid entityId, string entityType)`
  - Add: `GetAttachmentsByFarmAsync(Guid farmId, int limit, int offset)`
  - Add: `GetPendingAttachmentsAsync(Guid farmId)` -- for retry queue

- [x] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Repositories/ShramSafalRepository.cs`** -- MODIFY
  - Implement all new attachment methods

### 2.7 EF Configuration
- [x] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Configurations/AttachmentConfiguration.cs`** -- CREATE
  - Table: `attachments`, schema: `ssf`
  - Status stored as string
  - Index: (FarmId)
  - Index: (LinkedEntityId, LinkedEntityType)
  - Index: (UploadedByUserId)

- [x] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/ShramSafalDbContext.cs`** -- MODIFY
  - Add: `DbSet<Attachment> Attachments`

### 2.8 API Endpoints
- [x] **File: `src/apps/ShramSafal/ShramSafal.Api/Endpoints/AttachmentEndpoints.cs`** -- CREATE
  - `POST /shramsafal/attachments` -- Create attachment record (returns id + upload URL)
    - Requires auth. Extract UserId from claims.
  - `POST /shramsafal/attachments/{id}/upload` -- Upload file (multipart/form-data)
    - Accepts single file, max 25MB
    - Validates attachment exists and belongs to caller's farm
  - `GET /shramsafal/attachments/{id}` -- Get attachment metadata
  - `GET /shramsafal/attachments/{id}/download` -- Download file
  - `GET /shramsafal/attachments?entityId=X&entityType=Y` -- List attachments for entity

### 2.9 DI Registration
- [x] Register `IAttachmentStorageService` -> `LocalFileStorageService`
- [x] Register `StorageOptions` from configuration
- [x] Register all attachment handlers
- [x] **File: `src/AgriSync.Bootstrapper/appsettings.json`** -- MODIFY
  - Add: `"Storage": { "DataDirectory": "./data", "MaxFileSizeMB": 25 }`

### 2.10 EF Migration
- [x] Create migration: `dotnet ef migrations add AddAttachments --project src/apps/ShramSafal/ShramSafal.Infrastructure --startup-project src/AgriSync.Bootstrapper`

### 2.11 Frontend: Attachment Upload Queue
- [x] **File: `src/clients/mobile-web/src/infrastructure/storage/DexieDatabase.ts`** -- MODIFY
  - Bump to v4
  - Add `attachments` table: `id, farmId, linkedEntityId, linkedEntityType, localPath, status, [farmId], [linkedEntityId+linkedEntityType]`
  - Add `uploadQueue` table: `++autoId, attachmentId, status, retryCount, lastAttemptAt, [status]`

- [x] **File: `src/clients/mobile-web/src/infrastructure/sync/AttachmentUploadWorker.ts`** -- CREATE
  - Runs alongside BackgroundSyncWorker
  - Picks pending uploads from `uploadQueue`
  - Reads file from local path via DeviceFilesService
  - Calls `POST /attachments` then `POST /attachments/{id}/upload`
  - Retries on failure (exponential backoff, max 5 retries)
  - Updates attachment status in Dexie on success

### 2.12 Frontend: Attachment Capture Flow
- [x] **File: `src/clients/mobile-web/src/application/use-cases/CaptureAttachment.ts`** -- CREATE
  - Input: source ('camera' | 'gallery' | 'file'), linkedEntityId?, linkedEntityType?
  - Logic:
    1. Capture via DeviceCameraService or DeviceFilesService
    2. Save locally via DeviceFilesService (if needed)
    3. Create record in Dexie `attachments` table (status: 'pending')
    4. Enqueue in `uploadQueue`
    5. Return local attachment record (UI shows immediately)
  - File is NEVER lost -- saved locally before upload attempt

### 2.13 Frontend: API Client Update
- [x] **File: `src/clients/mobile-web/src/infrastructure/api/AgriSyncClient.ts`** -- MODIFY
  - Add: `createAttachment(request): Promise<{ id, uploadUrl }>`
  - Add: `uploadAttachmentFile(attachmentId, file: Blob): Promise<void>`
  - Add: `getAttachmentMetadata(attachmentId): Promise<AttachmentDto>`
  - Add: `getAttachmentDownloadUrl(attachmentId): string`
  - Add: `listAttachments(entityId, entityType): Promise<AttachmentDto[]>`

### 2.14 Sync: Attachment in Pull
- [x] **File: `src/apps/ShramSafal/ShramSafal.Application/Contracts/Dtos/SyncDtos.cs`** -- MODIFY
  - Add `AttachmentDto` to pull response (metadata only, not file bytes)

- [x] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Sync/PullSyncChanges/PullSyncChangesHandler.cs`** -- MODIFY
  - Include finalized attachment metadata in pull response

- [x] **File: `src/clients/mobile-web/src/infrastructure/sync/SyncPullReconciler.ts`** -- MODIFY
  - Handle `AttachmentDto` -> store metadata in Dexie `attachments` table

### 2.15 Tests
- [x] **File: `src/tests/ShramSafal.Domain.Tests/Attachments/AttachmentTests.cs`** -- CREATE
  - Test: Create attachment -> status is Pending
  - Test: Finalize attachment -> status is Finalized, FinalizedAtUtc set
  - Test: Link to entity -> LinkedEntityId and LinkedEntityType set
  - Test: Cannot modify finalized attachment (immutability)

### PHASE 2 GATE
**Status (2026-02-22):** PARTIALLY VERIFIED (build/test/frontend gates passed; live `curl` upload/download flow could not be executed in this shell due process-policy blocking scripted background server + HTTP sequence)

```bash
# Backend builds
dotnet build src/AgriSync.sln
# Zero errors

# Attachment tests pass
dotnet test --filter "Attachment"
# All pass

# Upload endpoint works
curl -X POST localhost:5048/shramsafal/attachments \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"farmId":"...","originalFileName":"receipt.jpg","mimeType":"image/jpeg","sizeBytes":150000}' \
  | grep id
# Returns attachment ID

# File upload works
curl -X POST localhost:5048/shramsafal/attachments/{id}/upload \
  -H "Authorization: Bearer {token}" \
  -F "file=@test-receipt.jpg"
# Returns 200

# Frontend builds
cd src/clients/mobile-web && npm run build
# Zero errors
```

---

## PHASE 3: CAMERA OCR PIPELINE

**Goal:** Server-side OCR extracts structured data from receipt photos. OCR output is a "machine suggestion" (draft), never auto-committed to the ledger. User must explicitly confirm.

**Prerequisites:** Phase 2 complete. Attachment upload works.

### 3.1 OCR Domain Types
- [x] **File: `src/apps/ShramSafal/ShramSafal.Domain/OCR/OcrExtractionResult.cs`** -- CREATE
  ```csharp
  public record OcrExtractionResult
  {
      public Guid AttachmentId { get; init; }
      public string RawText { get; init; }
      public List<ExtractedField> Fields { get; init; }
      public decimal OverallConfidence { get; init; }
      public string ModelUsed { get; init; }
      public int LatencyMs { get; init; }
      public DateTime ExtractedAtUtc { get; init; }
  }

  public record ExtractedField
  {
      public string FieldName { get; init; }    // "amount", "vendor", "date", "category", "items"
      public string Value { get; init; }
      public decimal Confidence { get; init; }
  }
  ```

### 3.2 OCR Storage Entity
- [x] **File: `src/apps/ShramSafal/ShramSafal.Domain/OCR/OcrResult.cs`** -- CREATE
  - Entity stored in DB, linked to Attachment
  - Properties: Id, AttachmentId, RawText, ExtractedFieldsJson (serialized), OverallConfidence, ModelUsed, LatencyMs, CreatedAtUtc
  - IMMUTABLE after creation (append new result if re-processed)

### 3.3 OCR Service Port
- [x] **File: `src/apps/ShramSafal/ShramSafal.Application/Ports/External/IOcrExtractionService.cs`** -- CREATE
  ```csharp
  public interface IOcrExtractionService
  {
      Task<OcrExtractionResult> ExtractFromImageAsync(Stream imageStream, string mimeType, OcrContext context, CancellationToken ct);
  }

  public record OcrContext(string FarmName, string[] RecentCategories, string[] RecentVendors);
  ```

### 3.4 Gemini OCR Implementation
- [x] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Integrations/Gemini/GeminiOcrService.cs`** -- CREATE
  - Implements `IOcrExtractionService`
  - Sends image to Gemini Vision with structured extraction prompt
  - Prompt includes: farm context, expected fields (amount, vendor, date, category, line items)
  - Returns confidence per field
  - Falls back gracefully if Gemini unavailable (returns empty result with 0 confidence)

### 3.5 OCR Use Case
- [x] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/OCR/ExtractFromReceipt/ExtractFromReceiptHandler.cs`** -- CREATE
  - Command: `{ attachmentId }`
  - Logic:
    1. Load attachment, verify finalized and is image type
    2. Retrieve file via IAttachmentStorageService
    3. Build OcrContext from farm data
    4. Call IOcrExtractionService
    5. Store OcrResult in DB (linked to attachment)
    6. Return OcrExtractionResult
  - OCR result is stored as "machine suggestion" -- NO ledger entries created

### 3.6 Persistence
- [x] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Configurations/OcrResultConfiguration.cs`** -- CREATE
  - Table: `ocr_results`, schema: `ssf`
  - Index: (AttachmentId)

- [x] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/ShramSafalDbContext.cs`** -- MODIFY
  - Add: `DbSet<OcrResult> OcrResults`

### 3.7 API Endpoint
- [x] **File: `src/apps/ShramSafal/ShramSafal.Api/Endpoints/AttachmentEndpoints.cs`** -- MODIFY
  - Add: `POST /shramsafal/attachments/{id}/ocr` -- Trigger OCR on finalized image attachment
    - Returns `OcrExtractionResult` with confidence scores
    - UI uses this as draft to pre-fill cost entry form
  - Add: `GET /shramsafal/attachments/{id}/ocr` -- Get stored OCR result

### 3.8 Repository Updates
- [x] **File: `src/apps/ShramSafal/ShramSafal.Application/Ports/IShramSafalRepository.cs`** -- MODIFY
  - Add: `AddOcrResultAsync(OcrResult result)`
  - Add: `GetOcrResultByAttachmentIdAsync(Guid attachmentId)`

### 3.9 EF Migration
- [x] Create migration: `dotnet ef migrations add AddOcrResults ...`
  - Implemented in existing local migration stream via `20260222053037_AddLocationSnapshots` (includes `ocr_results` and related indexes).

### 3.10 Frontend: OCR Draft Flow
- [x] **File: `src/clients/mobile-web/src/application/use-cases/ExtractReceiptData.ts`** -- CREATE
  - Input: attachmentId (local Dexie record)
  - Logic:
    1. Wait for attachment upload to complete (check uploadQueue status)
    2. Call `POST /attachments/{id}/ocr`
    3. Return extracted fields with confidence
    4. UI pre-fills cost entry form with extracted values
    5. User MUST explicitly confirm before saving to ledger
  - If offline: queue OCR request for later, show "will extract when online"
  - Status note: use-case + queueing logic implemented; UI component wiring to invoke this flow is pending attachment-capture screen integration.

### 3.11 Tests
- [x] **File: `src/tests/ShramSafal.Domain.Tests/OCR/OcrResultTests.cs`** -- CREATE
  - Test: OcrResult is immutable after creation
  - Test: OcrResult links to attachment
  - Test: Extraction confidence thresholds

### PHASE 3 GATE
**Status (2026-02-22):** PARTIALLY VERIFIED (build + targeted tests passed; live authenticated OCR curl checks pending runtime token/session execution)

```bash
# OCR endpoint works (requires GEMINI_API_KEY)
curl -X POST localhost:5048/shramsafal/attachments/{imageAttachmentId}/ocr \
  -H "Authorization: Bearer {token}" \
  | grep confidence
# Returns extraction with confidence scores

# OCR result stored
curl localhost:5048/shramsafal/attachments/{imageAttachmentId}/ocr \
  -H "Authorization: Bearer {token}" \
  | grep extractedFields
# Returns stored OCR result

# Tests pass
dotnet test --filter "OcrResult"
```

---

## PHASE 4: GPS METADATA CAPTURE

**Goal:** Optionally capture GPS coordinates when logging activities. GPS is consent-based, non-blocking (app works without it), and immutable after submission. Corrections are append-only.

**Prerequisites:** Phase 1 complete (DeviceLocationService available).

### 4.1 Location Snapshot Value Object
- [x] **File: `src/apps/ShramSafal/ShramSafal.Domain/Location/LocationSnapshot.cs`** -- CREATE
  ```csharp
  public record LocationSnapshot
  {
      public decimal Latitude { get; init; }
      public decimal Longitude { get; init; }
      public decimal AccuracyMeters { get; init; }
      public decimal? Altitude { get; init; }
      public DateTime CapturedAtUtc { get; init; }
      public string Provider { get; init; }        // "gps", "network", "fused", "unknown"
      public string PermissionState { get; init; } // "granted", "denied", "prompt"
  }
  ```
  - Value object (no Id). Owned by DailyLog or CostEntry.

### 4.2 DailyLog: Add Location
- [x] **File: `src/apps/ShramSafal/ShramSafal.Domain/Logs/DailyLog.cs`** -- MODIFY
  - Add optional owned property: `LocationSnapshot? Location`
  - Add method: `AttachLocation(LocationSnapshot location)` -- only if Location is null (immutable after set)
  - Location CANNOT be edited after log is submitted. Corrections are new records.

### 4.3 CostEntry: Add Location
- [x] **File: `src/apps/ShramSafal/ShramSafal.Domain/Finance/CostEntry.cs`** -- MODIFY
  - Add optional owned property: `LocationSnapshot? Location`
  - Same immutability rule as DailyLog

### 4.4 EF Configuration
- [x] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Configurations/DailyLogConfiguration.cs`** -- MODIFY
  - Add: `OwnsOne(x => x.Location)` with column prefix `location_`

- [x] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Configurations/CostEntryConfiguration.cs`** -- MODIFY
  - Add: `OwnsOne(x => x.Location)` with column prefix `location_`

### 4.5 Use Case Updates
- [x] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Logs/CreateDailyLog/CreateDailyLogCommand.cs`** -- MODIFY
  - Add optional: `LocationSnapshot? Location`

- [x] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Logs/CreateDailyLog/CreateDailyLogHandler.cs`** -- MODIFY
  - If location provided: call `log.AttachLocation(command.Location)`

- [x] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Finance/AddCostEntry/AddCostEntryCommand.cs`** -- MODIFY
  - Add optional: `LocationSnapshot? Location`

### 4.6 Sync DTO Updates
- [x] **File: `src/apps/ShramSafal/ShramSafal.Application/Contracts/Dtos/SyncDtos.cs`** -- MODIFY
  - Add `LocationDto` with lat, lon, accuracy, altitude, capturedAt, provider, permissionState
  - Add `LocationDto? location` to `DailyLogDto`
  - Add `LocationDto? location` to cost entry sync representation

- [x] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Sync/PushSyncBatch/PushSyncBatchHandler.cs`** -- MODIFY
  - Parse location from `create_daily_log` and `add_cost_entry` mutations

### 4.7 API Updates
- [x] Existing `POST /shramsafal/logs` and `POST /shramsafal/finance/cost-entry` endpoints now accept optional `location` object in body

### 4.8 EF Migration
- [x] Create migration: `dotnet ef migrations add AddLocationSnapshots ...`

### 4.9 Frontend: GPS Capture in Log Flow
- [x] **File: `src/clients/mobile-web/src/application/use-cases/CaptureLocation.ts`** -- CREATE
  - Checks permission via DeviceLocationService
  - If first time: shows consent prompt (UI decides how)
  - If granted: captures location, returns LocationSnapshot
  - If denied: returns null (logging continues without GPS)
  - NEVER blocks the logging flow

- [x] **File: `src/clients/mobile-web/src/infrastructure/sync/MutationQueue.ts`** -- MODIFY
  - `create_daily_log` mutation payload now includes optional `location` field
  - `add_cost_entry` mutation payload now includes optional `location` field

### 4.10 Frontend: Location Consent State
- [x] **File: `src/clients/mobile-web/src/infrastructure/storage/DexieDatabase.ts`** -- MODIFY
  - Add to `appMeta`: key `gps_consent` with value `{ askedAt, decision: 'granted'|'denied'|'later' }`
  - Consent is remembered -- don't ask again unless user resets from settings

### 4.11 Tests
- [x] **File: `src/tests/ShramSafal.Domain.Tests/Location/LocationSnapshotTests.cs`** -- CREATE
  - Test: DailyLog with location -> location stored
  - Test: DailyLog without location -> works fine
  - Test: AttachLocation on log that already has location -> throws (immutable)
  - Test: Location in sync pull -> correctly deserialized

### PHASE 4 GATE
**Status (2026-02-22):** PASSED (build + domain tests + sync integration tests green)
**Note:** `AddLocationSnapshots` migration also includes Attachment/OCR schema deltas already present in current working model (Phase 2 in-progress).

```bash
# Log with GPS works
curl -X POST localhost:5048/shramsafal/logs \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"farmId":"...","plotId":"...","date":"2026-02-22","location":{"latitude":18.5204,"longitude":73.8567,"accuracyMeters":10,"capturedAtUtc":"2026-02-22T10:00:00Z","provider":"gps","permissionState":"granted"}}' \
  | grep id
# Returns log ID

# Log without GPS works
curl -X POST localhost:5048/shramsafal/logs \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"farmId":"...","plotId":"...","date":"2026-02-22"}' \
  | grep id
# Returns log ID (no error despite missing location)

# Sync pull includes location
curl "localhost:5048/sync/pull?since=0" \
  -H "Authorization: Bearer {token}" \
  | grep latitude
# Location data present on logs that have it
```

---

## PHASE 5: PDF EXPORT & DEVICE SAVE

**Goal:** Backend generates PDF reports (daily summary, monthly cost, verification). Frontend downloads and saves to device via DeviceShareAndSaveService.

**Prerequisites:** Phase 1 complete (DeviceShareAndSaveService available).

### 5.1 PDF Generation Library
- [x] **Run:** `dotnet add src/apps/ShramSafal/ShramSafal.Infrastructure/ShramSafal.Infrastructure.csproj package QuestPDF`
  - QuestPDF is MIT-licensed for community use, good for .NET PDF generation

### 5.2 Export Service Port
- [x] **File: `src/apps/ShramSafal/ShramSafal.Application/Ports/External/IReportExportService.cs`** -- CREATE
  ```csharp
  public interface IReportExportService
  {
      Task<byte[]> GenerateDailySummaryAsync(Guid farmId, DateOnly date, CancellationToken ct);
      Task<byte[]> GenerateMonthlyCostReportAsync(Guid farmId, int year, int month, CancellationToken ct);
      Task<byte[]> GenerateVerificationReportAsync(Guid farmId, DateOnly fromDate, DateOnly toDate, CancellationToken ct);
  }
  ```

### 5.3 PDF Report Implementation
- [x] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Reports/PdfReportExportService.cs`** -- CREATE
  - Implements `IReportExportService`
  - Uses QuestPDF Fluent API
  - Each report type gets its own private method
  - Loads data via IShramSafalRepository
  - Reports include: farm name, date range, summary tables, totals

- [x] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Reports/DailySummaryReport.cs`** -- CREATE
  - Daily Summary includes:
    - Farm name, date
    - Per-plot: activities logged (task type, description, workers)
    - Cost breakdown by category
    - Verification status per log
    - Weather (if available)
    - Attached receipt count

- [x] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Reports/MonthlyCostReport.cs`** -- CREATE
  - Monthly Cost includes:
    - Farm name, month/year
    - Per-plot cost summary (direct + allocated)
    - Category breakdown (Labour, Seeds, Fertilizer, Pesticide, Equipment, Fuel)
    - Daily cost chart data (table form)
    - Flagged entries highlighted
    - Grand total

- [x] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Reports/VerificationReport.cs`** -- CREATE
  - Verification Report includes:
    - Farm name, date range
    - Per-log: date, plot, tasks, verification status, verifier name, timestamps
    - Summary: total logs, verified count, disputed count, pending count
    - Corrections listed with before/after

### 5.4 Export Use Cases
- [x] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Export/ExportDailySummary/ExportDailySummaryHandler.cs`** -- CREATE
  - Query: `{ farmId, date }`
  - Returns: byte[] (PDF file content)

- [x] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Export/ExportMonthlyCost/ExportMonthlyCostHandler.cs`** -- CREATE
  - Query: `{ farmId, year, month }`

- [x] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Export/ExportVerificationReport/ExportVerificationReportHandler.cs`** -- CREATE
  - Query: `{ farmId, fromDate, toDate }`

### 5.5 API Endpoints
- [x] **File: `src/apps/ShramSafal/ShramSafal.Api/Endpoints/ExportEndpoints.cs`** -- CREATE
  - `GET /shramsafal/export/daily-summary?farmId=X&date=Y` -- returns PDF
    - Content-Type: application/pdf
    - Content-Disposition: attachment; filename="daily-summary-{date}.pdf"
  - `GET /shramsafal/export/monthly-cost?farmId=X&year=Y&month=Z` -- returns PDF
  - `GET /shramsafal/export/verification?farmId=X&fromDate=Y&toDate=Z` -- returns PDF

### 5.6 DI Registration
- [x] Register `IReportExportService` -> `PdfReportExportService`
- [x] Register all export handlers
- [x] Add QuestPDF license setup in Program.cs: `QuestPDF.Settings.License = LicenseType.Community;`

### 5.7 Frontend: Export & Save
- [x] **File: `src/clients/mobile-web/src/infrastructure/api/AgriSyncClient.ts`** -- MODIFY
  - Add: `exportDailySummary(farmId, date): Promise<Blob>`
  - Add: `exportMonthlyCost(farmId, year, month): Promise<Blob>`
  - Add: `exportVerificationReport(farmId, fromDate, toDate): Promise<Blob>`
  - All return Blob (binary PDF)

- [x] **File: `src/clients/mobile-web/src/application/use-cases/ExportReport.ts`** -- CREATE
  - Input: reportType ('daily' | 'monthly' | 'verification'), params
  - Logic:
    1. Call appropriate API endpoint
    2. Receive PDF blob
    3. Call DeviceShareAndSaveService.saveToDownloads() with filename
    4. Optionally offer share dialog
  - On web: falls back to browser download

### 5.8 Tests
- [x] **File: `src/tests/ShramSafal.Domain.Tests/Export/ExportHandlerTests.cs`** -- CREATE
  - Test: Daily summary generates non-empty PDF
  - Test: Monthly cost with no data returns empty-state PDF (not error)
  - Test: Verification report covers correct date range

### PHASE 5 GATE
**Status (2026-02-22):** IMPLEMENTED AND PARTIALLY VERIFIED
- Verified: `dotnet build src/AgriSync.sln` passes, `dotnet test --filter "ExportHandlerTests"` passes, frontend `npm run build` passes.
- Pending manual/API validation: authenticated `curl` calls for all three `/shramsafal/export/*` endpoints.

```bash
# Daily summary PDF endpoint
curl -o daily.pdf "localhost:5048/shramsafal/export/daily-summary?farmId={id}&date=2026-02-22" \
  -H "Authorization: Bearer {token}"
# File downloaded, non-zero size
file daily.pdf
# Should say "PDF document"

# Monthly cost report
curl -o monthly.pdf "localhost:5048/shramsafal/export/monthly-cost?farmId={id}&year=2026&month=2" \
  -H "Authorization: Bearer {token}"
# PDF downloaded

# Frontend builds
cd src/clients/mobile-web && npm run build
# Zero errors
```

---

## PHASE 6: REFERENCE DATA API & TEMPLATE SERVING

**Goal:** Backend becomes the single source of truth for plan templates, schedule definitions, and crop reference data. Client fetches these on first sync and caches in Dexie. Client NEVER hardcodes master data.

**Prerequisites:** Previous phases complete. Backend planning domain operational.

### 6.1 Template API Endpoints
- [x] **File: `src/apps/ShramSafal/ShramSafal.Api/Endpoints/ReferenceDataEndpoints.cs`** -- CREATE
  - `GET /shramsafal/reference/schedule-templates` -- All schedule templates with activities
    - Returns: List of ScheduleTemplateDto (name, cropType, stages[], activities[])
  - `GET /shramsafal/reference/schedule-templates/{id}` -- Single template with full detail
  - `GET /shramsafal/reference/crop-types` -- Enumeration of supported crop types
    - Returns: `[{ name: "Grapes", stages: [...], defaultTemplateId: "..." }, ...]`
  - `GET /shramsafal/reference/activity-categories` -- Standard activity categories
    - Returns: `["Spraying", "Irrigation", "Fertigation", "Pruning", "Harvest", ...]`
  - `GET /shramsafal/reference/cost-categories` -- Standard cost categories
    - Returns: `["Labour", "Seeds", "Fertilizer", "Pesticide", "Equipment", "Fuel", ...]`

### 6.2 Reference Data Use Cases
- [x] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/ReferenceData/GetScheduleTemplates/GetScheduleTemplatesHandler.cs`** -- CREATE
  - Returns all schedule templates with stages and activities
  - Includes version hash for cache invalidation

- [x] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/ReferenceData/GetCropTypes/GetCropTypesHandler.cs`** -- CREATE
  - Returns crop type reference data

### 6.3 Reference Data DTOs
- [x] **File: `src/apps/ShramSafal/ShramSafal.Application/Contracts/Dtos/ReferenceDataDtos.cs`** -- CREATE
  ```csharp
  public record ScheduleTemplateDto(
      Guid Id, string Name, string CropType, int TotalDays,
      List<StageDefinitionDto> Stages,
      List<TemplateActivityDto> Activities,
      string VersionHash);

  public record StageDefinitionDto(string Name, int StartDay, int EndDay);
  public record TemplateActivityDto(string Name, string Category, string StageName,
      int StartDay, int EndDay, string FrequencyMode, int? IntervalDays);

  public record CropTypeDto(string Name, string[] Stages, Guid? DefaultTemplateId);
  ```

### 6.4 Sync: Include Reference Data
- [x] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Sync/PullSyncChanges/PullSyncChangesHandler.cs`** -- MODIFY
  - Add `scheduleTemplates` to pull response
  - Include version hash so client can skip re-caching if unchanged

- [x] **File: `src/apps/ShramSafal/ShramSafal.Application/Contracts/Dtos/SyncDtos.cs`** -- MODIFY
  - Add `List<ScheduleTemplateDto> ScheduleTemplates` to pull response
  - Add `string ReferenceDataVersionHash` to pull response

### 6.5 Frontend: Cache Reference Data
- [x] **File: `src/clients/mobile-web/src/infrastructure/storage/DexieDatabase.ts`** -- MODIFY
  - Add `referenceData` table: `key, data, versionHash, updatedAt`
  - Keys: 'scheduleTemplates', 'cropTypes', 'activityCategories', 'costCategories'

- [x] **File: `src/clients/mobile-web/src/infrastructure/sync/SyncPullReconciler.ts`** -- MODIFY
  - On pull: if `referenceDataVersionHash` changed, update Dexie `referenceData`
  - If unchanged: skip (cache hit)

### 6.6 Frontend: Remove Hardcoded Templates from Bundle
- [ ] Verify `src/clients/mobile-web/src/data/` folder is already deleted (done in Phase 7 of previous plan)
- [ ] Audit `dist/` build output: search for hardcoded schedule template strings
  - `grep -r "grapeMasterSchedule\|scheduleLibrary\|RAMUS_FARM" src/clients/mobile-web/src/`
  - Should return ZERO results
- [ ] If any hardcoded reference data remains in source, replace with Dexie reads from `referenceData` table

### 6.7 Frontend: Reference Data Hooks
- [x] **File: `src/clients/mobile-web/src/app/hooks/useReferenceData.ts`** -- CREATE
  ```typescript
  export function useScheduleTemplates(): ScheduleTemplateDto[] | null;
  export function useCropTypes(): CropTypeDto[] | null;
  export function useActivityCategories(): string[] | null;
  export function useCostCategories(): string[] | null;
  ```
  - Reads from Dexie `referenceData` table
  - Returns null while loading (UI shows skeleton)
  - Auto-refreshes on sync

### 6.8 Seed: Ensure Templates in Backend
- [x] **File: `src/AgriSync.Bootstrapper/Infrastructure/DatabaseSeeder.cs`** -- MODIFY
  - Verify schedule templates are seeded with FULL stage definitions and activities
  - Must cover: Grapes (all stages), Pomegranate, Sugarcane, Onion
  - Templates must match what was previously in `grapeMasterSchedule.ts` and `scheduleLibrary.ts`

### PHASE 6 GATE
**Status (2026-02-22):** PARTIAL. Reference data API and client caching are implemented. Gate blockers remain: hardcoded template references still exist in `src/clients/mobile-web/src/`, and `/sync/pull?since=0` fails in the current local environment due PostgreSQL authentication (`28P01`) on `localhost:5433`.

```bash
# Templates served by API
curl localhost:5048/shramsafal/reference/schedule-templates \
  -H "Authorization: Bearer {token}" \
  | python -m json.tool | head -20
# Returns list of templates with stages and activities

# Crop types served
curl localhost:5048/shramsafal/reference/crop-types \
  -H "Authorization: Bearer {token}" \
  | grep Grapes
# Returns crop type data

# No hardcoded templates in frontend source
grep -r "grapeMasterSchedule\|scheduleLibrary\|RAMUS_FARM" src/clients/mobile-web/src/
# Should return nothing

# Sync pull includes templates
curl "localhost:5048/sync/pull?since=0" \
  -H "Authorization: Bearer {token}" \
  | grep scheduleTemplates
# Present in pull response

# Frontend builds
cd src/clients/mobile-web && npm run build
# Zero errors
```

---

## PHASE 7: LEDGER CORRECTNESS & SYNC HARDENING

**Goal:** Make the append-only ledger model airtight. Ensure no destructive updates on any ledger entity. Ensure sync is strictly command-based. Ensure attribution always comes from auth claims. Add audit trail for all mutations.

**Prerequisites:** All previous phases complete.

### 7.1 Append-Only Enforcement in Domain
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Domain/Logs/DailyLog.cs`** -- AUDIT & MODIFY
  - Remove any public setters on: Date, FarmId, PlotId, CropCycleId, CreatedByUserId
  - `Edit()` method must create a NEW VerificationEvent (status reset to Draft), NOT modify existing fields
  - Confirm: no `Update()` or `Delete()` methods exist
  - All modifications go through domain methods that append events

- [ ] **File: `src/apps/ShramSafal/ShramSafal.Domain/Finance/CostEntry.cs`** -- AUDIT & MODIFY
  - Remove any public setters on: Amount, Category, PlotId, CreatedByUserId, CreatedAtUtc
  - Corrections ONLY via FinanceCorrection (new record referencing original)
  - No `Update()` or `Delete()` methods

- [ ] **File: `src/apps/ShramSafal/ShramSafal.Domain/Attachments/Attachment.cs`** -- AUDIT
  - Confirm: no modifications after Finalize()
  - No Delete() method

### 7.2 Attribution from Claims Only
- [ ] **Audit ALL endpoint handlers** -- ensure CreatedByUserId comes from `ClaimsPrincipal`, NEVER from request body
  - `POST /shramsafal/logs` -- CreatedByUserId from JWT ✓ (verify)
  - `POST /shramsafal/logs/{id}/tasks` -- CreatedByUserId from JWT ✓ (verify)
  - `POST /shramsafal/logs/{id}/verify` -- VerifiedByUserId from JWT ✓ (verify)
  - `POST /shramsafal/finance/cost-entry` -- CreatedByUserId from JWT ✓ (verify)
  - `POST /shramsafal/finance/cost-entry/{id}/correct` -- CorrectedByUserId from JWT ✓ (verify)
  - `POST /shramsafal/finance/allocate` -- CreatedByUserId from JWT ✓ (verify)
  - `POST /shramsafal/attachments` -- UploadedByUserId from JWT ✓ (verify)

- [ ] **File: `src/apps/ShramSafal/ShramSafal.Api/Endpoints/LogsEndpoints.cs`** -- VERIFY
  - If any endpoint reads `createdByUserId` from request body, REMOVE IT
  - Replace with extraction from `HttpContext.User.FindFirst("sub")` or equivalent

### 7.3 Sync Push: Strict Command Validation
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Sync/PushSyncBatch/PushSyncBatchHandler.cs`** -- AUDIT & MODIFY
  - Every mutation type MUST:
    1. Extract userId from the authenticated context (not from mutation payload)
    2. Validate farm membership before processing
    3. Return clear error if mutation is malformed
  - New mutation types supported:
    - `create_attachment` -- creates attachment record
    - `add_location` -- NOT a standalone mutation (location comes with create_daily_log)
  - Reject any mutation that tries to send full object state (only commands allowed)

### 7.4 Sync Pull: Read Model Consistency
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Sync/PullSyncChanges/PullSyncChangesHandler.cs`** -- AUDIT
  - Pull must include ALL entities changed since cursor:
    - Farms, Plots, CropCycles
    - DailyLogs (with tasks, verification events, location, attachment metadata)
    - CostEntries (with location, attachment metadata)
    - FinanceCorrections
    - DayLedgers (with allocations)
    - PlannedActivities
    - Attachments (metadata only, not file bytes)
    - ScheduleTemplates (reference data)
  - Every entity must have `ModifiedAtUtc` for delta queries

### 7.5 Idempotency Hardening
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Application/Ports/ISyncMutationStore.cs`** -- AUDIT
  - Confirm: `TryStoreSuccessAsync` is called for EVERY mutation type (not just some)
  - Confirm: duplicate clientRequestId returns stored result (not re-processing)
  - Confirm: no race condition if same mutation arrives on two simultaneous requests

### 7.6 Audit Event Table
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Domain/Audit/AuditEvent.cs`** -- CREATE
  ```csharp
  public class AuditEvent
  {
      public Guid Id { get; private set; }
      public string EntityType { get; private set; }     // "DailyLog", "CostEntry", etc.
      public Guid EntityId { get; private set; }
      public string Action { get; private set; }          // "Created", "Verified", "Corrected", "LocationAttached"
      public Guid ActorUserId { get; private set; }
      public string ActorRole { get; private set; }
      public string Payload { get; private set; }          // JSON snapshot of the change
      public DateTime OccurredAtUtc { get; private set; }
      public string? ClientCommandId { get; private set; } // Links to sync mutation

      public static AuditEvent Create(string entityType, Guid entityId, string action,
          Guid actorUserId, string actorRole, object payload, string? clientCommandId = null);
  }
  ```

### 7.7 Audit Persistence
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Configurations/AuditEventConfiguration.cs`** -- CREATE
  - Table: `audit_events`, schema: `ssf`
  - Index: (EntityType, EntityId)
  - Index: (ActorUserId)
  - Index: (OccurredAtUtc)
  - APPEND ONLY -- no update or delete operations

- [ ] **File: `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/ShramSafalDbContext.cs`** -- MODIFY
  - Add: `DbSet<AuditEvent> AuditEvents`

### 7.8 Audit Integration in Use Cases
- [ ] Every handler that creates or modifies a ledger entity must also create an AuditEvent:
  - `CreateDailyLogHandler` -> AuditEvent("DailyLog", id, "Created", ...)
  - `AddLogTaskHandler` -> AuditEvent("DailyLog", logId, "TaskAdded", ...)
  - `VerifyLogHandler` -> AuditEvent("DailyLog", logId, "VerificationChanged", ...)
  - `AddCostEntryHandler` -> AuditEvent("CostEntry", id, "Created", ...)
  - `CorrectCostEntryHandler` -> AuditEvent("CostEntry", id, "Corrected", ...)
  - `AllocateGlobalExpenseHandler` -> AuditEvent("DayLedger", id, "Allocated", ...)
  - `UploadAttachmentHandler` -> AuditEvent("Attachment", id, "Uploaded", ...)

### 7.9 Audit API Endpoint
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Api/Endpoints/AuditEndpoints.cs`** -- CREATE
  - `GET /shramsafal/audit?entityType=X&entityId=Y` -- History of changes for an entity
  - `GET /shramsafal/audit?farmId=X&fromDate=Y&toDate=Z` -- All audit events for farm in date range
  - Requires auth. Farm membership enforced.

### 7.10 Repository Updates
- [ ] **File: `src/apps/ShramSafal/ShramSafal.Application/Ports/IShramSafalRepository.cs`** -- MODIFY
  - Add: `AddAuditEventAsync(AuditEvent auditEvent)`
  - Add: `GetAuditEventsForEntityAsync(Guid entityId, string entityType)`
  - Add: `GetAuditEventsForFarmAsync(Guid farmId, DateOnly from, DateOnly to, int limit, int offset)`

### 7.11 EF Migration
- [ ] Create migration: `dotnet ef migrations add AddAuditEvents ...`

### 7.12 Frontend: Sync Status Transparency
- [ ] **File: `src/clients/mobile-web/src/infrastructure/sync/MutationQueue.ts`** -- MODIFY
  - Add: `create_attachment` mutation type
  - Ensure ALL mutations include `clientCommandId` (UUID)

- [ ] Verify: Every user action in the UI that modifies data goes through MutationQueue
  - No direct API calls for writes (only for reads and exports)

### 7.13 Tests
- [ ] **File: `src/tests/ShramSafal.Domain.Tests/Audit/AuditEventTests.cs`** -- CREATE
  - Test: AuditEvent.Create() sets all fields correctly
  - Test: Payload serialization includes relevant data
  - Test: No update/delete operations on AuditEvent entity

- [ ] **File: `src/tests/ShramSafal.Domain.Tests/Ledger/AppendOnlyTests.cs`** -- CREATE
  - Test: DailyLog has no public setters on core fields
  - Test: CostEntry has no public setters on core fields
  - Test: DailyLog.Edit() creates VerificationEvent, does not modify log fields
  - Test: CostEntry correction creates FinanceCorrection record

### PHASE 7 GATE
```bash
# Audit trail works
curl "localhost:5048/shramsafal/audit?entityType=DailyLog&entityId={id}" \
  -H "Authorization: Bearer {token}" \
  | grep action
# Returns list of audit events

# Append-only tests pass
dotnet test --filter "AppendOnly|AuditEvent"
# All pass

# Full test suite passes
dotnet test src/AgriSync.sln
# All tests pass

# Idempotency verified: push same mutation twice
# Second push returns same result without creating duplicate
```

---

## EXECUTION ORDER (Critical Path)

```
Phase 0: Repo Hygiene & Build Discipline     <-- MUST pass before anything
    |
Phase 1: Capacitor & Device Abstraction      <-- Foundation for all device features
    |
    +--> Phase 2: Attachment & File Upload    <-- Depends on Phase 1 (device services)
    |        |
    |        +--> Phase 3: Camera OCR         <-- Depends on Phase 2 (attachments)
    |
    +--> Phase 4: GPS Metadata               <-- Depends on Phase 1 (location service)
    |
    +--> Phase 5: PDF Export & Save          <-- Depends on Phase 1 (share service)
    |
Phase 6: Reference Data API                  <-- Independent of device features
    |
Phase 7: Ledger Correctness & Audit          <-- Final hardening, depends on all above
```

**Parallelization:** After Phase 1, Phases 2-5 can be worked in parallel (different developers). Phase 6 is independent. Phase 7 is the final sweep.

**THE RULE:** UI flows can be redesigned at any point without changing this plan. Only the system integrity rules (immutability, attribution, append-only, idempotency) are frozen. If a developer wants to change how GPS consent looks, or where the camera button sits, or how export is triggered -- that is free. What is NOT free is changing how GPS data is stored (immutable), how attachments are linked (immutable), or who gets attributed for an action (always from JWT claims).

---

## RISKS AND MITIGATIONS

| Risk | Impact | Mitigation |
|---|---|---|
| Capacitor plugin version conflicts | Build breaks on Android | Pin exact plugin versions. Test Capacitor sync after every plugin install. |
| Large file uploads fail on rural networks | Photos/receipts lost | Local-first save (never lost). Upload queue with retry. Chunked upload if needed. |
| OCR accuracy low on handwritten receipts | Users lose trust in OCR | OCR is always "draft". Never auto-commit. Show confidence. Let user correct. |
| GPS drains battery | Users disable GPS entirely | GPS capture is a single-shot (not continuous). Background GPS never used. |
| QuestPDF renders slowly for large reports | Export timeout | Paginate: max 1 month per report. Generate async if needed. |
| Audit table grows large | DB performance | Index on (EntityType, EntityId). Partition by month if needed. Archive old events. |
| Reference data cache stale | Client shows old templates | Version hash comparison on every sync pull. Force refresh option in settings. |
| node_modules in git history inflates repo | Slow clone | Run `git filter-branch` or BFG to remove from history (optional, do after stable). |

---

## DEFINITION OF DONE (Final Audit Checklist)

Every line below must be `[x]` for this plan to be declared complete.

### Repo Hygiene
- [ ] `dist/` not tracked in git
- [ ] `node_modules/` not tracked in git
- [ ] Fresh clone: `npm install && npm run build` works
- [ ] One command backend: `dotnet run --project src/AgriSync.Bootstrapper`
- [ ] One command frontend: `cd src/clients/mobile-web && npm run dev`
- [ ] No build artifacts committed

### Capacitor
- [x] `capacitor.config.ts` exists in `src/clients/mobile-web/`
- [x] `npx cap sync` succeeds
- [x] Android project builds (manual verification)
- [x] Device service interfaces: Camera, Files, Location, Share, Permissions
- [x] Web implementations work in browser
- [x] Capacitor implementations exist (can test on Android)
- [x] Platform detection + service factory wired

### Attachments & File Upload
- [ ] Attachment entity in backend with full lifecycle
- [ ] Upload endpoint: POST /attachments + POST /attachments/{id}/upload
- [ ] Local file storage works (dev)
- [ ] Frontend: capture -> local save -> upload queue -> retry
- [ ] Attachments are immutable after finalization
- [ ] Attachments linkable to DailyLog, CostEntry
- [ ] Sync pull includes attachment metadata

### Camera OCR
- [ ] OCR endpoint: POST /attachments/{id}/ocr
- [ ] Gemini Vision integration for receipt extraction
- [ ] OCR output stored as machine suggestion (not auto-committed)
- [ ] Frontend: OCR result pre-fills form, user must confirm
- [ ] Offline graceful: queues OCR for later

### GPS
- [ ] LocationSnapshot on DailyLog (optional)
- [ ] LocationSnapshot on CostEntry (optional)
- [ ] Consent flow: ask once, remember
- [ ] App works WITHOUT GPS (non-blocking)
- [ ] Location immutable after submission
- [ ] Sync carries location data

### PDF Export
- [ ] 3 export endpoints: daily summary, monthly cost, verification report
- [ ] QuestPDF generates valid PDFs
- [ ] Frontend downloads + saves via DeviceShareAndSaveService
- [ ] Web fallback: browser download

### Reference Data
- [ ] Backend serves schedule templates via API
- [ ] Backend serves crop types, activity categories, cost categories
- [ ] Sync pull includes reference data with version hash
- [ ] Frontend caches in Dexie, reads from cache
- [ ] ZERO hardcoded templates in frontend source
- [ ] Client only caches and renders (does not derive)

### Ledger Correctness
- [ ] No public setters on DailyLog core fields
- [ ] No public setters on CostEntry core fields
- [ ] Attachments immutable after finalize
- [ ] All CreatedByUserId/VerifiedByUserId from JWT claims only
- [ ] Corrections are new records (not edits)
- [ ] AuditEvent table captures all mutations
- [ ] Every sync push mutation validated for farm membership
- [ ] Idempotency: duplicate mutations return stored result

### System
- [ ] `dotnet build src/AgriSync.sln` -- zero errors, zero warnings
- [ ] `dotnet test src/AgriSync.sln` -- all tests pass
- [ ] `npm run build` (frontend) -- zero errors
- [ ] `npx tsc --noEmit` (frontend) -- zero errors
- [ ] `npx cap sync` -- no errors
- [ ] Login -> sync -> see rich data with attachments, location, verification statuses
- [ ] Export daily summary PDF -- valid file saved
- [ ] Offline capture: photo, log, cost entry -- all saved locally, uploaded on reconnect

---

## NEW BACKEND API ENDPOINTS (Complete Reference)

| # | Endpoint | Method | Phase |
|---|---|---|---|
| 1 | `/shramsafal/attachments` | POST | 2 |
| 2 | `/shramsafal/attachments/{id}/upload` | POST | 2 |
| 3 | `/shramsafal/attachments/{id}` | GET | 2 |
| 4 | `/shramsafal/attachments/{id}/download` | GET | 2 |
| 5 | `/shramsafal/attachments?entityId=X&entityType=Y` | GET | 2 |
| 6 | `/shramsafal/attachments/{id}/ocr` | POST | 3 |
| 7 | `/shramsafal/attachments/{id}/ocr` | GET | 3 |
| 8 | `/shramsafal/export/daily-summary` | GET | 5 |
| 9 | `/shramsafal/export/monthly-cost` | GET | 5 |
| 10 | `/shramsafal/export/verification` | GET | 5 |
| 11 | `/shramsafal/reference/schedule-templates` | GET | 6 |
| 12 | `/shramsafal/reference/schedule-templates/{id}` | GET | 6 |
| 13 | `/shramsafal/reference/crop-types` | GET | 6 |
| 14 | `/shramsafal/reference/activity-categories` | GET | 6 |
| 15 | `/shramsafal/reference/cost-categories` | GET | 6 |
| 16 | `/shramsafal/audit?entityType=X&entityId=Y` | GET | 7 |
| 17 | `/shramsafal/audit?farmId=X&fromDate=Y&toDate=Z` | GET | 7 |

**Existing endpoints that gain new fields:**
| # | Endpoint | Change | Phase |
|---|---|---|---|
| 1 | `POST /shramsafal/logs` | Accepts optional `location` object | 4 |
| 2 | `POST /shramsafal/finance/cost-entry` | Accepts optional `location` object | 4 |
| 3 | `GET /sync/pull` | Returns attachments, location, referenceData, auditEvents | 2,4,6,7 |
| 4 | `POST /sync/push` | New mutation type: `create_attachment` | 2 |

---

## NEW BACKEND FILES (Complete Reference)

| # | File Path (relative to src/) | Phase | Purpose |
|---|---|---|---|
| 1 | `apps/ShramSafal/ShramSafal.Domain/Attachments/Attachment.cs` | 2 | Attachment entity |
| 2 | `apps/ShramSafal/ShramSafal.Domain/Attachments/AttachmentStatus.cs` | 2 | Status enum |
| 3 | `apps/ShramSafal/ShramSafal.Domain/OCR/OcrExtractionResult.cs` | 3 | OCR result record |
| 4 | `apps/ShramSafal/ShramSafal.Domain/OCR/OcrResult.cs` | 3 | OCR storage entity |
| 5 | `apps/ShramSafal/ShramSafal.Domain/Location/LocationSnapshot.cs` | 4 | GPS value object |
| 6 | `apps/ShramSafal/ShramSafal.Domain/Audit/AuditEvent.cs` | 7 | Audit trail entity |
| 7 | `apps/ShramSafal/ShramSafal.Application/Ports/External/IAttachmentStorageService.cs` | 2 | File storage port |
| 8 | `apps/ShramSafal/ShramSafal.Application/Ports/External/IOcrExtractionService.cs` | 3 | OCR port |
| 9 | `apps/ShramSafal/ShramSafal.Application/Ports/External/IReportExportService.cs` | 5 | PDF export port |
| 10 | `apps/ShramSafal/ShramSafal.Application/UseCases/Attachments/CreateAttachment/CreateAttachmentHandler.cs` | 2 | Create attachment |
| 11 | `apps/ShramSafal/ShramSafal.Application/UseCases/Attachments/UploadAttachment/UploadAttachmentHandler.cs` | 2 | Upload file |
| 12 | `apps/ShramSafal/ShramSafal.Application/UseCases/Attachments/GetAttachment/GetAttachmentHandler.cs` | 2 | Get metadata |
| 13 | `apps/ShramSafal/ShramSafal.Application/UseCases/Attachments/GetAttachmentFile/GetAttachmentFileHandler.cs` | 2 | Download file |
| 14 | `apps/ShramSafal/ShramSafal.Application/UseCases/OCR/ExtractFromReceipt/ExtractFromReceiptHandler.cs` | 3 | OCR extraction |
| 15 | `apps/ShramSafal/ShramSafal.Application/UseCases/Export/ExportDailySummary/ExportDailySummaryHandler.cs` | 5 | Daily PDF |
| 16 | `apps/ShramSafal/ShramSafal.Application/UseCases/Export/ExportMonthlyCost/ExportMonthlyCostHandler.cs` | 5 | Monthly PDF |
| 17 | `apps/ShramSafal/ShramSafal.Application/UseCases/Export/ExportVerificationReport/ExportVerificationReportHandler.cs` | 5 | Verification PDF |
| 18 | `apps/ShramSafal/ShramSafal.Application/UseCases/ReferenceData/GetScheduleTemplates/GetScheduleTemplatesHandler.cs` | 6 | Template serving |
| 19 | `apps/ShramSafal/ShramSafal.Application/UseCases/ReferenceData/GetCropTypes/GetCropTypesHandler.cs` | 6 | Crop types |
| 20 | `apps/ShramSafal/ShramSafal.Application/Contracts/Dtos/ReferenceDataDtos.cs` | 6 | Ref data DTOs |
| 21 | `apps/ShramSafal/ShramSafal.Infrastructure/Storage/LocalFileStorageService.cs` | 2 | File storage impl |
| 22 | `apps/ShramSafal/ShramSafal.Infrastructure/Storage/StorageOptions.cs` | 2 | Storage config |
| 23 | `apps/ShramSafal/ShramSafal.Infrastructure/Integrations/Gemini/GeminiOcrService.cs` | 3 | OCR impl |
| 24 | `apps/ShramSafal/ShramSafal.Infrastructure/Reports/PdfReportExportService.cs` | 5 | PDF generator |
| 25 | `apps/ShramSafal/ShramSafal.Infrastructure/Reports/DailySummaryReport.cs` | 5 | Daily report |
| 26 | `apps/ShramSafal/ShramSafal.Infrastructure/Reports/MonthlyCostReport.cs` | 5 | Monthly report |
| 27 | `apps/ShramSafal/ShramSafal.Infrastructure/Reports/VerificationReport.cs` | 5 | Verification report |
| 28 | `apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Configurations/AttachmentConfiguration.cs` | 2 | EF config |
| 29 | `apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Configurations/OcrResultConfiguration.cs` | 3 | EF config |
| 30 | `apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Configurations/AuditEventConfiguration.cs` | 7 | EF config |
| 31 | `apps/ShramSafal/ShramSafal.Api/Endpoints/AttachmentEndpoints.cs` | 2 | Attachment API |
| 32 | `apps/ShramSafal/ShramSafal.Api/Endpoints/ExportEndpoints.cs` | 5 | Export API |
| 33 | `apps/ShramSafal/ShramSafal.Api/Endpoints/ReferenceDataEndpoints.cs` | 6 | Ref data API |
| 34 | `apps/ShramSafal/ShramSafal.Api/Endpoints/AuditEndpoints.cs` | 7 | Audit API |

### New Frontend Files

| # | File Path (relative to src/clients/mobile-web/src/) | Phase | Purpose |
|---|---|---|---|
| 1 | `infrastructure/device/DeviceCameraService.ts` | 1 | Camera interface |
| 2 | `infrastructure/device/DeviceFilesService.ts` | 1 | Files interface |
| 3 | `infrastructure/device/DeviceLocationService.ts` | 1 | Location interface |
| 4 | `infrastructure/device/DeviceShareAndSaveService.ts` | 1 | Share/save interface |
| 5 | `infrastructure/device/DevicePermissionsService.ts` | 1 | Permissions interface |
| 6 | `infrastructure/device/DeviceServiceFactory.ts` | 1 | Platform detection |
| 7 | `infrastructure/device/index.ts` | 1 | Barrel export |
| 8 | `infrastructure/device/web/WebCameraService.ts` | 1 | Web camera impl |
| 9 | `infrastructure/device/web/WebFilesService.ts` | 1 | Web files impl |
| 10 | `infrastructure/device/web/WebLocationService.ts` | 1 | Web location impl |
| 11 | `infrastructure/device/web/WebShareAndSaveService.ts` | 1 | Web share impl |
| 12 | `infrastructure/device/web/WebPermissionsService.ts` | 1 | Web permissions impl |
| 13 | `infrastructure/device/capacitor/CapacitorCameraService.ts` | 1 | Native camera |
| 14 | `infrastructure/device/capacitor/CapacitorFilesService.ts` | 1 | Native files |
| 15 | `infrastructure/device/capacitor/CapacitorLocationService.ts` | 1 | Native location |
| 16 | `infrastructure/device/capacitor/CapacitorShareAndSaveService.ts` | 1 | Native share |
| 17 | `infrastructure/device/capacitor/CapacitorPermissionsService.ts` | 1 | Native permissions |
| 18 | `infrastructure/sync/AttachmentUploadWorker.ts` | 2 | Upload queue worker |
| 19 | `application/use-cases/CaptureAttachment.ts` | 2 | Attachment capture |
| 20 | `application/use-cases/ExtractReceiptData.ts` | 3 | OCR draft flow |
| 21 | `application/use-cases/CaptureLocation.ts` | 4 | GPS capture |
| 22 | `application/use-cases/ExportReport.ts` | 5 | PDF download/save |
| 23 | `app/hooks/useReferenceData.ts` | 6 | Ref data hooks |

### Modified Files

| # | File Path | Phase | Change |
|---|---|---|---|
| 1 | `.gitignore` | 0 | Add dist/, android/, ios/ |
| 2 | `src/clients/mobile-web/.gitignore` | 0 | CREATE -- frontend-specific ignores |
| 3 | `src/clients/mobile-web/package.json` | 0,1 | Scripts, Capacitor deps |
| 4 | `src/clients/mobile-web/vite.config.ts` | 1 | base: './' for Capacitor |
| 5 | `src/clients/mobile-web/src/app/compositionRoot.ts` | 1 | Wire device services |
| 6 | `src/clients/mobile-web/src/infrastructure/storage/DexieDatabase.ts` | 2,4,6 | v4+: attachments, uploadQueue, referenceData tables |
| 7 | `src/clients/mobile-web/src/infrastructure/api/AgriSyncClient.ts` | 2,3,5 | Attachment, OCR, export methods |
| 8 | `src/clients/mobile-web/src/infrastructure/sync/SyncPullReconciler.ts` | 2,6 | Attachments, reference data |
| 9 | `src/clients/mobile-web/src/infrastructure/sync/MutationQueue.ts` | 4,7 | Location in mutations, create_attachment |
| 10 | `src/apps/ShramSafal/ShramSafal.Domain/Logs/DailyLog.cs` | 4,7 | Location, append-only audit |
| 11 | `src/apps/ShramSafal/ShramSafal.Domain/Finance/CostEntry.cs` | 4,7 | Location, append-only audit |
| 12 | `src/apps/ShramSafal/ShramSafal.Application/Ports/IShramSafalRepository.cs` | 2,3,7 | Attachment, OCR, audit methods |
| 13 | `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/ShramSafalDbContext.cs` | 2,3,7 | New DbSets |
| 14 | `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Repositories/ShramSafalRepository.cs` | 2,3,7 | Implement new methods |
| 15 | `src/apps/ShramSafal/ShramSafal.Application/Contracts/Dtos/SyncDtos.cs` | 2,4,6 | New DTOs |
| 16 | `src/apps/ShramSafal/ShramSafal.Application/UseCases/Sync/PullSyncChanges/PullSyncChangesHandler.cs` | 2,4,6 | New entities in pull |
| 17 | `src/apps/ShramSafal/ShramSafal.Application/UseCases/Sync/PushSyncBatch/PushSyncBatchHandler.cs` | 2,4,7 | New mutation types, validation |
| 18 | `src/apps/ShramSafal/ShramSafal.Api/DependencyInjection.cs` | 2-7 | Register new handlers |
| 19 | `src/AgriSync.Bootstrapper/appsettings.json` | 2 | Storage config |
| 20 | `src/AgriSync.Bootstrapper/Program.cs` | 2,5 | Storage DI, QuestPDF |
| 21 | `src/AgriSync.Bootstrapper/Infrastructure/DatabaseSeeder.cs` | 6 | Full template data |
| 22 | `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Configurations/DailyLogConfiguration.cs` | 4 | OwnsOne Location |
| 23 | `src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Configurations/CostEntryConfiguration.cs` | 4 | OwnsOne Location |

---

## ESTIMATED SCOPE

| Category | Count |
|---|---|
| New backend files | 34 |
| Modified backend files | 23 |
| New frontend files | 23 |
| Modified frontend files | 9 |
| New API endpoints | 17 |
| Modified API endpoints | 4 |
| EF migrations | 4 (Attachments, OcrResults, LocationSnapshots, AuditEvents) |
| New test files | 5+ |
| New NuGet packages | 1 (QuestPDF) |
| New NPM packages | ~10 (Capacitor core + plugins) |

---

## WHAT THE SYSTEM BECOMES (Post-Plan)

**Client becomes:**
1. Capacitor-wrapped PWA (web + Android from same codebase)
2. Device feature access through abstraction layer (camera, GPS, files, share)
3. Offline-first with local file save (photos never lost)
4. Upload queue with retry (attachments sync when online)
5. Reference data from server, cached in Dexie
6. ZERO hardcoded master data
7. ZERO business logic (all delegated to backend)

**Server becomes:**
1. Single source of truth for ALL business data and rules
2. Serves plan templates, crop reference data, activity categories
3. Processes OCR on receipt images (Gemini Vision)
4. Generates PDF reports on demand
5. Stores attachments immutably with farm/entity linking
6. Captures GPS metadata immutably
7. Full audit trail for every mutation
8. Append-only ledger model (no destructive updates)

**Trust guarantees:**
1. A compromised client cannot forge "who logged" or "who verified"
2. Every change is replayable and auditable
3. Photos and documents are immutable evidence
4. GPS proves location (when consented)
5. Reports are server-generated from canonical data
6. Duplicate commands never create duplicates
7. Offline actions sync cleanly without data loss

**Honest label:** "Hybrid offline-first client with server-authoritative trust ledger, device-native capabilities, and full audit trail."

---

## CLOSING NOTE

This plan picks up where the thin client migration left off. The backend is now authoritative. Now we make the trust ledger real: photos as evidence, GPS as proof, PDFs as shareable reports, and an audit trail that survives any dispute.

The boundary is clear: client owns UI and device capture, server owns truth and integrity. UI can change freely. Integrity rules cannot.

Ship it in order. Test every gate. A farmer's livelihood depends on this system being trustworthy -- and now we have the architecture to prove it.

---
