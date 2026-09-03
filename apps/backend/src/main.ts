import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { corsOrigins } from "./config/environment.validation";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const isProduction = process.env.NODE_ENV === "production";
  app.enableCors({ origin: isProduction ? corsOrigins(process.env.CORS_ORIGINS) : true, credentials: true });
  app.useGlobalFilters(new HttpExceptionFilter());
  const port = Number(process.env.BACKEND_PORT ?? 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`AHKMES backend listening on :${port}`);
}

void bootstrap();
