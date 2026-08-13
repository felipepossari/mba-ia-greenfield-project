import { FfprobeService, MetadataExtractionError } from './ffprobe.service';

describe('FfprobeService (Unit)', () => {
  let service: FfprobeService;
  let mockExecFile: jest.Mock;

  beforeEach(() => {
    // Mock execFile before creating the service
    mockExecFile = jest.fn();
    jest.doMock('child_process', () => ({
      execFile: mockExecFile,
    }));
    service = new FfprobeService();
  });

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  describe('extractDuration', () => {
    it('should parse JSON and return duration in seconds', async () => {
      const mockOutput = {
        format: {
          duration: '123.456',
        },
      };

      // Mock execFile to call callback with the mocked output
      mockExecFile.mockImplementation(
        (
          _file: string,
          _args: string[],
          callback: (error: Error | null, result?: { stdout: string }) => void,
        ) => {
          setTimeout(
            () => callback(null, { stdout: JSON.stringify(mockOutput) }),
            0,
          );
        },
      );

      const duration = await service.extractDuration('/path/to/video.mp4');
      expect(duration).toBe(123);
    });

    it('should throw MetadataExtractionError on invalid duration', async () => {
      const mockOutput = {
        format: {
          duration: 'invalid',
        },
      };

      mockExecFile.mockImplementation(
        (
          _file: string,
          _args: string[],
          callback: (error: Error | null, result?: { stdout: string }) => void,
        ) => {
          setTimeout(
            () => callback(null, { stdout: JSON.stringify(mockOutput) }),
            0,
          );
        },
      );

      await expect(
        service.extractDuration('/path/to/video.mp4'),
      ).rejects.toThrow(MetadataExtractionError);
    });

    it('should throw MetadataExtractionError when ffprobe fails', async () => {
      mockExecFile.mockImplementation(
        (
          _file: string,
          _args: string[],
          callback: (error: Error | null) => void,
        ) => {
          setTimeout(() => callback(new Error('ffprobe not found')), 0);
        },
      );

      await expect(
        service.extractDuration('/path/to/video.mp4'),
      ).rejects.toThrow(MetadataExtractionError);
    });
  });
});
