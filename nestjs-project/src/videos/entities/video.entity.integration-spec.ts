import { DataSource } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import { User } from '../../users/entities/user.entity';
import { Video, VideoStatus } from './video.entity';

describe('Video Entity (Integration)', () => {
  let dataSource: DataSource;
  let userRepository = null as any;
  let channelRepository = null as any;
  let videoRepository = null as any;

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

  describe('defaults and constraints', () => {
    it('should create a video with default status DRAFT', async () => {
      const user = await userRepository.save({
        email: 'test@example.com',
        password: 'hashed-password',
      });

      const channel = await channelRepository.save({
        name: 'Test Channel',
        nickname: 'test-channel',
        user_id: user.id,
      });

      const video = await videoRepository.save({
        channel_id: channel.id,
        public_id: 'abc12345',
        storage_key: 's3://bucket/video.mp4',
      });

      expect(video.status).toBe(VideoStatus.DRAFT);
    });

    it('should enforce unique public_id constraint', async () => {
      const user = await userRepository.save({
        email: 'test@example.com',
        password: 'hashed-password',
      });

      const channel = await channelRepository.save({
        name: 'Test Channel',
        nickname: 'test-channel',
        user_id: user.id,
      });

      await videoRepository.save({
        channel_id: channel.id,
        public_id: 'duplicate-id',
        storage_key: 's3://bucket/video1.mp4',
      });

      const duplicateInsert = videoRepository.save({
        channel_id: channel.id,
        public_id: 'duplicate-id',
        storage_key: 's3://bucket/video2.mp4',
      });

      await expect(duplicateInsert).rejects.toThrow();
    });

    it('should allow nullable fields', async () => {
      const user = await userRepository.save({
        email: 'test@example.com',
        password: 'hashed-password',
      });

      const channel = await channelRepository.save({
        name: 'Test Channel',
        nickname: 'test-channel',
        user_id: user.id,
      });

      const video = await videoRepository.save({
        channel_id: channel.id,
        public_id: 'abc12345',
        storage_key: 's3://bucket/video.mp4',
      });

      expect(video.thumbnail_key).toBeNull();
      expect(video.upload_id).toBeNull();
      expect(video.duration_seconds).toBeNull();
      expect(video.file_size_bytes).toBeNull();
      expect(video.failure_reason).toBeNull();
    });

    it('should auto-generate id and timestamps', async () => {
      const user = await userRepository.save({
        email: 'test@example.com',
        password: 'hashed-password',
      });

      const channel = await channelRepository.save({
        name: 'Test Channel',
        nickname: 'test-channel',
        user_id: user.id,
      });

      const beforeCreation = new Date();
      const video = await videoRepository.save({
        channel_id: channel.id,
        public_id: 'abc12345',
        storage_key: 's3://bucket/video.mp4',
      });
      const afterCreation = new Date();

      expect(video.id).toBeDefined();
      expect(video.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

      expect(video.created_at).toBeDefined();
      expect(video.updated_at).toBeDefined();
      expect(video.created_at.getTime()).toBeGreaterThanOrEqual(beforeCreation.getTime());
      expect(video.created_at.getTime()).toBeLessThanOrEqual(afterCreation.getTime());
    });

    it('should maintain foreign key relationship to Channel', async () => {
      const user = await userRepository.save({
        email: 'test@example.com',
        password: 'hashed-password',
      });

      const channel = await channelRepository.save({
        name: 'Test Channel',
        nickname: 'test-channel',
        user_id: user.id,
      });

      await videoRepository.save({
        channel_id: channel.id,
        public_id: 'abc12345',
        storage_key: 's3://bucket/video.mp4',
      });

      const invalidChannelId = '550e8400-e29b-41d4-a716-446655440000';
      const invalidInsert = videoRepository.save({
        channel_id: invalidChannelId,
        public_id: 'xyz99999',
        storage_key: 's3://bucket/video2.mp4',
      });

      await expect(invalidInsert).rejects.toThrow();
    });
  });
});
