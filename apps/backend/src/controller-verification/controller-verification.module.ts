import { Module } from "@nestjs/common";
import { ControllerVerificationService } from "./controller-verification.service";

@Module({ providers: [ControllerVerificationService], exports: [ControllerVerificationService] })
export class ControllerVerificationModule {}
