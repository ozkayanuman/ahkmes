import { SetMetadata } from "@nestjs/common";

/** Marks a route whose application service writes its audit record in the same DB transaction. */
export const SKIP_AUDIT_KEY = "skipAudit";
export const SkipAudit = () => SetMetadata(SKIP_AUDIT_KEY, true);
