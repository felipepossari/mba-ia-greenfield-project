import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { VideosService } from './videos.service';
import { StorageService } from '../storage/storage.service';
import { Video, VideoStatus } from './entities/video.entity';

describe('VideosService (Unit)', () => {
  let service: VideosService;
  let mockStorageService: jest.Mocked<StorageService>;
  let mockDataSource: jest.Mocked<DataSource>;

  beforeEach(async () => {
    mockStorageService = {
      initiateMultipartUpload: jest.fn().mockResolvedValue({
        uploadId: 'test-upload-id',
        partUrls: [
          { partNumber: 1, url: 'https://s3.example.com/part1' },
          { partNumber: 2, url: 'https://s3.example.com/part2' },
        ],
      }),
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
});
