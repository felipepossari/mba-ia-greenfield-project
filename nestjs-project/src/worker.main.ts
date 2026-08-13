import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker/worker.module';

async function bootstrap() {
  const app = await NestFactory.create(WorkerModule);
  await app.init();
  console.log('Video worker started');
}

void bootstrap();
