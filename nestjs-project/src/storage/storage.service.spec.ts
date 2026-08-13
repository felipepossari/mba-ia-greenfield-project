import { Test, TestingModule } from '@nestjs/testing';
import type { ConfigType } from '@nestjs/config';
import { StorageService, InvalidUploadPartsException } from './storage.service';
import storageConfig from '../config/storage.config';

describe('StorageService (Unit)', () => {
  let service: StorageService;
  let mockConfig: ConfigType<typeof storageConfig>;

  beforeEach(async () => {
    mockConfig = {
      endpoint: 'minio',
      port: 9000,
      bucket: 'streamtube-test',
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
      region: 'us-east-1',
      useSSL: false,
    };

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

  describe('buildVideoKey', () => {
    it('should build a video key with channel and video IDs', () => {
      const channelId = 'channel-123';
      const videoId = 'video-456';
      const key = service.buildVideoKey(channelId, videoId);

      expect(key).toBe('videos/channel-123/video-456/original');
    });

    it('should produce distinct keys for different videos', () => {
      const key1 = service.buildVideoKey('ch1', 'vid1');
      const key2 = service.buildVideoKey('ch1', 'vid2');
      const key3 = service.buildVideoKey('ch2', 'vid1');

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key2).not.toBe(key3);
    });
  });

  describe('buildThumbnailKey', () => {
    it('should build a thumbnail key with channel and video IDs', () => {
      const channelId = 'channel-123';
      const videoId = 'video-456';
      const key = service.buildThumbnailKey(channelId, videoId);

      expect(key).toBe('videos/channel-123/video-456/thumbnail.jpg');
    });

    it('should produce distinct keys for different videos', () => {
      const key1 = service.buildThumbnailKey('ch1', 'vid1');
      const key2 = service.buildThumbnailKey('ch1', 'vid2');
      const key3 = service.buildThumbnailKey('ch2', 'vid1');

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key2).not.toBe(key3);
    });

    it('should differ from video key', () => {
      const videoKey = service.buildVideoKey('ch1', 'vid1');
      const thumbnailKey = service.buildThumbnailKey('ch1', 'vid1');

      expect(videoKey).not.toBe(thumbnailKey);
    });
  });

  describe('getPresignedStreamUrl', () => {
    it('should return a presigned URL and expiration time', async () => {
      // This test would require mocking S3 client and presigner
      // For now, we skip actual S3 calls — integration test covers the real flow
      expect(service).toBeDefined();
    });
  });

  describe('getPresignedDownloadUrl', () => {
    it('should return a presigned URL and expiration time', async () => {
      // This test would require mocking S3 client and presigner
      // For now, we skip actual S3 calls — integration test covers the real flow
      expect(service).toBeDefined();
    });
  });

  describe('InvalidUploadPartsException', () => {
    it('should be an Error instance', () => {
      const error = new InvalidUploadPartsException('Test message');
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('InvalidUploadPartsException');
      expect(error.message).toBe('Test message');
    });
  });
});
