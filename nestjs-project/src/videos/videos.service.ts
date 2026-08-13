import { Injectable } from '@nestjs/common';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { generatePublicId } from './public-id.util';
import { Video, VideoStatus } from './entities/video.entity';
import {
  StorageService,
  InvalidUploadPartsException,
} from '../storage/storage.service';
import { VideoQueueService } from './video-queue.service';
import {
  VideoNotFoundException,
  UploadAlreadyCompletedException,
  InvalidUploadPartsException as VideoInvalidUploadPartsException,
  VideoNotReadyException,
} from './videos.exceptions';

const PG_UNIQUE_VIOLATION = '23505';
const PUBLIC_ID_COLUMN = 'public_id';
const MAX_RETRIES = 5;

function isPgUniqueViolationOnColumn(err: unknown, column: string): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const e = err as any;
  return (
    e.code === PG_UNIQUE_VIOLATION &&
    typeof e.detail === 'string' &&
    e.detail.includes(column)
  );
}

interface CreateVideoInput {
  channelId: string;
  storageKey: string;
  uploadId: string;
}

export interface InitiateUploadResponse {
  id: string;
  publicId: string;
  status: VideoStatus;
  uploadId: string;
  storageKey: string;
  partSizeBytes: number;
  parts: Array<{ partNumber: number; url: string }>;
}

@Injectable()
export class VideosService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly videoQueueService: VideoQueueService,
  ) {}

  async createVideo(input: CreateVideoInput): Promise<Video> {
    return this.dataSource.transaction(async (manager) => {
      let publicId = generatePublicId();

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          return await manager.save(
            manager.create(Video, {
              channel_id: input.channelId,
              public_id: publicId,
              storage_key: input.storageKey,
              upload_id: input.uploadId,
              status: VideoStatus.DRAFT,
            }),
          );
        } catch (err) {
          if (isPgUniqueViolationOnColumn(err, PUBLIC_ID_COLUMN)) {
            if (attempt === MAX_RETRIES) {
              throw new Error(
                'Public ID collision could not be resolved after max retries',
              );
            }
            publicId = generatePublicId();
          } else {
            throw err;
          }
        }
      }

      throw new Error(
        'Public ID collision could not be resolved after max retries',
      );
    });
  }

  async initiateUpload(
    channelId: string,
    filename: string,
    fileSizeBytes: number,
    mimeType: string,
  ): Promise<InitiateUploadResponse> {
    const storageKey = `videos/${channelId}/${randomUUID()}`;

    const { uploadId, partUrls } =
      await this.storageService.initiateMultipartUpload(storageKey, mimeType);

    const video = await this.createVideo({
      channelId,
      storageKey,
      uploadId,
    });

    return {
      id: video.id,
      publicId: video.public_id,
      status: video.status,
      uploadId: video.upload_id!,
      storageKey: video.storage_key,
      partSizeBytes: 5368709120, // 5GB
      parts: partUrls,
    };
  }

  async completeUpload(
    channelId: string,
    publicId: string,
    parts: Array<{ partNumber: number; eTag: string }>,
  ): Promise<{ publicId: string; status: VideoStatus }> {
    const video = await this.videoRepository.findOne({
      where: { public_id: publicId, channel_id: channelId },
    });

    if (!video) {
      throw new VideoNotFoundException();
    }

    if (video.status !== VideoStatus.DRAFT) {
      throw new UploadAlreadyCompletedException();
    }

    let fileSizeBytes: number;
    try {
      const result = await this.storageService.completeMultipartUpload(
        video.storage_key,
        video.upload_id!,
        parts,
      );
      fileSizeBytes = result.fileSizeBytes;
    } catch (err) {
      if (err instanceof InvalidUploadPartsException) {
        throw new VideoInvalidUploadPartsException();
      }
      throw err;
    }

    video.status = VideoStatus.PROCESSING;
    video.file_size_bytes = fileSizeBytes;
    video.upload_id = null;
    await this.videoRepository.save(video);

    await this.videoQueueService.enqueueProcessing(video);

    return {
      publicId: video.public_id,
      status: video.status,
    };
  }

  async getStatus(
    channelId: string,
    publicId: string,
  ): Promise<{
    publicId: string;
    status: VideoStatus;
    durationSeconds: number | null;
    failureReason: string | null;
    createdAt: string;
  }> {
    const video = await this.videoRepository.findOne({
      where: { public_id: publicId, channel_id: channelId },
    });

    if (!video) {
      throw new VideoNotFoundException();
    }

    return {
      publicId: video.public_id,
      status: video.status,
      durationSeconds: video.duration_seconds,
      failureReason: video.failure_reason,
      createdAt: video.created_at.toISOString(),
    };
  }

  async getStreamUrl(
    publicId: string,
  ): Promise<{ url: string; expiresAt: string }> {
    const video = await this.videoRepository.findOne({
      where: { public_id: publicId },
    });

    if (!video) {
      throw new VideoNotFoundException();
    }

    if (video.status !== VideoStatus.READY) {
      throw new VideoNotReadyException();
    }

    return this.storageService.getPresignedStreamUrl(video.storage_key);
  }

  async getDownloadUrl(
    publicId: string,
  ): Promise<{ url: string; expiresAt: string }> {
    const video = await this.videoRepository.findOne({
      where: { public_id: publicId },
    });

    if (!video) {
      throw new VideoNotFoundException();
    }

    if (video.status !== VideoStatus.READY) {
      throw new VideoNotReadyException();
    }

    return this.storageService.getPresignedDownloadUrl(video.storage_key);
  }
}
