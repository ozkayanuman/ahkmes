import { JwtService } from "@nestjs/jwt";
import { RealtimeGateway } from "./realtime.gateway";

describe("RealtimeGateway", () => {
  let gateway: RealtimeGateway;
  let jwt: JwtService;

  beforeEach(() => {
    jwt = new JwtService({ secret: "test-secret-test-secret-test-secret" });
    gateway = new RealtimeGateway(jwt);
  });

  it("emitToTenant — tenant odasına olay yayınlar", () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    gateway.server = { to } as any;

    gateway.emitToTenant("t1", "stock.updated", { materialId: "m1" });

    expect(to).toHaveBeenCalledWith("tenant:t1");
    expect(emit).toHaveBeenCalledWith("stock.updated", { materialId: "m1" });
  });

  it("handleConnection — geçerli JWT ile tenant odasına katılır", async () => {
    const token = await jwt.signAsync({
      sub: "u1",
      email: "a@b.c",
      name: "Test",
      role: "ADMIN",
      tenantId: "t1",
    });
    const client = {
      handshake: { auth: { token }, headers: {} },
      data: {},
      join: jest.fn(),
      disconnect: jest.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await gateway.handleConnection(client);

    expect(client.join).toHaveBeenCalledWith("tenant:t1");
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it("handleConnection — geçersiz JWT bağlantıyı düşürür", async () => {
    const client = {
      handshake: { auth: { token: "bozuk" }, headers: {} },
      data: {},
      join: jest.fn(),
      disconnect: jest.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
  });
});
