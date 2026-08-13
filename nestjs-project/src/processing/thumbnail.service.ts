import { Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export class ThumbnailGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThumbnailGenerationError';
  }
}

@Injectable()
export class ThumbnailService {
  async generateThumbnail(
    filePath: string,
    outputPath: string,
    durationSeconds: number,
  ): Promise<void> {
    try {
      const seekOffset = Math.floor(durationSeconds * 0.1);

      await execFileAsync('ffmpeg', [
        '-ss',
        String(seekOffset),
        '-i',
        filePath,
        '-frames:v',
        '1',
        '-y',
        outputPath,
      ]);
    } catch (err) {
      if (err instanceof ThumbnailGenerationError) {
        throw err;
      }

      const error = err as Error;
      throw new ThumbnailGenerationError(
        `Failed to generate thumbnail: ${error.message}`,
      );
    }
  }
}
