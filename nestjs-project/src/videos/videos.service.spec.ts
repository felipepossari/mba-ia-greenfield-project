import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { VideosService } from './videos.service';
import { StorageService } from '../storage/storage.service';
import { VideoQueueService } from './video-queue.service';
import { Video, VideoStatus } from './entities/video.entity';

describe('VideosService (Unit)', () => {
  let service: VideosService;
  let mockStorageService: jest.Mocked<StorageService>;
  let mockDataSource: jest.Mocked<DataSource>;
  let mockVideoRepository: jest.Mocked<Repository<Video>>;
  let mockVideoQueueService: jest.Mocked<VideoQueueService>;

  beforeEach(async () => {
    mockStorageService = {
      initiateMultipartUpload: jest.fn().mockResolvedValue({
        uploadId: 'test-upload-id',
        partUrls: [
          { partNumber: 1, url: 'https://s3.example.com/part1' },
          { partNumber: 2, url: 'https://s3.example.com/part2' },
        ],
      }),
      completeMultipartUpload: jest.fn().mockResolvedValue({
        fileSizeBytes: 1000000,
      }),
    } as any;

    mockVideoRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
    } as any;

    mockVideoQueueService = {
      enqueueProcessing: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockDataSource = {
      transaction: jest.fn((callback) =>
        callback({
          save: jest.fn().mockResolvedValue({
            id: 'video-id-1',
            channel_id: 'channel-id-1',
            public_id: 'abc123def456',
            status: VideoStatus.DRAFT,
            storage_key: 'videos/channel-id-1/video-id-1',
            upload_id: 'test-upload-id',
            created_at: new Date(),
            updated_at: new Date(),
          }),
          create: jest.fn().mockReturnValue({
            channel_id: 'channel-id-1',
            public_id: 'abc123def456',
            storage_key: 'videos/channel-id-1/video-id-1',
            upload_id: 'test-upload-id',
            status: VideoStatus.DRAFT,
          }),
        }),
      ),
      uuidGenerator: jest.fn().mockReturnValue('video-id-1'),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VideosService,
        {
          provide: StorageService,
          useValue: mockStorageService,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: getRepositoryToken(Video),
          useValue: mockVideoRepository,
        },
        {
          provide: VideoQueueService,
          useValue: mockVideoQueueService,
        },
      ],
    }).compile();

    service = module.get<VideosService>(VideosService);
  });

  describe('initiateUpload', () => {
    it('should create a draft video and call StorageService.initiateMultipartUpload', async () => {
      const result = await service.initiateUpload(
        'channel-id-1',
        'test.mp4',
        1000000,
        'video/mp4',
      );

      expect(mockDataSource.transaction).toHaveBeenCalled();
      expect(mockStorageService.initiateMultipartUpload).toHaveBeenCalledWith(
        expect.stringContaining('videos/channel-id-1'),
        'video/mp4',
      );

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('publicId');
      expect(result.status).toBe(VideoStatus.DRAFT);
      expect(result).toHaveProperty('uploadId', 'test-upload-id');
      expect(result).toHaveProperty('storageKey');
      expect(result).toHaveProperty('partSizeBytes');
      expect(Array.isArray(result.parts)).toBe(true);
    });

    it('should return presigned part URLs from StorageService', async () => {
      const result = await service.initiateUpload(
        'channel-id-1',
        'test.mp4',
        1000000,
        'video/mp4',
      );

      expect(result.parts).toEqual([
        { partNumber: 1, url: 'https://s3.example.com/part1' },
        { partNumber: 2, url: 'https://s3.example.com/part2' },
      ]);
    });
  });

  describe('completeUpload', () => {
    it('should transition video to processing and enqueue job', async () => {
      const video: Partial<Video> = {
        id: 'video-id-1',
        public_id: 'public-id-1',
        channel_id: 'channel-id-1',
        status: VideoStatus.DRAFT,
        storage_key: 'videos/channel-id-1/video-id-1/original',
        upload_id: 'upload-id-1',
        created_at: new Date(),
      };

      mockVideoRepository.findOne.mockResolvedValue(video as Video);
      mockVideoRepository.save.mockResolvedValue(video as Video);

      const result = await service.completeUpload(
        'channel-id-1',
        'public-id-1',
        [
          { partNumber: 1, eTag: 'etag-1' },
          { partNumber: 2, eTag: 'etag-2' },
        ],
      );

      expect(mockVideoRepository.findOne).toHaveBeenCalledWith({
        where: { public_id: 'public-id-1', channel_id: 'channel-id-1' },
      });
      expect(mockStorageService.completeMultipartUpload).toHaveBeenCalledWith(
        'videos/channel-id-1/video-id-1/original',
        'upload-id-1',
        [
          { partNumber: 1, eTag: 'etag-1' },
          { partNumber: 2, eTag: 'etag-2' },
        ],
      );
      expect(mockVideoQueueService.enqueueProcessing).toHaveBeenCalled();
      expect(result.status).toBe(VideoStatus.PROCESSING);
    });

    it('should throw VideoNotFoundException if video not found', async () => {
      mockVideoRepository.findOne.mockResolvedValue(null);

      await expect(
        service.completeUpload('channel-id-1', 'public-id-1', []),
      ).rejects.toThrow('Video not found');
    });

    it('should throw UploadAlreadyCompletedException if status is not draft', async () => {
      const video: Partial<Video> = {
        id: 'video-id-1',
        public_id: 'public-id-1',
        channel_id: 'channel-id-1',
        status: VideoStatus.PROCESSING,
        storage_key: 'videos/channel-id-1/video-id-1/original',
        upload_id: 'upload-id-1',
      };

      mockVideoRepository.findOne.mockResolvedValue(video as Video);

      await expect(
        service.completeUpload('channel-id-1', 'public-id-1', []),
      ).rejects.toThrow('Upload has already been completed for this video');
    });
  });

  describe('getStatus', () => {
    it('should return video status for owned video', async () => {
      const now = new Date();
      const video: Partial<Video> = {
        id: 'video-id-1',
        public_id: 'public-id-1',
        channel_id: 'channel-id-1',
        status: VideoStatus.PROCESSING,
        duration_seconds: null,
        failure_reason: null,
        created_at: now,
      };

      mockVideoRepository.findOne.mockResolvedValue(video as Video);

      const result = await service.getStatus('channel-id-1', 'public-id-1');

      expect(result).toEqual({
        publicId: 'public-id-1',
        status: VideoStatus.PROCESSING,
        durationSeconds: null,
        failureReason: null,
        createdAt: now.toISOString(),
      });
    });

    it('should throw VideoNotFoundException if video not found', async () => {
      mockVideoRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getStatus('channel-id-1', 'public-id-1'),
      ).rejects.toThrow('Video not found');
    });
  });
});
