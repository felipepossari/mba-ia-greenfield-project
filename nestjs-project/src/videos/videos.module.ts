import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { StorageModule } from '../storage/storage.module';
import { ChannelsModule } from '../channels/channels.module';
import { Video } from './entities/video.entity';
import { VideosService } from './videos.service';
import { VideosController } from './videos.controller';
import { VideoQueueService } from './video-queue.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video]),
    BullModule.registerQueue({
      name: 'video.processing',
    }),
    StorageModule,
    ChannelsModule,
  ],
  providers: [VideosService, VideoQueueService],
  controllers: [VideosController],
  exports: [VideosService, TypeOrmModule],
})
export class VideosModule {}
