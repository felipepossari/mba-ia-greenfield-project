---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-08-12T18:48:48-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-08-12T18:41:30-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-08-06T08:05:15-03:00"
  docs/decisions/technical-decisions-next-frontend-config-base.md: "2026-08-06T08:05:15-03:00"
  docs/decisions/technical-decisions-next-frontend-msw-foundation.md: "2026-08-06T08:05:15-03:00"
  docs/decisions/technical-decisions-next-frontend-openapi-typing.md: "2026-08-06T08:05:15-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Deliver the video ingestion and processing backbone — resumable multipart upload of files up to 10GB, automatic draft pre-registration, background metadata extraction and thumbnail generation via a dedicated FFmpeg worker, unique public video URLs, and streaming/download delivery — establishing the storage and processing foundation that video management and playback phases build on.

---

## Step Implementations

### SI-03.1 — Infra: Redis, BullMQ, and S3 Client Dependencies + Compose Services

**Description:** Install queue and object-storage client dependencies, add Redis and MinIO services to Docker Compose, and register the BullMQ root module.

**Technical actions:**

1. Add `bullmq` and `ioredis` as production dependencies (per `phase-03-videos/TD-01`)
2. Add `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` as production dependencies (per `phase-03-videos/TD-02`, `phase-03-videos/TD-03`, `phase-03-videos/TD-06`)
3. Add `redis` and `minio` services to `docker-compose.yml`, matching the architecture diagram's Message Queue and Object Storage containers
4. Create `src/config/queue.config.ts` and `src/config/storage.config.ts` — `registerAs` factories reading `REDIS_HOST`, `REDIS_PORT`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`
5. Register `BullModule.forRootAsync` in `AppModule`, `inject: [queueConfig.KEY]`

**Tests:** _(empty — Infra)_

**Dependencies:** none

**Acceptance criteria:**

- `docker compose ps` shows `redis` and `minio` with status `running`
- Application starts without errors with the new environment variables provided — existing E2E smoke test still passes
- Starting the application without `S3_BUCKET` causes a Joi validation error at bootstrap — the app does not start

---

### SI-03.2 — Video Entity and Migration

**Description:** Create the `Video` entity and its migration per the Data Model, establishing the many-to-one relation to `Channel`.

**Technical actions:**

1. Create `src/videos/entities/video.entity.ts` — `Video` entity with columns `id`, `channel_id`, `public_id`, `status`, `storage_key`, `thumbnail_key`, `upload_id`, `duration_seconds`, `file_size_bytes`, `failure_reason`, `created_at`, `updated_at` per `### Data Model → Video`
2. Generate and commit the TypeORM migration for the `videos` table, including the unique index on `public_id` and the FK on `channel_id`
3. Register `Video` in `TypeOrmModule.forFeature([Video])` inside a new `VideosModule`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` | Integration: constraints, defaults, unique `public_id` | `src/videos/entities/video.entity.integration-spec.ts` |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- Running migrations creates the `videos` table with a unique constraint on `public_id` and a foreign key on `channel_id` referencing `channels.id`
- Persisting two `Video` rows with the same `public_id` violates the unique constraint

---

### SI-03.3 — StorageService (S3 Presigned URLs)

**Description:** Implement the `StorageService` wrapping `@aws-sdk/client-s3`/`s3-request-presigner` to initiate/complete multipart uploads and to presign GET URLs for streaming and download, per the object key layout decided in `phase-03-videos/TD-03`.

**Technical actions:**

1. Create `src/storage/storage.service.ts` — `StorageService` injecting the configured `S3Client`. Implement `buildVideoKey(channelId, videoId)` / `buildThumbnailKey(channelId, videoId)` per `phase-03-videos/TD-03`'s hierarchical key layout
2. Implement `initiateMultipartUpload(key, mimeType): Promise<{ uploadId, partUrls }>` — calls `CreateMultipartUploadCommand`, then presigns one `UploadPartCommand` URL per part (per `phase-03-videos/TD-02`)
3. Implement `completeMultipartUpload(key, uploadId, parts): Promise<{ fileSizeBytes }>` — calls `CompleteMultipartUploadCommand`, throws `InvalidUploadPartsException` when S3 rejects mismatched parts
4. Implement `getPresignedStreamUrl(key): Promise<{ url, expiresAt }>` and `getPresignedDownloadUrl(key): Promise<{ url, expiresAt }>` — same `GetObjectCommand` presign, differing only by the `ResponseContentDisposition` parameter (per `phase-03-videos/TD-06`)
5. Register `StorageModule` exporting `StorageService`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Unit: key layout, presign parameterization (mock S3 client) | `src/storage/storage.service.spec.ts` |
| `StorageService` | Integration: multipart lifecycle against MinIO | `src/storage/storage.service.integration-spec.ts` |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- `buildVideoKey` and `buildThumbnailKey` produce distinct, channel/video-scoped keys that never collide across videos
- `getPresignedStreamUrl` and `getPresignedDownloadUrl` for the same key differ only in `Content-Disposition`
- `completeMultipartUpload` with parts that don't match what MinIO recorded for the upload throws `InvalidUploadPartsException`

---

### SI-03.4 — Video Public ID Generation

**Description:** Implement public-identifier generation for `Video`, reusing the collision-retry pattern already validated by `ChannelsService`'s nickname generation (per `phase-03-videos/TD-05`).

**Technical actions:**

1. Create `src/videos/public-id.util.ts` — export `generatePublicId(): string`, producing a random unpredictable short identifier
2. In `VideosService`, on video creation, generate a `public_id` and retry with a fresh value on unique constraint violation, mirroring `ChannelsService`'s nickname collision retry

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `public-id.util` | Unit: format, unpredictability, length | `src/videos/public-id.util.spec.ts` |
| `VideosService` | Integration: collision retry persists with a fresh `public_id` | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.2

**Acceptance criteria:**

- `generatePublicId` produces identifiers matching the short, unpredictable format decided in `phase-03-videos/TD-05`
- Creating a video whose generated `public_id` collides with an existing row retries and persists with a different `public_id`

---

### SI-03.5 — Endpoint POST /videos (Initiate Upload)

**Route:** POST /videos
**Test Specs:** see `nestjs-project/specs/videos.plan.md`
**Authorization:** Authenticated + Owner (channel owner)

**Description:** Implement the endpoint that pre-registers a video as a draft and initiates the S3 multipart upload, returning presigned part URLs for the client to upload directly to storage (per `phase-03-videos/TD-02`, `phase-03-videos/TD-07`).

**Technical actions:**

1. Create `src/videos/dto/initiate-upload.dto.ts` — `InitiateUploadDto` per `### API Contracts → POST /videos → Validation Rules`
2. Implement `VideosService.initiateUpload(channelId, dto)` — creates a `Video` row with `status = 'draft'` (per `phase-03-videos/TD-07`), calls `StorageService.initiateMultipartUpload`, persists `storage_key` and `upload_id`
3. Create `src/videos/videos.controller.ts` — `VideosController` with route prefix `'videos'`. Implement `@Post()` guarded by the JWT access guard, resolving the caller's channel, calling `videosService.initiateUpload()`, returning 201 with the shape in `### API Contracts → POST /videos`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` | Unit: creates draft, delegates to StorageService | `src/videos/videos.service.spec.ts` |
| `VideosService` | Integration: persists draft `Video` with `storage_key`/`upload_id` | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.3, SI-03.4

**Acceptance criteria:**

- `POST /videos` with a valid body and a valid access token returns 201 with `id`, `publicId`, `status: "draft"`, `uploadId`, `storageKey`, and presigned `parts`
- `POST /videos` with `fileSizeBytes` exceeding 10GB returns 400 with `errorCode: "VALIDATION_ERROR"`
- `POST /videos` without an access token returns 401

---

### SI-03.6 — Endpoint POST /videos/:publicId/complete-upload

**Route:** POST /videos/:publicId/complete-upload
**Test Specs:** see `nestjs-project/specs/videos.plan.md`
**Authorization:** Authenticated + Owner

**Description:** Implement the endpoint that completes the S3 multipart upload and transitions the video into `'processing'`, enqueuing the background processing job (per `phase-03-videos/TD-02`, `phase-03-videos/TD-01`, `phase-03-videos/TD-07`).

**Technical actions:**

1. Create `src/videos/dto/complete-upload.dto.ts` — `CompleteUploadDto` per `### API Contracts → POST /videos/:publicId/complete-upload`
2. Implement `VideosService.completeUpload(channelId, publicId, dto)` — loads the owned `Video` by `public_id` (throws `VideoNotFoundException` if missing or not owned), throws `UploadAlreadyCompletedException` if `status !== 'draft'`, calls `StorageService.completeMultipartUpload`, persists `status = 'processing'`, `file_size_bytes`, clears `upload_id`
3. Implement `VideoQueueService.enqueueProcessing(video)` — publishes the `video.processing` job per `### Events/Messages → video.processing`
4. Add `@Post(':publicId/complete-upload')` to `VideosController`, guarded by the JWT access guard + ownership check, returning 200 with `{ publicId, status }`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` | Unit: status guard, delegates to StorageService and VideoQueueService | `src/videos/videos.service.spec.ts` |
| `VideosService` | Integration: persists `status = 'processing'`, enqueues job | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.5

**Acceptance criteria:**

- `POST /videos/:publicId/complete-upload` with matching parts transitions the video to `status: "processing"` and returns 200
- `POST /videos/:publicId/complete-upload` on an already-completed video returns 409 with `errorCode: "UPLOAD_ALREADY_COMPLETED"`
- `POST /videos/:publicId/complete-upload` on a `publicId` the caller doesn't own returns 404 with `errorCode: "VIDEO_NOT_FOUND"`
- Completing an upload enqueues exactly one `video.processing` job carrying `videoId`, `storageKey`, and `publicId`

---

### SI-03.7 — Endpoint GET /videos/:publicId (Status)

**Route:** GET /videos/:publicId
**Test Specs:** see `nestjs-project/specs/videos.plan.md`
**Authorization:** Authenticated + Owner

**Description:** Implement the owner-facing status endpoint used to poll upload/processing progress (per `phase-03-videos/TD-07`).

**Technical actions:**

1. Implement `VideosService.getStatus(channelId, publicId)` — loads the owned `Video`, throws `VideoNotFoundException` if missing or not owned
2. Add `@Get(':publicId')` to `VideosController`, guarded by the JWT access guard + ownership check, returning 200 with the shape in `### API Contracts → GET /videos/:publicId`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` | Unit: ownership guard | `src/videos/videos.service.spec.ts` |

**Dependencies:** SI-03.5

**Acceptance criteria:**

- `GET /videos/:publicId` for an owned video returns 200 with `publicId`, `status`, `durationSeconds`, `failureReason`, `createdAt`
- `GET /videos/:publicId` for a `publicId` the caller doesn't own returns 404 with `errorCode: "VIDEO_NOT_FOUND"`

---

### SI-03.8 — Infra: Video Worker Bootstrap

**Description:** Stand up the dedicated video-processing worker as a separate deployable per the architecture diagram's Video Worker container, consuming the queue registered in `phase-03-videos/TD-01`.

**Technical actions:**

1. Create `src/worker/worker.module.ts` and `src/worker.main.ts` — a separate NestJS application bootstrap (no HTTP listener) for the worker process, registering `BullModule.forRootAsync` + `VideosModule`
2. Add a `worker` service to `docker-compose.yml` running `src/worker.main.ts`, sharing the `redis` and `minio` services with `nestjs-api`
3. Add an `npm run start:worker` script

**Tests:** _(empty — Infra)_

**Dependencies:** SI-03.1

**Acceptance criteria:**

- `docker compose ps` shows the `worker` service with status `running`, independent from `nestjs-api`
- Stopping `nestjs-api` does not stop the `worker` service, and vice versa

---

### SI-03.9 — FFprobe Metadata Extraction

**Description:** Extract video duration via `ffprobe` using direct `child_process` calls, per `phase-03-videos/TD-04`'s decision to avoid `fluent-ffmpeg`.

**Technical actions:**

1. Create `src/processing/ffprobe.service.ts` — `FfprobeService.extractDuration(filePath): Promise<number>` — spawns `ffprobe` via `child_process.execFile`, parses the duration from its JSON output
2. Handle non-zero exit codes and unparseable output by throwing a typed `MetadataExtractionError`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `FfprobeService` | Unit: parses well-formed ffprobe output, throws on malformed/failed output (mock `child_process`) | `src/processing/ffprobe.service.spec.ts` |
| `FfprobeService` | Integration: extracts duration from a real fixture video via `ffprobe` in the worker container | `src/processing/ffprobe.service.integration-spec.ts` |

**Dependencies:** SI-03.8

**Acceptance criteria:**

- `extractDuration` on a valid video fixture returns its duration in seconds
- `extractDuration` on a corrupt/unsupported file throws `MetadataExtractionError`

---

### SI-03.10 — FFmpeg Thumbnail Generation

**Description:** Generate a single offset-based thumbnail frame via direct `ffmpeg` `child_process` calls, per `phase-03-videos/TD-08`'s fixed-offset strategy.

**Technical actions:**

1. Create `src/processing/thumbnail.service.ts` — `ThumbnailService.generateThumbnail(filePath, outputPath): Promise<void>` — spawns `ffmpeg` via `child_process.execFile` with a single seek + one-frame extraction at a fixed offset (per `phase-03-videos/TD-08`)
2. Handle non-zero exit codes by throwing a typed `ThumbnailGenerationError`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `ThumbnailService` | Unit: invokes `ffmpeg` with the expected offset arguments (mock `child_process`) | `src/processing/thumbnail.service.spec.ts` |
| `ThumbnailService` | Integration: produces a JPEG file from a real fixture video | `src/processing/thumbnail.service.integration-spec.ts` |

**Dependencies:** SI-03.8

**Acceptance criteria:**

- `generateThumbnail` on a valid video fixture produces a single image file at `outputPath`
- `generateThumbnail` on a corrupt/unsupported file throws `ThumbnailGenerationError`

---

### SI-03.11 — Video Processing Job Handler

**Description:** Orchestrate the `video.processing` job — downloads the uploaded file, extracts metadata and thumbnail, uploads the thumbnail to storage, and transitions the video to `'ready'` or `'failed'` (per `phase-03-videos/TD-04`, `phase-03-videos/TD-07`).

**Technical actions:**

1. Create `src/processing/video-processing.processor.ts` — a BullMQ `Processor` for the `video.processing` job, injecting `FfprobeService`, `ThumbnailService`, `StorageService`, and `Repository<Video>`
2. Implement the job handler: stream the object at `storageKey` to a temp file, call `FfprobeService.extractDuration`, call `ThumbnailService.generateThumbnail`, upload the thumbnail via `StorageService` to `buildThumbnailKey`, persist `duration_seconds`, `thumbnail_key`, `status = 'ready'`
3. On any step throwing, persist `status = 'failed'` and `failure_reason` with the error message (per `phase-03-videos/TD-07`); rely on BullMQ's retry/backoff for transient failures (per `phase-03-videos/TD-01`) before the job is marked failed
4. Clean up the temp file in a `finally` block

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingProcessor` | Unit: happy path transitions to `'ready'`; each extraction failure transitions to `'failed'` with a reason (mock collaborators) | `src/processing/video-processing.processor.spec.ts` |
| `VideoProcessingProcessor` | Integration: end-to-end job run against MinIO + a real fixture video updates the `Video` row | `src/processing/video-processing.processor.integration-spec.ts` |

**Dependencies:** SI-03.6, SI-03.9, SI-03.10

**Acceptance criteria:**

- Processing a `video.processing` job for a valid uploaded file transitions the video to `status: "ready"` with `durationSeconds` and a `thumbnail_key` populated
- Processing a job for a corrupt/unsupported file transitions the video to `status: "failed"` with `failureReason` populated
- The temp file downloaded for processing is removed after the job completes, whether it succeeds or fails

---

### SI-03.12 — Endpoint GET /videos/:publicId/stream

**Route:** GET /videos/:publicId/stream
**Test Specs:** see `nestjs-project/specs/videos.plan.md`
**Authorization:** Anonymous

**Description:** Implement the public streaming endpoint returning a presigned, Range-capable storage URL, per `phase-03-videos/TD-06`.

**Technical actions:**

1. Implement `VideosService.getStreamUrl(publicId)` — loads the `Video` by `public_id`, throws `VideoNotFoundException` if missing, throws `VideoNotReadyException` if `status !== 'ready'`, delegates to `StorageService.getPresignedStreamUrl`
2. Add `@Get(':publicId/stream')` to `VideosController` (no auth guard), returning 200 with the shape in `### API Contracts → GET /videos/:publicId/stream`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` | Unit: readiness guard, delegates to StorageService | `src/videos/videos.service.spec.ts` |

**Dependencies:** SI-03.11

**Acceptance criteria:**

- `GET /videos/:publicId/stream` for a ready video returns 200 with a presigned `url` and `expiresAt`, with no `Authorization` header required
- `GET /videos/:publicId/stream` for a video whose `status` is not `'ready'` returns 409 with `errorCode: "VIDEO_NOT_READY"`
- `GET /videos/:publicId/stream` for an unknown `publicId` returns 404 with `errorCode: "VIDEO_NOT_FOUND"`

---

### SI-03.13 — Endpoint GET /videos/:publicId/download

**Route:** GET /videos/:publicId/download
**Test Specs:** see `nestjs-project/specs/videos.plan.md`
**Authorization:** Anonymous

**Description:** Implement the public download endpoint returning a presigned storage URL with `Content-Disposition: attachment`, per `phase-03-videos/TD-06`.

**Technical actions:**

1. Implement `VideosService.getDownloadUrl(publicId)` — mirrors `getStreamUrl`, delegating to `StorageService.getPresignedDownloadUrl`
2. Add `@Get(':publicId/download')` to `VideosController` (no auth guard), returning 200 with the shape in `### API Contracts → GET /videos/:publicId/download`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` | Unit: readiness guard, delegates to StorageService | `src/videos/videos.service.spec.ts` |

**Dependencies:** SI-03.11

**Acceptance criteria:**

- `GET /videos/:publicId/download` for a ready video returns 200 with a presigned `url` carrying `Content-Disposition: attachment` and `expiresAt`
- `GET /videos/:publicId/download` for a video whose `status` is not `'ready'` returns 409 with `errorCode: "VIDEO_NOT_READY"`
- `GET /videos/:publicId/download` for an unknown `publicId` returns 404 with `errorCode: "VIDEO_NOT_FOUND"`

---

## Technical Specifications

### Data Model

#### Video

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK, generated | |
| channel_id | uuid | FK → channels.id, not null | Owning channel |
| public_id | varchar(12) | unique, not null | Short public identifier; reuses `ChannelsService`'s nickname-generation pattern (per `phase-03-videos/TD-05`) |
| status | enum | not null, default `'draft'`, values: `'draft'`, `'uploaded'`, `'processing'`, `'ready'`, `'failed'` | Lifecycle (per `phase-03-videos/TD-07`) |
| storage_key | varchar | not null | Object key of the original video file (per `phase-03-videos/TD-03`) |
| thumbnail_key | varchar | nullable | Object key of the generated thumbnail; set once processing succeeds (per `phase-03-videos/TD-03`, `phase-03-videos/TD-08`) |
| upload_id | varchar | nullable | S3 multipart upload id; cleared once upload completes (per `phase-03-videos/TD-02`) |
| duration_seconds | integer | nullable | Extracted via ffprobe; set once processing succeeds (per `phase-03-videos/TD-04`) |
| file_size_bytes | bigint | nullable | Set from the completed multipart upload |
| failure_reason | varchar | nullable | Set when status = `'failed'` (per `phase-03-videos/TD-07`) |
| created_at | timestamp | not null, auto-generated | `@CreateDateColumn` |
| updated_at | timestamp | not null, auto-generated | `@UpdateDateColumn` |

**Relations:** Video → Channel (many-to-one)
**Indexes:** `(public_id)` — unique, `(channel_id)` — FK

### API Contracts

#### POST /videos (SI-03.5)

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer <access_token>

**Request body:**
- filename: string, required
- fileSizeBytes: number, required — max 10GB (per `phase-03-videos/TD-02`)
- mimeType: string, required

**Response 201:**
- id: string (uuid)
- publicId: string
- status: string (`"draft"`)
- uploadId: string
- storageKey: string
- partSizeBytes: number
- parts: array of `{ partNumber: number, url: string }` — presigned S3 upload-part URLs (per `phase-03-videos/TD-02`)

**Error responses:**
- 400 validation error: when the request body fails schema validation or `fileSizeBytes` exceeds the 10GB limit

---

#### POST /videos/:publicId/complete-upload (SI-03.6)

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer <access_token>

**Request body:**
- parts: array of `{ partNumber: number, eTag: string }`, required — one entry per uploaded part (per `phase-03-videos/TD-02`)

**Response 200:**
- publicId: string
- status: string (`"processing"`)

**Error responses:**
- 404 VIDEO_NOT_FOUND: when `publicId` doesn't exist or the caller does not own the video
- 409 UPLOAD_ALREADY_COMPLETED: when the video's status is already past `'draft'`
- 400 INVALID_UPLOAD_PARTS: when the submitted parts don't match what the storage provider recorded for the multipart upload
- 400 validation error: when the request body fails schema validation

---

#### GET /videos/:publicId (SI-03.7)

**Request headers:**
- Authorization: Bearer <access_token>

**Response 200:**
- publicId: string
- status: string (`"draft"` | `"uploaded"` | `"processing"` | `"ready"` | `"failed"`)
- durationSeconds: number, nullable
- failureReason: string, nullable
- createdAt: string (ISO 8601)

**Error responses:**
- 404 VIDEO_NOT_FOUND: when `publicId` doesn't exist or the caller does not own the video

---

#### GET /videos/:publicId/stream (SI-03.12)

**Response 200:**
- url: string — presigned storage URL supporting HTTP Range requests (per `phase-03-videos/TD-06`)
- expiresAt: string (ISO 8601)

**Error responses:**
- 404 VIDEO_NOT_FOUND: when `publicId` doesn't exist
- 409 VIDEO_NOT_READY: when the video's status is not `'ready'`

---

#### GET /videos/:publicId/download (SI-03.13)

**Response 200:**
- url: string — presigned storage URL with `Content-Disposition: attachment` (per `phase-03-videos/TD-06`)
- expiresAt: string (ISO 8601)

**Error responses:**
- 404 VIDEO_NOT_FOUND: when `publicId` doesn't exist
- 409 VIDEO_NOT_READY: when the video's status is not `'ready'`

#### Validation Rules — Video Upload

| Field | Rule | Error message |
|-------|------|----------------|
| filename | required, non-empty | filename should not be empty |
| fileSizeBytes | required, max 10737418240 (10GB) | fileSizeBytes must not exceed 10GB |
| mimeType | required, non-empty | mimeType should not be empty |

### Authorization Matrix

| Endpoint | Anonymous | Authenticated | Owner |
|----------|-----------|----------------|-------|
| POST /videos | ✗ | ✓ | ✓ |
| POST /videos/:publicId/complete-upload | ✗ | ✗ | ✓ |
| GET /videos/:publicId | ✗ | ✗ | ✓ |
| GET /videos/:publicId/stream | ✓ | ✓ | ✓ |
| GET /videos/:publicId/download | ✓ | ✓ | ✓ |

### Error Catalog

**Error response format:** (inherited from Phase 02, per `phase-02-auth/TD-07`)
```
{ statusCode: number, error: string, message: string }
```
The `error` field carries the domain error code from the catalog below. For validation errors, `error` is `"VALIDATION_ERROR"` and `message` is an array of field-level error strings.

| Code | HTTP | Message | Trigger |
|------|------|---------|---------|
| VIDEO_NOT_FOUND | 404 | Video not found | GET/POST on a `publicId` that doesn't exist, or that exists but the caller does not own it (owner-scoped endpoints return 404 rather than 403 to avoid leaking existence) |
| VIDEO_NOT_READY | 409 | Video is not ready for playback | GET /videos/:publicId/stream or /download when status is not `'ready'` |
| UPLOAD_ALREADY_COMPLETED | 409 | Upload has already been completed for this video | POST /videos/:publicId/complete-upload when status is already past `'draft'` |
| INVALID_UPLOAD_PARTS | 400 | Uploaded parts do not match the storage provider's record | POST /videos/:publicId/complete-upload with parts that don't match what the storage provider recorded for the upload |

### Events/Messages

#### video.processing

**Payload:**

```json
{ "videoId": "uuid", "storageKey": "string", "publicId": "string" }
```

**Producer:** `VideosService` (per `phase-03-videos/TD-02`)
**Consumer:** `VideoProcessingWorker` (per `phase-03-videos/TD-04`)
**Trigger:** fires when `POST /videos/:publicId/complete-upload` successfully completes the S3 multipart upload
**Delivery semantics:** at-least-once, with retry/backoff (per `phase-03-videos/TD-01`)

---

## Dependency Map

```
SI-03.1 (root) — Infra: Redis, BullMQ, S3 client + Compose services
├── SI-03.2 — depends on SI-03.1 (Video entity needs config/migration infra)
│   └── SI-03.4 — depends on SI-03.2 (public-id generation needs the Video entity)
├── SI-03.3 — depends on SI-03.1 (StorageService needs the S3 client config)
│   └── SI-03.5 — depends on SI-03.3 + SI-03.4 (initiate-upload endpoint needs StorageService and public-id generation)
│       ├── SI-03.6 — depends on SI-03.5 (complete-upload needs the initiate-upload flow)
│       │   └── SI-03.11 — depends on SI-03.6 + SI-03.9 + SI-03.10 (processing job needs the enqueue trigger + extraction services)
│       │       ├── SI-03.12 — depends on SI-03.11 (stream endpoint needs a processed/ready video)
│       │       └── SI-03.13 — depends on SI-03.11 (download endpoint needs a processed/ready video)
│       └── SI-03.7 — depends on SI-03.5 (status endpoint needs the initiate-upload flow)
└── SI-03.8 — depends on SI-03.1 (worker bootstrap needs queue infra)
    ├── SI-03.9 — depends on SI-03.8 (ffprobe runs inside the worker)
    └── SI-03.10 — depends on SI-03.8 (ffmpeg runs inside the worker)
```

---

## Deliverables

- [ ] SI-03.1 — Infra: Redis, BullMQ, and S3 Client Dependencies + Compose Services
- [ ] SI-03.2 — Video Entity and Migration
- [ ] SI-03.3 — StorageService (S3 Presigned URLs)
- [ ] SI-03.4 — Video Public ID Generation
- [ ] SI-03.5 — Endpoint POST /videos (Initiate Upload)
- [ ] SI-03.6 — Endpoint POST /videos/:publicId/complete-upload
- [ ] SI-03.7 — Endpoint GET /videos/:publicId (Status)
- [ ] SI-03.8 — Infra: Video Worker Bootstrap
- [ ] SI-03.9 — FFprobe Metadata Extraction
- [ ] SI-03.10 — FFmpeg Thumbnail Generation
- [ ] SI-03.11 — Video Processing Job Handler
- [ ] SI-03.12 — Endpoint GET /videos/:publicId/stream
- [ ] SI-03.13 — Endpoint GET /videos/:publicId/download

**Full test suites:**

- [ ] Backend tests pass (`cd nestjs-project && docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass (`cd nestjs-project && docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type/compilation checks pass (`cd nestjs-project && docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Project builds successfully (`cd nestjs-project && docker compose exec nestjs-api npm run build`)
