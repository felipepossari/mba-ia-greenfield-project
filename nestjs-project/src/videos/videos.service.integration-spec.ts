import { DataSource } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { User } from '../users/entities/user.entity';
import { Video, VideoStatus } from './entities/video.entity';
import { VideosService } from './videos.service';

describe('VideosService (Integration)', () => {
  let dataSource: DataSource;
  let service: VideosService;
  let userRepository = null as any;
  let channelRepository = null as any;
  let videoRepository = null as any;
  const storageServiceMock = {
    initiateMultipartUpload: jest.fn().mockResolvedValue({
      uploadId: 'test-upload-id',
      partUrls: [
        { partNumber: 1, url: 'https://s3.example.com/part1' },
      ],
    }),
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'db',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME || 'streamtube',
      password: process.env.DB_PASSWORD || 'streamtube',
      database: process.env.DB_NAME || 'streamtube',
      entities: [User, Channel, Video],
      synchronize: false,
    });

    await dataSource.initialize();
    service = new VideosService(dataSource, storageServiceMock as any);
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM videos');
    await dataSource.query('DELETE FROM channels');
    await dataSource.query('DELETE FROM users');
  });

  describe('createVideo', () => {
    it('should create a video with generated public_id', async () => {
      const user = await userRepository.save({
        email: 'test@example.com',
        password: 'hashed-password',
      });

      const channel = await channelRepository.save({
        name: 'Test Channel',
        nickname: 'test-channel',
        user_id: user.id,
      });

      const video = await service.createVideo({
        channelId: channel.id,
        storageKey: 's3://bucket/video.mp4',
        uploadId: 'upload-123',
      });

      expect(video.id).toBeDefined();
      expect(video.public_id).toMatch(/^[a-f0-9]{12}$/);
      expect(video.channel_id).toBe(channel.id);
      expect(video.storage_key).toBe('s3://bucket/video.mp4');
      expect(video.upload_id).toBe('upload-123');
      expect(video.status).toBe(VideoStatus.DRAFT);
    });

    it('should retry on public_id collision and use a different id', async () => {
      const user = await userRepository.save({
        email: 'test@example.com',
        password: 'hashed-password',
      });

      const channel = await channelRepository.save({
        name: 'Test Channel',
        nickname: 'test-channel',
        user_id: user.id,
      });

      const video1 = await service.createVideo({
        channelId: channel.id,
        storageKey: 's3://bucket/video1.mp4',
        uploadId: 'upload-1',
      });

      const video2 = await service.createVideo({
        channelId: channel.id,
        storageKey: 's3://bucket/video2.mp4',
        uploadId: 'upload-2',
      });

      expect(video1.public_id).not.toBe(video2.public_id);
      expect(video1.id).not.toBe(video2.id);

      const savedVideos = await videoRepository.find();
      expect(savedVideos).toHaveLength(2);
    });
  });

  describe('initiateUpload', () => {
    it('should persist draft video with storage_key and upload_id', async () => {
      const user = await userRepository.save({
        email: 'test@example.com',
        password: 'hashed-password',
      });

      const channel = await channelRepository.save({
        name: 'Test Channel',
        nickname: 'test-channel',
        user_id: user.id,
      });

      const result = await service.initiateUpload(
        channel.id,
        'test.mp4',
        1000000,
        'video/mp4',
      );

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('publicId');
      expect(result.status).toBe(VideoStatus.DRAFT);
      expect(result).toHaveProperty('uploadId');
      expect(result).toHaveProperty('storageKey');
      expect(result).toHaveProperty('parts');

      const savedVideo = await videoRepository.findOne({
        where: { id: result.id },
      });
      expect(savedVideo).toBeDefined();
      expect(savedVideo?.status).toBe(VideoStatus.DRAFT);
      expect(savedVideo?.storage_key).toBe(result.storageKey);
      expect(savedVideo?.upload_id).toBe(result.uploadId);
    });
  });
});
