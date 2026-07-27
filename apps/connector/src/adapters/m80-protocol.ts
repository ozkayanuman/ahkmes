/**
 * Mitsubishi M80 (Custom API / EZSocket-GIOP ailesi) için basitleştirilmiş kablo formatı.
 *
 * Kaynak: açık kaynak (MIT) `mitsubishi_cnc_m70_ezsocket_net` kütüphanesinin GIOP katmanı
 * (M70 için yazılmış, M700/M800/M80 aynı Custom API neslinden). "GIOP" magic, "mochaGetData"
 * komut adı ve section/subSection/systemNo/axisNo/dataType alanları o kütüphaneden birebir
 * alınmıştır. Ancak toplam frame uzunluğu öneki (frameLength) ve tam byte hizalaması bizim
 * kendi basitleştirmemizdir — gerçek M80 ile konuşurken bu katmanın (yalnızca bu dosyanın)
 * gerçek cihazdan yakalanan trafiğe göre güncellenmesi gerekecek. `M80Adapter` ve
 * `m80-sim-server` yalnızca bu modül üzerinden haberleşir, böylece gerçek protokol netleşince
 * tek değişiklik noktası burası olur.
 */

export const GIOP_MAGIC = "GIOP";
export const GIOP_VERSION = 1;

export const MsgType = {
  REQUEST: 0,
  REPLY: 1,
} as const;

/** Custom API'nin gerçek veri tipi sabitleri (kütüphaneden). */
export const DataType = {
  CHAR: 1,
  SHORT: 2,
  LONG: 3,
  DLONG: 4,
  DOUBLE: 5,
  FLOATBIN: 6,
} as const;
export type DataTypeValue = (typeof DataType)[keyof typeof DataType];

export const GET_DATA_OP = "mochaGetData";

/**
 * Placeholder section/subSection adresleri — gerçek M80 "Custom API Variables List"
 * dokümanı (BNP-C3072-xxx) netleşince güncellenmeli. `M80Adapter` ve `m80-sim-server`
 * bu sabitleri ortak referans alır, böylece ikisi arasında adres uyuşmazlığı olmaz.
 *
 * Araştırma ipucu (BNP-B2199, MELDASMAGIC nesli — M80 değil ama aynı Custom API
 * ailesinin atası): gerçek cihazda "çalışma durumu" tek bir alan değil, birden çok
 * alanın birleşimi — Program No/Sequence No/Block No, Section 13 / Subsection
 * 40031-40036'da. Alarm ise düz bir GetData ile değil, ayrı bir fonksiyonla
 * (`melGetCurrentAlarmMsg`) okunuyor. Bizim tek-alanlı CycleStatus/PartCount/
 * AlarmMessage modelimiz kasıtlı bir soyutlama (OpcuaAdapter ile aynı sözleşme) —
 * gerçek M80 entegrasyonunda bu üçünü, muhtemelen birden çok section/subSection
 * okuyup M80Adapter içinde türetmemiz gerekecek.
 */
export const DEFAULT_ITEM_ADDRESSES = {
  cycleStatus: { section: 1, subSection: 1 },
  partCount: { section: 1, subSection: 2 },
  alarmMessage: { section: 12, subSection: 1 },
} as const;

export interface GetDataRequest {
  requestId: number;
  section: number;
  subSection: number;
  systemNo: number;
  axisNo: number;
  dataType: DataTypeValue;
}

export interface GetDataReply {
  requestId: number;
  isError: boolean;
  dataType: DataTypeValue;
  data: Buffer;
}

/** Ortak header'ı (frameLength hariç) request/reply ayrımı yapmadan yazar. */
function writeCommonHeader(buf: Buffer, msgType: number): void {
  buf.write(GIOP_MAGIC, 0, "ascii");
  buf.writeUInt8(GIOP_VERSION, 4);
  buf.writeUInt8(1, 5); // byteOrder: 1 = little-endian
  buf.writeUInt8(msgType, 6);
  buf.writeUInt8(0, 7); // reserved
}

function readCommonHeader(buf: Buffer): { msgType: number } {
  const magic = buf.toString("ascii", 0, 4);
  if (magic !== GIOP_MAGIC) {
    throw new Error(`Geçersiz GIOP magic: ${magic}`);
  }
  return { msgType: buf.readUInt8(6) };
}

export function encodeGetDataRequest(req: GetDataRequest): Buffer {
  const op = Buffer.from(GET_DATA_OP, "ascii");
  const payloadLength = 8 + 4 + 4 + op.length + 1 + 1 + 1 + 4 + 1;
  const frame = Buffer.alloc(4 + payloadLength);

  frame.writeUInt32LE(payloadLength, 0);
  writeCommonHeader(frame.subarray(4), MsgType.REQUEST);

  let offset = 12; // 4 (frameLength) + 8 (common header)
  frame.writeUInt32LE(req.requestId, offset);
  offset += 4;
  frame.writeUInt32LE(op.length, offset);
  offset += 4;
  op.copy(frame, offset);
  offset += op.length;
  frame.writeUInt8(req.section, offset);
  offset += 1;
  frame.writeUInt8(req.subSection, offset);
  offset += 1;
  frame.writeUInt8(req.systemNo, offset);
  offset += 1;
  frame.writeUInt32LE(req.axisNo, offset);
  offset += 4;
  frame.writeUInt8(req.dataType, offset);

  return frame;
}

export function decodeGetDataRequest(frame: Buffer): GetDataRequest {
  readCommonHeader(frame.subarray(4));
  let offset = 12;
  const requestId = frame.readUInt32LE(offset);
  offset += 4;
  const opLength = frame.readUInt32LE(offset);
  offset += 4;
  offset += opLength; // op adı doğrulanmadan atlanıyor (sadece GetData destekleniyor)
  const section = frame.readUInt8(offset);
  offset += 1;
  const subSection = frame.readUInt8(offset);
  offset += 1;
  const systemNo = frame.readUInt8(offset);
  offset += 1;
  const axisNo = frame.readUInt32LE(offset);
  offset += 4;
  const dataType = frame.readUInt8(offset) as DataTypeValue;

  return { requestId, section, subSection, systemNo, axisNo, dataType };
}

export function encodeGetDataReply(reply: GetDataReply): Buffer {
  const payloadLength = 8 + 4 + 1 + 1 + 4 + reply.data.length;
  const frame = Buffer.alloc(4 + payloadLength);

  frame.writeUInt32LE(payloadLength, 0);
  writeCommonHeader(frame.subarray(4), MsgType.REPLY);

  let offset = 12;
  frame.writeUInt32LE(reply.requestId, offset);
  offset += 4;
  frame.writeUInt8(reply.isError ? 1 : 0, offset);
  offset += 1;
  frame.writeUInt8(reply.dataType, offset);
  offset += 1;
  frame.writeUInt32LE(reply.data.length, offset);
  offset += 4;
  reply.data.copy(frame, offset);

  return frame;
}

export function decodeGetDataReply(frame: Buffer): GetDataReply {
  readCommonHeader(frame.subarray(4));
  let offset = 12;
  const requestId = frame.readUInt32LE(offset);
  offset += 4;
  const isError = frame.readUInt8(offset) === 1;
  offset += 1;
  const dataType = frame.readUInt8(offset) as DataTypeValue;
  offset += 1;
  const dataLength = frame.readUInt32LE(offset);
  offset += 4;
  const data = frame.subarray(offset, offset + dataLength);

  return { requestId, isError, dataType, data: Buffer.from(data) };
}

/** İki tam frame'i ayırt edebilmek için: frameLength alanını okuyup toplam frame boyutunu döner. */
export function totalFrameSize(buf: Buffer): number | null {
  if (buf.length < 4) return null;
  const payloadLength = buf.readUInt32LE(0);
  const total = 4 + payloadLength;
  return buf.length >= total ? total : null;
}

export function encodeLongValue(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(value, 0);
  return buf;
}

export function decodeLongValue(data: Buffer): number {
  return data.readInt32LE(0);
}

export interface ParsedM80Address {
  section: number;
  subSection: number;
  dataType: DataTypeValue;
}

/**
 * Automation Gateway: web'de tanımlanan tag adresi bir string olarak saklanır
 * ("section:subSection" veya "section:subSection:char"). Backend/web bu formatı
 * bilmez — yalnızca connector, M80'e özgü bu adresleme şemasını yorumlar.
 */
export function parseM80Address(address: string): ParsedM80Address | null {
  const parts = address.split(":");
  if (parts.length < 2) return null;
  const section = Number(parts[0]);
  const subSection = Number(parts[1]);
  if (Number.isNaN(section) || Number.isNaN(subSection)) return null;
  const dataType = parts[2] === "char" ? DataType.CHAR : DataType.LONG;
  return { section, subSection, dataType };
}

export function encodeCharValue(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

export function decodeCharValue(data: Buffer): string {
  return data.toString("utf8");
}
