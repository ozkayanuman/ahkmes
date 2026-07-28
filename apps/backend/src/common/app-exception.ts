import { HttpException, HttpStatus } from "@nestjs/common";

/** İsimli hata kodu taşıyan HttpException — HttpExceptionFilter tarafından
 * `{ errorCode, message, statusCode }` biçiminde döndürülür. */
export class AppException extends HttpException {
  constructor(status: HttpStatus, errorCode: string, message: string) {
    super({ errorCode, message }, status);
  }
}
