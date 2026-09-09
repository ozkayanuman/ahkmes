import { SetMetadata } from "@nestjs/common";

export const ACTION_PERMISSIONS_KEY = "action-permissions";
export const RequireActionPermissions = (...actions: string[]) => SetMetadata(ACTION_PERMISSIONS_KEY, actions);
