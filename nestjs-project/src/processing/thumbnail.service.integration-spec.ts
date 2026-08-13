import {
  ThumbnailGenerationError,
  ThumbnailService,
} from './thumbnail.service';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

describe('ThumbnailService (Integration)', () => {
  let service: ThumbnailService;
  let testVideoPath: string;
  let outputPath: string;
  const tmpDir = path.join(__dirname, '../../.tmp');

  beforeAll(() => {
    service = new ThumbnailService();

    // Check if ffmpeg is available
    try {
      execSync('which ffmpeg', { stdio: 'ignore' });
    } catch {
      console.warn('ffmpeg not found, skipping integration tests');
    }

    // Create tmp directory
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  beforeEach(() => {
    testVideoPath = path.join(tmpDir, 'test-video.mp4');
    outputPath = path.join(tmpDir, 'test-thumbnail.jpg');
  });

  afterEach(() => {
    // Clean up test files
    if (fs.existsSync(testVideoPath)) {
      fs.unlinkSync(testVideoPath);
    }
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
  });

  describe('generateThumbnail', () => {
    it('should throw ThumbnailGenerationError for non-existent video file', async () => {
      const nonExistentPath = path.join(tmpDir, 'nonexistent.mp4');

      await expect(
        service.generateThumbnail(nonExistentPath, outputPath, 10),
      ).rejects.toThrow(ThumbnailGenerationError);
    });

    it('should throw ThumbnailGenerationError for invalid video file', async () => {
      // Create a text file that ffmpeg will reject
      fs.writeFileSync(testVideoPath, 'This is not a video file');

      await expect(
        service.generateThumbnail(testVideoPath, outputPath, 10),
      ).rejects.toThrow(ThumbnailGenerationError);
    });
  });
});
