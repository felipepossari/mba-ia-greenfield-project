import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Video } from '../videos/entities/video.entity';
import { StorageModule } from '../storage/storage.module';
import { FfprobeService } from './ffprobe.service';
import { ThumbnailService } from './thumbnail.service';
import { VideoProcessingProcessor } from './video-processing.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'video.processing',
    }),
    TypeOrmModule.forFeature([Video]),
    StorageModule,
  ],
  providers: [FfprobeService, ThumbnailService, VideoProcessingProcessor],
  exports: [FfprobeService, ThumbnailService],
})
export class ProcessingModule {}
