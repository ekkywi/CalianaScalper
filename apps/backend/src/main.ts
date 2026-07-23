import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  app.enableCors({
    origin: '*',
  });

  await app.listen(3001, '0.0.0.0');
  
  console.log(`[HTTP/WS] Backend mendengarkan di port 3001 (0.0.0.0)`);
}
bootstrap();