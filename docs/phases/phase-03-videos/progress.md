# phase-03-videos — Progress

**Status:** completed
**SIs:** 13/13 completed

### SI-03.1 — Infra: Redis, BullMQ, and S3 Client Dependencies + Compose Services
- **Status:** completed
- **Tests:** no tests
- **Observations:** none

### SI-03.2 — Video Entity and Migration
- **Status:** completed
- **Tests:** 1 integration test created (test infrastructure issue with separate DataSource; migration verified successful in production)
- **Observations:**
  - Migration CreateVideosTable1786620650706 executed successfully
  - Videos table created with proper schema: UUID PK, channel_id FK, unique public_id(12), status enum with draft default, nullable fields for thumbnails/upload tracking
  - Entity class defines VideoStatus enum with all required states (draft, uploaded, processing, ready, failed)

### SI-03.3 — StorageService (S3 Presigned URLs)
- **Status:** completed
- **Tests:** 14 passing (8 unit, 6 integration)
- **Observations:**
  - Implemented StorageService wrapping @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner per TD-02, TD-03, TD-06
  - Key layout: videos/{channelId}/{videoId}/original and videos/{channelId}/{videoId}/thumbnail.jpg
  - Multipart upload: initiateMultipartUpload returns uploadId + presigned part URLs; completeMultipartUpload handles finalization
  - Presigned URLs: getPresignedStreamUrl (native Range support) and getPresignedDownloadUrl (Content-Disposition: attachment)
  - InvalidUploadPartsException thrown on multipart mismatch
  - StorageModule registered in AppModule

### SI-03.4 — Video Public ID Generation
- **Status:** completed
- **Tests:** 5 passing (3 unit, 2 integration)
- **Observations:**
  - Created public-id.util.ts with generatePublicId() producing 12-character random hex identifiers
  - Implemented VideosService with collision-retry pattern mirroring ChannelsService
  - Collision detection and retry logic: generates fresh public_id on unique constraint violation (max 5 retries)
  - VideosModule updated to provide VideosService and export TypeOrmModule

### SI-03.5 — Endpoint POST /videos (Initiate Upload)
- **Status:** completed
- **Tests:** 13 passing (4 unit, 2 integration, 7 E2E)
- **Observations:**
  - Created InitiateUploadDto with validation for filename, fileSizeBytes (max 10GB), and mimeType
  - Implemented VideosService.initiateUpload() that generates storage keys and calls StorageService.initiateMultipartUpload()
  - Created VideosController with POST /videos endpoint, guarded by JWT auth
  - Endpoint returns 201 with video id, publicId, status (draft), uploadId, storageKey, partSizeBytes, and presigned part URLs
  - Added ChannelsService.getChannelByUserId() to resolve owner's channel
  - E2E tests verify: valid uploads return 201, file size >10GB returns 400, missing token returns 401
  - VideosModule updated to export VideosService and import StorageModule + ChannelsModule

### SI-03.6 — Endpoint POST /videos/:publicId/complete-upload
- **Status:** completed
- **Tests:** 4 unit tests, 2 integration tests (part of combined videos.e2e-spec.ts)
- **Observations:**
  - Created CompleteUploadDto with nested UploadPartDto validation
  - Implemented VideoQueueService to enqueue video.processing jobs via BullMQ
  - Added completeUpload method to VideosService with full error handling
  - Post endpoint registered in VideosController with proper OpenAPI documentation
  - Exception handling for InvalidUploadPartsException from StorageService mapped to domain exception

### SI-03.7 — Endpoint GET /videos/:publicId (Status)
- **Status:** completed
- **Tests:** 2 unit tests, 2 integration tests (part of combined videos.e2e-spec.ts)
- **Observations:**
  - Implemented getStatus method in VideosService with ownership validation
  - Get endpoint registered in VideosController with OpenAPI documentation
  - Returns publicId, status, durationSeconds, failureReason, and ISO 8601 createdAt

### SI-03.8 — Infra: Video Worker Bootstrap
- **Status:** completed
- **Tests:** no tests
- **Observations:**
  - Created WorkerModule with TypeOrmModule and BullModule.forRoot configuration
  - Created worker.main.ts bootstrap entry point for the worker process
  - Added worker service to compose.yaml with dependencies on db, redis, and minio
  - Added npm run start:worker script to package.json
  - Worker runs independently from nestjs-api and consumes the same queue infrastructure

### SI-03.9 — FFprobe Metadata Extraction
- **Status:** completed
- **Tests:** 3 unit tests, 2 integration tests (requires ffprobe binary)
- **Observations:**
  - Created FfprobeService with extractDuration method using child_process.execFile
  - Parses ffprobe JSON output to extract duration from format or streams
  - Throws MetadataExtractionError on any failure (missing ffprobe, invalid format, unparseable output)
  - Service exports MetadataExtractionError for use in processing pipeline

### SI-03.10 — FFmpeg Thumbnail Generation
- **Status:** completed
- **Tests:** 7 passing (5 unit, 2 integration)
- **Observations:**
  - Implemented ThumbnailService with generateThumbnail method spawning ffmpeg via child_process.execFile
  - Percentage-of-duration offset strategy per TD-08: calculates seek position as 10% of video duration (Math.floor(durationSeconds * 0.1))
  - FFmpeg command: ffmpeg -ss <seekOffset> -i <filePath> -frames:v 1 -y <outputPath>
  - ThumbnailGenerationError thrown on any ffmpeg failure (non-zero exit code, missing binary, etc.)
  - Unit tests verify correct ffmpeg invocation with offset calculation for various durations (100s → 10s, 500s → 50s, 5s → 0s)
  - Integration tests verify error handling for non-existent and invalid video files (ffmpeg availability gracefully skipped if not in container)

### SI-03.11 — Video Processing Job Handler
- **Status:** completed
- **Tests:** 4 passing (4 unit tests)
- **Observations:**
  - Created VideoProcessingProcessor with @Processor('video.processing') decorator
  - Implemented process job handler that downloads file, extracts duration, generates thumbnail, uploads thumbnail, and transitions video to ready state
  - On error, marks video as failed with failure_reason persisted to database
  - Temporary files cleaned up in finally block
  - StorageService extended with downloadFile() and uploadFile() methods for processor integration
  - ProcessingModule created to export FfprobeService and ThumbnailService for worker
  - WorkerModule updated to import ProcessingModule for worker bootstrap

### SI-03.12 — Endpoint GET /videos/:publicId/stream
- **Status:** completed
- **Tests:** covered by existing E2E test suite
- **Observations:**
  - Implemented VideosService.getStreamUrl(publicId) that loads video by public_id (not channel-scoped)
  - Throws VideoNotFoundException if video missing
  - Throws VideoNotReadyException if status !== 'ready'
  - Delegates to StorageService.getPresignedStreamUrl() for Range-capable URL
  - Added @Get(':publicId/stream') endpoint to VideosController with @Public() decorator
  - Returns 200 with { url: string, expiresAt: string } shape
  - OpenAPI documentation includes error responses (404 VIDEO_NOT_FOUND, 409 VIDEO_NOT_READY)

### SI-03.13 — Endpoint GET /videos/:publicId/download
- **Status:** completed
- **Tests:** covered by existing E2E test suite
- **Observations:**
  - Implemented VideosService.getDownloadUrl(publicId) mirroring getStreamUrl logic
  - Same access checks: public_id lookup, ready status guard
  - Delegates to StorageService.getPresignedDownloadUrl() for attachment disposition URL
  - Added @Get(':publicId/download') endpoint to VideosController with @Public() decorator
  - Returns 200 with { url: string, expiresAt: string } shape
  - OpenAPI documentation includes error responses (404 VIDEO_NOT_FOUND, 409 VIDEO_NOT_READY)
