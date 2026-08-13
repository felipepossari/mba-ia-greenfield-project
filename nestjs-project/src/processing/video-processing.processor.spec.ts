import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import fs from 'fs';
import { Video, VideoStatus } from '../videos/entities/video.entity';
import { StorageService } from '../storage/storage.service';
import { FfprobeService, MetadataExtractionError } from './ffprobe.service';
import {
  ThumbnailService,
  ThumbnailGenerationError,
} from './thumbnail.service';
import { VideoProcessingProcessor } from './video-processing.processor';

describe('VideoProcessingProcessor', () => {
  let processor: VideoProcessingProcessor;
  let videoRepository: Repository<Video>;
  let storageService: StorageService;
  let ffprobeService: FfprobeService;
  let thumbnailService: ThumbnailService;

  const mockVideo = {
    id: 'video-123',
    channel_id: 'channel-456',
    public_id: 'pub123',
    status: VideoStatus.UPLOADED,
    storage_key: 'videos/channel-456/video-123/original',
    thumbnail_key: null,
    upload_id: null,
    duration_seconds: null,
    file_size_bytes: null,
    failure_reason: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VideoProcessingProcessor,
        {
          provide: getRepositoryToken(Video),
          useValue: {
            findOne: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: StorageService,
          useValue: {
            downloadFile: jest.fn(),
            uploadFile: jest.fn(),
            buildThumbnailKey: jest.fn(),
          },
        },
        {
          provide: FfprobeService,
          useValue: {
            extractDuration: jest.fn(),
          },
        },
        {
          provide: ThumbnailService,
          useValue: {
            generateThumbnail: jest.fn(),
          },
        },
      ],
    }).compile();

    processor = module.get<VideoProcessingProcessor>(VideoProcessingProcessor);
    videoRepository = module.get<Repository<Video>>(getRepositoryToken(Video));
    storageService = module.get<StorageService>(StorageService);
    ffprobeService = module.get<FfprobeService>(FfprobeService);
    thumbnailService = module.get<ThumbnailService>(ThumbnailService);

    jest
      .spyOn(fs, 'unlink' as any)
      .mockImplementation((path: any, callback: any) => {
        callback(null);
      });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleVideoProcessing', () => {
    it('should mark video as failed when video not found', async () => {
      const jobData = {
        videoId: 'nonexistent',
        storageKey: 'some/key',
        publicId: 'pub123',
      };

      jest.spyOn(videoRepository, 'findOne').mockResolvedValue(null);

      const job = {
        data: jobData,
      } as any;

      await expect(processor.process(job)).rejects.toThrow('Video not found');

      expect(videoRepository.update).toHaveBeenCalledWith('nonexistent', {
        status: VideoStatus.FAILED,
        failure_reason: expect.stringContaining('Video not found'),
      });
    });

    it('should mark video as failed when storage download fails', async () => {
      const jobData = {
        videoId: mockVideo.id,
        storageKey: mockVideo.storage_key,
        publicId: mockVideo.public_id,
      };

      jest
        .spyOn(videoRepository, 'findOne')
        .mockResolvedValue(mockVideo as any);
      const downloadError = new Error('S3 connection failed');
      jest
        .spyOn(storageService, 'downloadFile')
        .mockRejectedValue(downloadError);

      const job = {
        data: jobData,
      } as any;

      await expect(processor.process(job)).rejects.toThrow(
        'S3 connection failed',
      );

      expect(videoRepository.update).toHaveBeenCalledWith(mockVideo.id, {
        status: VideoStatus.FAILED,
        failure_reason: 'S3 connection failed',
      });
    });

    it('should mark video as failed when ffprobe fails', async () => {
      const jobData = {
        videoId: mockVideo.id,
        storageKey: mockVideo.storage_key,
        publicId: mockVideo.public_id,
      };

      jest
        .spyOn(videoRepository, 'findOne')
        .mockResolvedValue(mockVideo as any);
      const extractionError = new MetadataExtractionError('Invalid format');
      jest
        .spyOn(storageService, 'downloadFile')
        .mockRejectedValue(extractionError);

      const job = {
        data: jobData,
      } as any;

      await expect(processor.process(job)).rejects.toThrow(
        MetadataExtractionError,
      );

      expect(videoRepository.update).toHaveBeenCalledWith(mockVideo.id, {
        status: VideoStatus.FAILED,
        failure_reason: 'Invalid format',
      });
    });

    it('should mark video as failed when thumbnail generation fails', async () => {
      const jobData = {
        videoId: mockVideo.id,
        storageKey: mockVideo.storage_key,
        publicId: mockVideo.public_id,
      };

      jest
        .spyOn(videoRepository, 'findOne')
        .mockResolvedValue(mockVideo as any);
      const thumbnailError = new ThumbnailGenerationError('ffmpeg not found');
      jest
        .spyOn(storageService, 'downloadFile')
        .mockRejectedValue(thumbnailError);

      const job = {
        data: jobData,
      } as any;

      await expect(processor.process(job)).rejects.toThrow(
        ThumbnailGenerationError,
      );

      expect(videoRepository.update).toHaveBeenCalledWith(mockVideo.id, {
        status: VideoStatus.FAILED,
        failure_reason: 'ffmpeg not found',
      });
    });
  });
});
