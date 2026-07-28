import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalFilters(new HttpExceptionFilter());
  const port = process.env.BACKEND_PORT ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`AHKMES backend listening on :${port}`);
}

void bootstrap();
