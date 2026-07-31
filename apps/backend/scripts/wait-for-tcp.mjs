import net from "node:net";

const [host, portText] = process.argv.slice(2);
const port = Number(portText);
const timeoutMs = 60_000;

if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error("Kullanım: node wait-for-tcp.mjs <host> <port>");
  process.exit(2);
}

const connect = () =>
  new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.once("connect", () => {
      socket.end();
      resolve();
    });
    socket.once("error", reject);
  });

const deadline = Date.now() + timeoutMs;
while (Date.now() < deadline) {
  try {
    await connect();
    console.log(`${host}:${port} hazır.`);
    process.exit(0);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

console.error(`${host}:${port}, ${timeoutMs / 1_000} saniye içinde hazır olmadı.`);
process.exit(1);
