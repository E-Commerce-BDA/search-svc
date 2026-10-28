import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  configureApp(app);
  app.enableShutdownHooks();

  const configService = app.get(ConfigService);
  const port = Number(configService.getOrThrow<string>('PORT'));

  await app.listen(port, '0.0.0.0');
}

await bootstrap();
