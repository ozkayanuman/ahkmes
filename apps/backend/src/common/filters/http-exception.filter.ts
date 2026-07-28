import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { Response } from "express";

const DEFAULT_CODES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: "BAD_REQUEST",
  [HttpStatus.UNAUTHORIZED]: "UNAUTHORIZED",
  [HttpStatus.FORBIDDEN]: "FORBIDDEN",
  [HttpStatus.NOT_FOUND]: "NOT_FOUND",
  [HttpStatus.CONFLICT]: "CONFLICT",
  [HttpStatus.INTERNAL_SERVER_ERROR]: "INTERNAL_ERROR",
};

/** Tüm HttpException'ları tutarlı `{ errorCode, message, statusCode }` gövdesine çevirir.
 * `AppException` zaten `errorCode` taşıyorsa onu kullanır; diğerlerinde HTTP durumundan
 * türetilmiş genel bir kod (ör. NOT_FOUND, CONFLICT) uygulanır. */
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const body = exception.getResponse();

    let errorCode = DEFAULT_CODES[status] ?? "ERROR";
    let message = exception.message;
    if (typeof body === "object" && body !== null) {
      const b = body as { errorCode?: string; message?: string | string[] };
      if (b.errorCode) errorCode = b.errorCode;
      if (b.message) message = Array.isArray(b.message) ? b.message.join(", ") : b.message;
    }

    res.status(status).json({ errorCode, message, statusCode: status });
  }
}
