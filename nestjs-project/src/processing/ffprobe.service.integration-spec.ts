import { FfprobeService, MetadataExtractionError } from './ffprobe.service';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

describe('FfprobeService (Integration)', () => {
  let service: FfprobeService;
  let testVideoPath: string;

  beforeAll(() => {
    service = new FfprobeService();

    // Check if ffprobe is available
    try {
      execSync('which ffprobe', { stdio: 'ignore' });
    } catch {
      console.warn('ffprobe not found, skipping integration tests');
    }
  });

  beforeEach(() => {
    // Create a minimal test video file if needed
    const tmpDir = path.join(__dirname, '../../.tmp');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    testVideoPath = path.join(tmpDir, 'test-video.mp4');
  });

  afterEach(() => {
    // Clean up test files
    if (fs.existsSync(testVideoPath)) {
      fs.unlinkSync(testVideoPath);
    }
  });

  describe('extractDuration', () => {
    it('should throw MetadataExtractionError for non-existent file', async () => {
      await expect(
        service.extractDuration('/nonexistent/path/to/video.mp4'),
      ).rejects.toThrow(MetadataExtractionError);
    });

    it('should throw MetadataExtractionError for invalid video file', async () => {
      // Create a text file that ffprobe will reject
      fs.writeFileSync(testVideoPath, 'This is not a video file');

      await expect(
        service.extractDuration(testVideoPath),
      ).rejects.toThrow(MetadataExtractionError);
    });
  });
});
