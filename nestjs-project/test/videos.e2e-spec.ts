import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { Channel } from '../src/channels/entities/channel.entity';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';

describe('Videos Endpoints (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let channelRepository = null as any;
  let videoRepository = null as any;

  let testChannel: Channel;
  let accessToken: string;
  const testEmail = 'test@example.com';
  const testPassword = 'Test@123456';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await app.close();
  });

  async function captureConfirmationToken(email: string): Promise<string> {
    const authService = app.get(AuthService);
    const mailServiceInstance = (authService as any).mailService;
    let capturedToken = '';
    jest
      .spyOn(mailServiceInstance, 'sendConfirmationEmail')
      .mockImplementationOnce(async (_e: string, _n: string, t: string) => {
        capturedToken = t;
      });
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: testPassword });
    return capturedToken;
  }

  async function registerConfirmAndLogin(email: string): Promise<string> {
    const token = await captureConfirmationToken(email);
    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token });
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: testPassword });
    return res.body.access_token;
  }

  beforeEach(async () => {
    await dataSource.query('DELETE FROM videos');
    await dataSource.query('DELETE FROM channels');
    await dataSource.query('DELETE FROM verification_tokens');
    await dataSource.query('DELETE FROM refresh_tokens');
    await dataSource.query('DELETE FROM users');

    // Use unique email and nickname per test iteration
    const timestamp = Date.now();
    const iterationEmail = `test-${timestamp}@example.com`;
    const iterationNickname = `test-channel-${timestamp}`;

    // Register, confirm and login
    accessToken = await registerConfirmAndLogin(iterationEmail);

    // Create a channel for the user via direct DB
    const userResult = await dataSource.query(
      'SELECT id FROM users WHERE email = $1',
      [iterationEmail],
    );
    const userId = userResult[0].id;

    testChannel = await channelRepository.save({
      name: 'Test Channel',
      nickname: iterationNickname,
      user_id: userId,
    });
  });

  describe('POST /videos (Initiate Upload)', () => {
    it('should initiate upload with valid body and return 201', async () => {
      const response = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          filename: 'test-video.mp4',
          fileSizeBytes: 1000000,
          mimeType: 'video/mp4',
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('publicId');
      expect(response.body.status).toBe('draft');
      expect(response.body).toHaveProperty('uploadId');
      expect(response.body).toHaveProperty('storageKey');
      expect(response.body).toHaveProperty('partSizeBytes');
      expect(Array.isArray(response.body.parts)).toBe(true);
      expect(response.body.parts.length).toBeGreaterThan(0);
      expect(response.body.parts[0]).toHaveProperty('partNumber');
      expect(response.body.parts[0]).toHaveProperty('url');
    });

    it('should return 400 when fileSizeBytes exceeds 10GB', async () => {
      const response = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          filename: 'test-video.mp4',
          fileSizeBytes: 10737418241, // 10GB + 1 byte
          mimeType: 'video/mp4',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
    });

    it('should return 401 when access token is missing', async () => {
      const response = await request(app.getHttpServer()).post('/videos').send({
        filename: 'test-video.mp4',
        fileSizeBytes: 1000000,
        mimeType: 'video/mp4',
      });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /videos/:publicId/complete-upload', () => {
    it('should complete upload and transition to processing', async () => {
      // First, initiate upload
      const initiateResponse = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          filename: 'test-video.mp4',
          fileSizeBytes: 1000000,
          mimeType: 'video/mp4',
        });

      const { publicId } = initiateResponse.body;

      // Then complete upload
      const response = await request(app.getHttpServer())
        .post(`/videos/${publicId}/complete-upload`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          parts: [{ partNumber: 1, eTag: 'etag1' }],
        });

      expect(response.status).toBe(200);
      expect(response.body.publicId).toBe(publicId);
      expect(response.body.status).toBe('processing');
    });

    it('should return 409 when completing an already completed video', async () => {
      const video = await videoRepository.save({
        channel_id: testChannel.id,
        public_id: 'already-completed',
        storage_key: 's3://bucket/video.mp4',
        upload_id: 'upload-123',
        status: VideoStatus.UPLOADED,
      });

      const response = await request(app.getHttpServer())
        .post(`/videos/${video.public_id}/complete-upload`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          parts: [{ partNumber: 1, eTag: 'etag1' }],
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('UPLOAD_ALREADY_COMPLETED');
    });

    it('should return 404 for unknown video', async () => {
      const response = await request(app.getHttpServer())
        .post('/videos/unknown123/complete-upload')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          parts: [{ partNumber: 1, eTag: 'etag1' }],
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('VIDEO_NOT_FOUND');
    });

    it('should return 404 for unowned video', async () => {
      // Create another user and channel
      const timestamp = Date.now() + 1;
      const otherEmail = `other-${timestamp}@example.com`;
      const otherNickname = `other-channel-${timestamp}`;

      await registerConfirmAndLogin(otherEmail);

      const otherUserResult = await dataSource.query(
        'SELECT id FROM users WHERE email = $1',
        [otherEmail],
      );
      const otherUserId = otherUserResult[0].id;

      const otherChannel = await channelRepository.save({
        name: 'Other Channel',
        nickname: otherNickname,
        user_id: otherUserId,
      });

      const video = await videoRepository.save({
        channel_id: otherChannel.id,
        public_id: 'other-video',
        storage_key: 's3://bucket/video.mp4',
        upload_id: 'upload-123',
      });

      const response = await request(app.getHttpServer())
        .post(`/videos/${video.public_id}/complete-upload`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          parts: [{ partNumber: 1, eTag: 'etag1' }],
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('VIDEO_NOT_FOUND');
    });
  });

  describe('GET /videos/:publicId (Status)', () => {
    it('should return video status for owned video', async () => {
      const video = await videoRepository.save({
        channel_id: testChannel.id,
        public_id: 'status-test',
        storage_key: 's3://bucket/video.mp4',
        status: VideoStatus.DRAFT,
      });

      const response = await request(app.getHttpServer())
        .get(`/videos/${video.public_id}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.publicId).toBe('status-test');
      expect(response.body.status).toBe('draft');
      expect(response.body).toHaveProperty('durationSeconds');
      expect(response.body).toHaveProperty('failureReason');
      expect(response.body).toHaveProperty('createdAt');
    });

    it('should return 404 for unknown video', async () => {
      const response = await request(app.getHttpServer())
        .get('/videos/unknown123')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('VIDEO_NOT_FOUND');
    });

    it('should return 404 for unowned video', async () => {
      // Create another user and channel
      const timestamp = Date.now() + 2;
      const otherEmail = `other-${timestamp}@example.com`;
      const otherNickname = `other-channel-${timestamp}`;

      await registerConfirmAndLogin(otherEmail);

      const otherUserResult = await dataSource.query(
        'SELECT id FROM users WHERE email = $1',
        [otherEmail],
      );
      const otherUserId = otherUserResult[0].id;

      const otherChannel = await channelRepository.save({
        name: 'Other Channel',
        nickname: otherNickname,
        user_id: otherUserId,
      });

      const video = await videoRepository.save({
        channel_id: otherChannel.id,
        public_id: 'other-video',
        storage_key: 's3://bucket/video.mp4',
      });

      const response = await request(app.getHttpServer())
        .get(`/videos/${video.public_id}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('VIDEO_NOT_FOUND');
    });
  });

  describe('GET /videos/:publicId/stream', () => {
    it('should return stream URL for ready video without auth', async () => {
      const video = await videoRepository.save({
        channel_id: testChannel.id,
        public_id: 'stream-test',
        storage_key: 's3://bucket/video.mp4',
        status: VideoStatus.READY,
      });

      const response = await request(app.getHttpServer()).get(
        `/videos/${video.public_id}/stream`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('url');
      expect(response.body).toHaveProperty('expiresAt');
    });

    it('should return 409 for video not ready', async () => {
      const video = await videoRepository.save({
        channel_id: testChannel.id,
        public_id: 'not-ready',
        storage_key: 's3://bucket/video.mp4',
        status: VideoStatus.PROCESSING,
      });

      const response = await request(app.getHttpServer()).get(
        `/videos/${video.public_id}/stream`,
      );

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('VIDEO_NOT_READY');
    });

    it('should return 404 for unknown video', async () => {
      const response = await request(app.getHttpServer()).get(
        '/videos/unknown123/stream',
      );

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('VIDEO_NOT_FOUND');
    });
  });

  describe('GET /videos/:publicId/download', () => {
    it('should return download URL for ready video without auth', async () => {
      const video = await videoRepository.save({
        channel_id: testChannel.id,
        public_id: 'download-test',
        storage_key: 's3://bucket/video.mp4',
        status: VideoStatus.READY,
      });

      const response = await request(app.getHttpServer()).get(
        `/videos/${video.public_id}/download`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('url');
      expect(response.body).toHaveProperty('expiresAt');
      expect(response.body.url).toContain('attachment');
    });

    it('should return 409 for video not ready', async () => {
      const video = await videoRepository.save({
        channel_id: testChannel.id,
        public_id: 'not-ready',
        storage_key: 's3://bucket/video.mp4',
        status: VideoStatus.DRAFT,
      });

      const response = await request(app.getHttpServer()).get(
        `/videos/${video.public_id}/download`,
      );

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('VIDEO_NOT_READY');
    });

    it('should return 404 for unknown video', async () => {
      const response = await request(app.getHttpServer()).get(
        '/videos/unknown123/download',
      );

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('VIDEO_NOT_FOUND');
    });
  });
});
