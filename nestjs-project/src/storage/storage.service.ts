import { Injectable, Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  S3Client,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  GetObjectCommand,
  UploadPartCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream } from 'fs';
import type { Readable } from 'stream';
import storageConfig from '../config/storage.config';

const PRESIGNED_URL_EXPIRY = 15 * 60; // 15 minutes in seconds

export class InvalidUploadPartsException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidUploadPartsException';
  }
}

@Injectable()
export class StorageService {
  private readonly s3Client: S3Client;
  private readonly bucket: string;
  private readonly presignedUrlExpiry: number;

  constructor(
    @Inject(storageConfig.KEY)
    private readonly storageCfg: ConfigType<typeof storageConfig>,
  ) {
    if (!storageCfg.bucket) {
      throw new Error('S3_BUCKET environment variable is required');
    }
    this.bucket = storageCfg.bucket;
    this.presignedUrlExpiry = PRESIGNED_URL_EXPIRY;

    this.s3Client = new S3Client({
      region: storageCfg.region,
      credentials: {
        accessKeyId: storageCfg.accessKeyId,
        secretAccessKey: storageCfg.secretAccessKey,
      },
      endpoint: storageCfg.useSSL
        ? `https://${storageCfg.endpoint}:${storageCfg.port}`
        : `http://${storageCfg.endpoint}:${storageCfg.port}`,
      forcePathStyle: true,
    });
  }

  buildVideoKey(channelId: string, videoId: string): string {
    return `videos/${channelId}/${videoId}/original`;
  }

  buildThumbnailKey(channelId: string, videoId: string): string {
    return `videos/${channelId}/${videoId}/thumbnail.jpg`;
  }

  async initiateMultipartUpload(
    key: string,
    mimeType: string,
  ): Promise<{
    uploadId: string;
    partUrls: { partNumber: number; url: string }[];
  }> {
    const createCommand = new CreateMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
    });

    const createResponse = await this.s3Client.send(createCommand);

    if (!createResponse.UploadId) {
      throw new Error(
        'Failed to initiate multipart upload: no UploadId returned',
      );
    }

    const uploadId = createResponse.UploadId;

    // Calculate part count (assume 10GB max, 5GB per part = 2 parts)
    // but allow flexible partCount based on client request if needed later
    const partCount = 2;
    const partUrls: { partNumber: number; url: string }[] = [];

    for (let partNumber = 1; partNumber <= partCount; partNumber++) {
      const uploadPartCommand = new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        PartNumber: partNumber,
        UploadId: uploadId,
      });

      const presignedUrl = await getSignedUrl(
        this.s3Client,
        uploadPartCommand,
        {
          expiresIn: this.presignedUrlExpiry,
        },
      );

      partUrls.push({
        partNumber,
        url: presignedUrl,
      });
    }

    return { uploadId, partUrls };
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: { partNumber: number; eTag: string }[],
  ): Promise<{ fileSizeBytes: number }> {
    try {
      const completeCommand = new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((part) => ({
            PartNumber: part.partNumber,
            ETag: part.eTag,
          })),
        },
      });

      const completeResponse = await this.s3Client.send(completeCommand);

      // CompleteMultipartUpload response doesn't contain file size
      // The video worker will extract the actual size from metadata
      // For now, return 0 — the controller will set fileSizeBytes from the metadata extraction job
      const fileSizeBytes = 0;

      return { fileSizeBytes };
    } catch (error) {
      // S3 returns an error if parts don't match
      if (error instanceof Error && error.message.includes('InvalidPart')) {
        throw new InvalidUploadPartsException(
          "Uploaded parts do not match the storage provider's record",
        );
      }
      throw error;
    }
  }

  async getPresignedStreamUrl(
    key: string,
  ): Promise<{ url: string; expiresAt: string }> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const url = await getSignedUrl(this.s3Client, command, {
      expiresIn: this.presignedUrlExpiry,
    });

    const expiresAt = new Date(
      Date.now() + this.presignedUrlExpiry * 1000,
    ).toISOString();

    return { url, expiresAt };
  }

  async getPresignedDownloadUrl(
    key: string,
  ): Promise<{ url: string; expiresAt: string }> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: 'attachment',
    });

    const url = await getSignedUrl(this.s3Client, command, {
      expiresIn: this.presignedUrlExpiry,
    });

    const expiresAt = new Date(
      Date.now() + this.presignedUrlExpiry * 1000,
    ).toISOString();

    return { url, expiresAt };
  }

  async downloadFile(key: string): Promise<Readable> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const response = await this.s3Client.send(command);

    if (!response.Body) {
      throw new Error('No body in GetObject response');
    }

    return response.Body as Readable;
  }

  async uploadFile(filePath: string, key: string): Promise<void> {
    const fileStream = createReadStream(filePath);

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: fileStream,
    });

    await this.s3Client.send(command);
  }
}
