# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 5/13 completed

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
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.7 — Endpoint GET /videos/:publicId (Status)
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.8 — Infra: Video Worker Bootstrap
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.9 — FFprobe Metadata Extraction
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.10 — FFmpeg Thumbnail Generation
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.11 — Video Processing Job Handler
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.12 — Endpoint GET /videos/:publicId/stream
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-03.13 — Endpoint GET /videos/:publicId/download
- **Status:** pending
- **Tests:** pending
- **Observations:** none
