import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import type { Video } from './entities/video.entity';

export interface VideoProcessingJob {
  videoId: string;
  storageKey: string;
  publicId: string;
}

@Injectable()
export class VideoQueueService {
  constructor(
    @InjectQueue('video.processing')
    private readonly videoQueue: Queue,
  ) {}

  async enqueueProcessing(video: Video): Promise<void> {
    const jobData: VideoProcessingJob = {
      videoId: video.id,
      storageKey: video.storage_key,
      publicId: video.public_id,
    };

    await this.videoQueue.add('process', jobData);
  }
}
