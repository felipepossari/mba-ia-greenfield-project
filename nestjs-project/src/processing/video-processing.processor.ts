import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { createWriteStream, unlink } from 'fs';
import { promisify } from 'util';
import { Readable } from 'stream';
import { join } from 'path';
import { Video, VideoStatus } from '../videos/entities/video.entity';
import { StorageService } from '../storage/storage.service';
import { FfprobeService } from './ffprobe.service';
import { ThumbnailService } from './thumbnail.service';

const unlinkAsync = promisify(unlink);

interface VideoProcessingJobData {
  videoId: string;
  storageKey: string;
  publicId: string;
}

@Processor('video.processing')
export class VideoProcessingProcessor {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
    private readonly ffprobeService: FfprobeService,
    private readonly thumbnailService: ThumbnailService,
  ) {}

  async process(job: Job<VideoProcessingJobData>): Promise<void> {
    return this.handleVideoProcessing(job);
  }

  private async handleVideoProcessing(
    job: Job<VideoProcessingJobData>,
  ): Promise<void> {
    const { videoId, storageKey } = job.data;
    const tempDir = '/tmp';
    const tempVideoPath = join(tempDir, `${videoId}-original`);
    const tempThumbnailPath = join(tempDir, `${videoId}-thumbnail.jpg`);

    try {
      // Fetch the video to get channel_id
      const video = await this.videoRepository.findOne({
        where: { id: videoId },
      });

      if (!video) {
        throw new Error(`Video not found: ${videoId}`);
      }

      // Download the video file from storage
      const videoStream = await this.storageService.downloadFile(storageKey);
      await this.streamToFile(videoStream, tempVideoPath);

      // Extract metadata
      const durationSeconds =
        await this.ffprobeService.extractDuration(tempVideoPath);

      // Generate thumbnail
      await this.thumbnailService.generateThumbnail(
        tempVideoPath,
        tempThumbnailPath,
        durationSeconds,
      );

      // Upload thumbnail to storage
      const thumbnailKey = this.storageService.buildThumbnailKey(
        video.channel_id,
        videoId,
      );
      await this.storageService.uploadFile(tempThumbnailPath, thumbnailKey);

      // Update video record with successful processing results
      await this.videoRepository.update(videoId, {
        duration_seconds: durationSeconds,
        thumbnail_key: thumbnailKey,
        status: VideoStatus.READY,
      });
    } catch (error) {
      const failureReason =
        error instanceof Error ? error.message : 'Unknown error';

      // Mark video as failed
      await this.videoRepository.update(videoId, {
        status: VideoStatus.FAILED,
        failure_reason: failureReason,
      });

      throw error;
    } finally {
      // Clean up temporary files
      try {
        await unlinkAsync(tempVideoPath);
      } catch {
        // File may not exist if download failed
      }

      try {
        await unlinkAsync(tempThumbnailPath);
      } catch {
        // File may not exist if thumbnail generation failed
      }
    }
  }

  private async streamToFile(
    stream: Readable,
    filePath: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const writeStream = createWriteStream(filePath);

      stream.pipe(writeStream);

      writeStream.on('finish', () => {
        resolve();
      });

      writeStream.on('error', (error) => {
        reject(error);
      });

      stream.on('error', (error) => {
        reject(error);
      });
    });
  }
}
