import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Param,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { VideosService } from './videos.service';
import { ChannelsService } from '../channels/channels.service';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { InitiateUploadResponse } from './videos.service';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(
    private readonly videosService: VideosService,
    private readonly channelsService: ChannelsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Initiate video upload',
    description:
      'Pre-register a video as draft and initiate S3 multipart upload, returning presigned part URLs for direct upload.',
  })
  @ApiResponse({
    status: 201,
    description: 'Video upload initiated successfully',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        publicId: { type: 'string' },
        status: { type: 'string', enum: ['draft'] },
        uploadId: { type: 'string' },
        storageKey: { type: 'string' },
        partSizeBytes: { type: 'number' },
        parts: {
          type: 'array',
          items: {
            properties: {
              partNumber: { type: 'number' },
              url: { type: 'string' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error (e.g., file size exceeds 10GB)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async initiateUpload(
    @CurrentUser() user: JwtPayload,
    @Body() dto: InitiateUploadDto,
  ): Promise<InitiateUploadResponse> {
    const channel = await this.channelsService.getChannelByUserId(user.sub);

    return this.videosService.initiateUpload(
      channel.id,
      dto.filename,
      dto.fileSizeBytes,
      dto.mimeType,
    );
  }
}
