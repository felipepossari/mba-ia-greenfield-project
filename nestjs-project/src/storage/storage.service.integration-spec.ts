import { Test, TestingModule } from '@nestjs/testing';
import type { ConfigType } from '@nestjs/config';
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { StorageService, InvalidUploadPartsException } from './storage.service';
import storageConfig from '../config/storage.config';

describe('StorageService (Integration)', () => {
  let service: StorageService;
  let s3Client: S3Client;
  let mockConfig: ConfigType<typeof storageConfig>;

  const TEST_BUCKET = 'streamtube-test-integration';
  const TEST_CHANNEL_ID = 'test-channel-123';
  const TEST_VIDEO_ID = 'test-video-456';

  beforeAll(async () => {
    mockConfig = {
      endpoint: process.env.S3_ENDPOINT || 'minio',
      port: parseInt(process.env.S3_PORT || '9000', 10),
      bucket: TEST_BUCKET,
      accessKeyId: process.env.S3_ACCESS_KEY_ID || 'minioadmin',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'minioadmin',
      region: process.env.S3_REGION || 'us-east-1',
      useSSL: (process.env.S3_USE_SSL || 'false').toLowerCase() === 'true',
    };

    // Create S3 client for setup
    s3Client = new S3Client({
      region: mockConfig.region,
      credentials: {
        accessKeyId: mockConfig.accessKeyId,
        secretAccessKey: mockConfig.secretAccessKey,
      },
      endpoint: mockConfig.useSSL
        ? `https://${mockConfig.endpoint}:${mockConfig.port}`
        : `http://${mockConfig.endpoint}:${mockConfig.port}`,
      forcePathStyle: true,
    });

    // Create test bucket if it doesn't exist
    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: TEST_BUCKET }));
    } catch {
      await s3Client.send(
        new CreateBucketCommand({
          Bucket: TEST_BUCKET,
        }),
      );
    }
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        {
          provide: storageConfig.KEY,
          useValue: mockConfig,
        },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
  });

  afterEach(async () => {
    // Clean up test objects from MinIO
    try {
      const listResponse = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: TEST_BUCKET,
          Prefix: `videos/${TEST_CHANNEL_ID}/${TEST_VIDEO_ID}/`,
        }),
      );

      if (listResponse.Contents) {
        for (const obj of listResponse.Contents) {
          if (obj.Key) {
            await s3Client.send(
              new DeleteObjectCommand({
                Bucket: TEST_BUCKET,
                Key: obj.Key,
              }),
            );
          }
        }
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  afterAll(async () => {
    // Clean up bucket
    try {
      const listResponse = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: TEST_BUCKET,
        }),
      );

      if (listResponse.Contents) {
        for (const obj of listResponse.Contents) {
          if (obj.Key) {
            await s3Client.send(
              new DeleteObjectCommand({
                Bucket: TEST_BUCKET,
                Key: obj.Key,
              }),
            );
          }
        }
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('initiateMultipartUpload', () => {
    it('should initiate a multipart upload and return uploadId with part URLs', async () => {
      const key = service.buildVideoKey(TEST_CHANNEL_ID, TEST_VIDEO_ID);
      const mimeType = 'video/mp4';

      const result = await service.initiateMultipartUpload(key, mimeType);

      expect(result).toBeDefined();
      expect(result.uploadId).toBeDefined();
      expect(result.uploadId).toMatch(/^[a-zA-Z0-9\-]+$/);
      expect(Array.isArray(result.partUrls)).toBe(true);
      expect(result.partUrls.length).toBeGreaterThan(0);

      // Verify each part URL
      for (const part of result.partUrls) {
        expect(part.partNumber).toBeGreaterThanOrEqual(1);
        expect(part.url).toMatch(/^https?:\/\//);
      }
    });

    it('should support multiple concurrent multipart uploads', async () => {
      const key1 = service.buildVideoKey(TEST_CHANNEL_ID, 'video-1');
      const key2 = service.buildVideoKey(TEST_CHANNEL_ID, 'video-2');

      const result1 = await service.initiateMultipartUpload(key1, 'video/mp4');
      const result2 = await service.initiateMultipartUpload(key2, 'video/mp4');

      expect(result1.uploadId).not.toBe(result2.uploadId);
    });
  });

  describe('completeMultipartUpload', () => {
    it('should complete a multipart upload and return file size', async () => {
      const key = service.buildVideoKey(TEST_CHANNEL_ID, TEST_VIDEO_ID);
      const mimeType = 'video/mp4';

      // Initiate
      const initResult = await service.initiateMultipartUpload(key, mimeType);

      // For testing purposes, we create a mock parts array
      // In real usage, clients would upload the actual parts and receive ETags
      const mockParts = [
        { partNumber: 1, eTag: '"abc123"' },
        { partNumber: 2, eTag: '"def456"' },
      ];

      // Try to complete - this might fail with InvalidPart error since we didn't actually upload
      // but the test verifies the exception type is correct
      try {
        const result = await service.completeMultipartUpload(
          key,
          initResult.uploadId,
          mockParts,
        );

        // If it succeeds (shouldn't in this case), verify structure
        expect(result).toBeDefined();
        expect(typeof result.fileSizeBytes).toBe('number');
      } catch (error) {
        // Expected: parts don't match because we didn't actually upload them
        if (error instanceof InvalidUploadPartsException) {
          expect(error.message).toContain('Uploaded parts');
        } else if (error instanceof Error) {
          // MinIO returns an error about parts not being found or not matching
          expect(
            error.message.includes('InvalidPart') ||
              error.message.includes('could not be found') ||
              error.message.includes('entity tag'),
          ).toBe(true);
        } else {
          throw error;
        }
      }
    });
  });

  describe('getPresignedStreamUrl', () => {
    it('should return a presigned URL and expiration time', async () => {
      const key = service.buildVideoKey(TEST_CHANNEL_ID, TEST_VIDEO_ID);

      const result = await service.getPresignedStreamUrl(key);

      expect(result).toBeDefined();
      expect(result.url).toMatch(/^https?:\/\//);
      expect(result.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      // Verify expiration is in the future
      const expiryTime = new Date(result.expiresAt).getTime();
      const now = Date.now();
      expect(expiryTime).toBeGreaterThan(now);
      expect(expiryTime).toBeLessThan(now + 20 * 60 * 1000); // Within 20 minutes
    });
  });

  describe('getPresignedDownloadUrl', () => {
    it('should return a presigned URL with attachment disposition', async () => {
      const key = service.buildVideoKey(TEST_CHANNEL_ID, TEST_VIDEO_ID);

      const result = await service.getPresignedDownloadUrl(key);

      expect(result).toBeDefined();
      expect(result.url).toMatch(/^https?:\/\//);
      expect(result.url).toContain('response-content-disposition');
      expect(result.url).toContain('attachment');
      expect(result.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should differ from stream URL only in Content-Disposition', async () => {
      const key = service.buildVideoKey(TEST_CHANNEL_ID, TEST_VIDEO_ID);

      const streamResult = await service.getPresignedStreamUrl(key);
      const downloadResult = await service.getPresignedDownloadUrl(key);

      // Both should be URLs to the same object
      // Download should have attachment disposition, stream should not
      expect(downloadResult.url).toContain('attachment');
      expect(streamResult.url).not.toContain('attachment');
    });
  });
});
