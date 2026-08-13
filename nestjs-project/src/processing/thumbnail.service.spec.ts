import { execFile } from 'child_process';
import {
  ThumbnailGenerationError,
  ThumbnailService,
} from './thumbnail.service';

jest.mock('child_process');

const mockExecFile = execFile as jest.MockedFunction<typeof execFile>;

describe('ThumbnailService', () => {
  let service: ThumbnailService;

  beforeEach(() => {
    service = new ThumbnailService();
    jest.clearAllMocks();
  });

  describe('generateThumbnail', () => {
    it('should invoke ffmpeg with the correct arguments', async () => {
      const filePath = '/tmp/video.mp4';
      const outputPath = '/tmp/thumbnail.jpg';
      const durationSeconds = 100;

      mockExecFile.mockImplementationOnce((command, args, callback: any) => {
        if (typeof callback === 'function') {
          callback(null, '', '');
        }
        return {} as any;
      });

      await service.generateThumbnail(filePath, outputPath, durationSeconds);

      expect(mockExecFile).toHaveBeenCalledWith(
        'ffmpeg',
        ['-ss', '10', '-i', filePath, '-frames:v', '1', '-y', outputPath],
        expect.any(Function),
      );
    });

    it('should calculate the seek offset as 10% of duration', async () => {
      const filePath = '/tmp/video.mp4';
      const outputPath = '/tmp/thumbnail.jpg';
      const durationSeconds = 500;

      mockExecFile.mockImplementationOnce((command, args, callback: any) => {
        if (typeof callback === 'function') {
          callback(null, '', '');
        }
        return {} as any;
      });

      await service.generateThumbnail(filePath, outputPath, durationSeconds);

      const callArgs = mockExecFile.mock.calls[0][1];
      const seekIndex = (callArgs as string[]).indexOf('-ss');
      const seekValue = (callArgs as string[])[seekIndex + 1];

      expect(seekValue).toBe('50');
    });

    it('should throw ThumbnailGenerationError on ffmpeg failure', async () => {
      const filePath = '/tmp/video.mp4';
      const outputPath = '/tmp/thumbnail.jpg';
      const durationSeconds = 100;

      mockExecFile.mockImplementationOnce((command, args, callback: any) => {
        if (typeof callback === 'function') {
          callback(new Error('ffmpeg not found'));
        }
        return {} as any;
      });

      await expect(
        service.generateThumbnail(filePath, outputPath, durationSeconds),
      ).rejects.toThrow(ThumbnailGenerationError);
    });

    it('should throw ThumbnailGenerationError with descriptive message', async () => {
      const filePath = '/tmp/video.mp4';
      const outputPath = '/tmp/thumbnail.jpg';
      const durationSeconds = 100;
      const errorMessage = 'command not found';

      mockExecFile.mockImplementationOnce((command, args, callback: any) => {
        if (typeof callback === 'function') {
          callback(new Error(errorMessage));
        }
        return {} as any;
      });

      await expect(
        service.generateThumbnail(filePath, outputPath, durationSeconds),
      ).rejects.toThrow(
        new RegExp(`Failed to generate thumbnail.*${errorMessage}`),
      );
    });

    it('should handle short videos (duration < 10 seconds)', async () => {
      const filePath = '/tmp/short.mp4';
      const outputPath = '/tmp/thumbnail.jpg';
      const durationSeconds = 5;

      mockExecFile.mockImplementationOnce((command, args, callback: any) => {
        if (typeof callback === 'function') {
          callback(null, '', '');
        }
        return {} as any;
      });

      await service.generateThumbnail(filePath, outputPath, durationSeconds);

      const callArgs = mockExecFile.mock.calls[0][1];
      const seekIndex = (callArgs as string[]).indexOf('-ss');
      const seekValue = (callArgs as string[])[seekIndex + 1];

      expect(seekValue).toBe('0');
    });
  });
});
