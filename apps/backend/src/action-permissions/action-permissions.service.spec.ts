import { ACTION_PERMISSION_ACTIONS, OEE_ACTIONS } from "./action-permissions.service";

describe("OEE action permissions", () => {
  it("exposes distinct read and loss-reason administration actions", () => {
    expect(OEE_ACTIONS).toEqual(["OEE_READ", "OEE_LOSS_REASON_ADMIN"]);
    expect(ACTION_PERMISSION_ACTIONS).toEqual(expect.arrayContaining(OEE_ACTIONS));
  });
});
