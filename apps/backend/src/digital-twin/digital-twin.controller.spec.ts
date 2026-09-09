import { Reflector } from "@nestjs/core";
import { DigitalTwinController } from "./digital-twin.controller";
import { ACTION_PERMISSIONS_KEY } from "../common/decorators/require-action-permission.decorator";

describe("DigitalTwinController", () => {
  it("protects the canonical OEE projection with OEE_READ while leaving edit actions independently authorized", () => {
    const reflector = new Reflector();
    expect(reflector.get(ACTION_PERMISSIONS_KEY, DigitalTwinController.prototype.layout)).toEqual(["OEE_READ"]);
    expect(reflector.get(ACTION_PERMISSIONS_KEY, DigitalTwinController.prototype.setPosition)).toBeUndefined();
  });
});
