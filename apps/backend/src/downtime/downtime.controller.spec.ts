import { Reflector } from "@nestjs/core";
import { DowntimeController } from "./downtime.controller";
import { ACTION_PERMISSIONS_KEY } from "../common/decorators/require-action-permission.decorator";

describe("DowntimeController loss reason governance", () => {
  it("requires the dedicated OEE loss-reason administration permission for reason changes", () => {
    const reflector = new Reflector();
    expect(reflector.get(ACTION_PERMISSIONS_KEY, DowntimeController.prototype.createReason)).toEqual(["OEE_LOSS_REASON_ADMIN"]);
    expect(reflector.get(ACTION_PERMISSIONS_KEY, DowntimeController.prototype.updateReason)).toEqual(["OEE_LOSS_REASON_ADMIN"]);
  });
});
