import { Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import type { JwtPayload } from "../common/types";

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token: string | undefined =
        client.handshake.auth?.token ??
        client.handshake.headers.authorization?.toString().replace(/^Bearer\s+/i, "");
      if (!token) throw new Error("token yok");
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      client.data.user = payload;
      await client.join(`tenant:${payload.tenantId}`);
    } catch {
      this.logger.warn("WS bağlantısı reddedildi (geçersiz JWT)");
      client.disconnect(true);
    }
  }

  /** Servisler mutasyon sonrası çağırır — tenant odasına olay yayınlar. */
  emitToTenant(tenantId: string, event: string, payload: unknown) {
    this.server?.to(`tenant:${tenantId}`).emit(event, payload);
  }
}
