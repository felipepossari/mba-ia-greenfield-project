import { Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export class MetadataExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetadataExtractionError';
  }
}

interface FFprobeStream {
  duration?: string | number;
}

interface FFprobeFormat {
  duration?: string | number;
}

interface FFprobeOutput {
  streams?: FFprobeStream[];
  format?: FFprobeFormat;
}

@Injectable()
export class FfprobeService {
  async extractDuration(filePath: string): Promise<number> {
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v',
        'error',
        '-show_format',
        '-show_streams',
        '-of',
        'json',
        filePath,
      ]);

      const output: FFprobeOutput = JSON.parse(stdout);

      // Try to get duration from format first, then from streams
      const duration =
        output.format?.duration || output.streams?.[0]?.duration;

      if (duration === undefined || duration === null) {
        throw new MetadataExtractionError('No duration found in ffprobe output');
      }

      const durationSeconds = Math.round(parseFloat(String(duration)));

      if (isNaN(durationSeconds)) {
        throw new MetadataExtractionError(
          'Unable to parse duration from ffprobe output',
        );
      }

      return durationSeconds;
    } catch (err) {
      if (err instanceof MetadataExtractionError) {
        throw err;
      }

      const error = err as Error;
      throw new MetadataExtractionError(
        `Failed to extract metadata: ${error.message}`,
      );
    }
  }
}
