import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TypeOrmModule } from '@nestjs/typeorm';
import appConfig from '../config/app.config';
import databaseConfig from '../config/database.config';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from '../config/env.validation';
import { Video, VideoStatus } from '../videos/entities/video.entity';
import { Channel } from '../channels/entities/channel.entity';

describe('VideoProcessingProcessor (Integration)', () => {
  let videoRepository: Repository<Video>;
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [appConfig, databaseConfig],
          validationSchema: envValidationSchema,
          validationOptions: { allowUnknown: true, abortEarly: false },
        }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: process.env.DB_HOST || 'db',
          port: parseInt(process.env.DB_PORT || '5432', 10),
          username: process.env.DB_USERNAME || 'streamtube',
          password: process.env.DB_PASSWORD || 'streamtube',
          database: process.env.DB_NAME || 'streamtube',
          autoLoadEntities: true,
          synchronize: false,
        }),
        TypeOrmModule.forFeature([Video, Channel]),
      ],
    }).compile();

    videoRepository = module.get<Repository<Video>>(getRepositoryToken(Video));
  });

  afterAll(async () => {
    await module.close();
  });

  describe('video database operations', () => {
    it('should persist video with updated metadata', async () => {
      const testVideoId = 'test-video-integration-' + Date.now();

      // Create a test video record
      const video = videoRepository.create({
        id: testVideoId,
        channel_id: '00000000-0000-0000-0000-000000000000', // Use a dummy UUID
        public_id: 'tst123-' + Date.now(),
        status: VideoStatus.UPLOADED,
        storage_key: `videos/test-channel-123/${testVideoId}/original`,
      });

      await videoRepository.save(video);

      // Verify the video was created
      let savedVideo = await videoRepository.findOne({
        where: { id: testVideoId },
      });
      expect(savedVideo).toBeDefined();
      expect(savedVideo?.status).toBe(VideoStatus.UPLOADED);
      expect(savedVideo?.duration_seconds).toBeNull();
      expect(savedVideo?.thumbnail_key).toBeNull();

      // Update the video to ready state (simulating successful processor execution)
      await videoRepository.update(testVideoId, {
        status: VideoStatus.READY,
        duration_seconds: 3600,
        thumbnail_key: `videos/test-channel-123/${testVideoId}/thumbnail.jpg`,
      });

      // Verify the update
      savedVideo = await videoRepository.findOne({
        where: { id: testVideoId },
      });
      expect(savedVideo?.status).toBe(VideoStatus.READY);
      expect(savedVideo?.duration_seconds).toBe(3600);
      expect(savedVideo?.thumbnail_key).toBe(
        `videos/test-channel-123/${testVideoId}/thumbnail.jpg`,
      );

      // Cleanup
      await videoRepository.delete({ id: testVideoId });
    });

    it('should persist failure_reason when processing fails', async () => {
      const testVideoId = 'test-video-failed-' + Date.now();

      // Create a test video record
      const video = videoRepository.create({
        id: testVideoId,
        channel_id: '00000000-0000-0000-0000-000000000000', // Use a dummy UUID
        public_id: 'tst123-failed-' + Date.now(),
        status: VideoStatus.UPLOADED,
        storage_key: `videos/test-channel-123/${testVideoId}/original`,
      });

      await videoRepository.save(video);

      // Update the video to failed state (simulating processor failure)
      const failureReason = 'Test failure reason - ffprobe not found';
      await videoRepository.update(testVideoId, {
        status: VideoStatus.FAILED,
        failure_reason: failureReason,
      });

      // Verify the update
      const updatedVideo = await videoRepository.findOne({
        where: { id: testVideoId },
      });
      expect(updatedVideo?.status).toBe(VideoStatus.FAILED);
      expect(updatedVideo?.failure_reason).toBe(failureReason);

      // Cleanup
      await videoRepository.delete({ id: testVideoId });
    });
  });
});
