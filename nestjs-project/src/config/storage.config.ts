import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpoint: process.env.S3_ENDPOINT || 'minio',
  port: parseInt(process.env.S3_PORT || '9000', 10),
  bucket: process.env.S3_BUCKET,
  accessKeyId: process.env.S3_ACCESS_KEY_ID || 'minioadmin',
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'minioadmin',
  region: process.env.S3_REGION || 'us-east-1',
  useSSL: (process.env.S3_USE_SSL || 'false').toLowerCase() === 'true',
}));
