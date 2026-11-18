// Local ZIP32 codec for CAP packages and OOXML files.
export const utf8 = new TextEncoder();
export const decodeText = (data) => new TextDecoder("utf-8", { fatal: true }).decode(data);
const localSignature = 0x04034b50;
const directorySignature = 0x02014b50;
const endSignature = 0x06054b50;
const maxTotal = 512 * 1024 * 1024;
const maxMember = 256 * 1024 * 1024;
const formatError = (reason) => new Error("ZIP tidak dapat dibuka. " + reason);

export async function asBytes(source) {
  if (source instanceof Uint8Array) return source;
  if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (typeof source === "string") return utf8.encode(source);
  if (source instanceof Blob) return new Uint8Array(await source.arrayBuffer());
  throw new TypeError("Isi berkas tidak dapat dibaca.");
}

export function safePath(path) {
  return typeof path === "string" && path.length > 0 && !/[\\:\u0000-\u001F]/.test(path) &&
    path.split("/").every(part => part && part !== "." && part !== "..");
}

const table = Uint32Array.from({ length: 256 }, (_, i) => {
  let value = i;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ table[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

function header(length) {
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  return { bytes, u16: (at, n) => view.setUint16(at, n, true), u32: (at, n) => view.setUint32(at, n, true) };
}

export async function writeZip(members, { compress = true, type = "application/zip" } = {}) {
  if (members.length > 65534) throw formatError("Jumlah berkas melebihi batas ZIP32.");
  const central = [], parts = [], paths = new Set();
  let offset = 0, centralLength = 0, unpacked = 0;
  const now = new Date();
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  for (const member of members) {
    if (!safePath(member.name) || paths.has(member.name)) throw formatError("Nama berkas tidak sah atau berulang.");
    paths.add(member.name);
    const name = utf8.encode(member.name);
    if (name.length > 65535) throw formatError("Nama berkas terlalu panjang.");
    const bytes = await asBytes(member.data);
    unpacked += bytes.length;
    if (bytes.length > maxMember || unpacked > maxTotal) throw formatError("Ukuran isi melampaui kapasitas pemutar.");
    let data = bytes, method = 0;
    if (compress && bytes.length >= 256) {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      const packed = new Uint8Array(await new Response(stream).arrayBuffer());
      if (packed.length < bytes.length) { data = packed; method = 8; }
    }
    const checksum = crc32(bytes);
    const local = header(30), entry = header(46);
    local.u32(0, localSignature);
    entry.u32(0, directorySignature);
    entry.u16(4, 20);
    for (const [record, base] of [[local, 4], [entry, 6]]) {
      record.u16(base, 20);
      record.u16(base + 2, 0x800);
      record.u16(base + 4, method);
      record.u16(base + 6, dosTime);
      record.u16(base + 8, dosDate);
      record.u32(base + 10, checksum);
      record.u32(base + 14, data.length);
      record.u32(base + 18, bytes.length);
      record.u16(base + 22, name.length);
    }
    entry.u32(42, offset);
    central.push(entry.bytes, name);
    parts.push(local.bytes, name, data);
    offset += 30 + name.length + data.length;
    centralLength += 46 + name.length;
    if (offset + centralLength > 0xffffffff) throw formatError("Direktori ZIP terlalu besar.");
  }
  const end = header(22);
  end.u32(0, endSignature);
  end.u16(8, members.length);
  end.u16(10, members.length);
  end.u32(12, centralLength);
  end.u32(16, offset);
  return new Blob([...parts, ...central, end.bytes], { type });
}

async function inflate(data, expected) {
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const result = new Uint8Array(expected);
  let position = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (position + value.length > expected) {
      await reader.cancel();
      throw formatError("Ukuran hasil dekompresi melebihi deklarasi ZIP.");
    }
    result.set(value, position);
    position += value.length;
  }
  if (position !== expected) throw formatError("Isi berkas terpotong.");
  return result;
}

export async function readZip(source) {
  const bytes = await asBytes(source);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = at => view.getUint16(at, true), u32 = at => view.getUint32(at, true);
  let end = bytes.length - 22;
  const first = Math.max(0, end - 65535);
  while (end >= first && (u32(end) !== endSignature || end + 22 + u16(end + 20) !== bytes.length)) end--;
  if (end < first) throw formatError("Penanda akhir ZIP tidak ditemukan.");
  const count = u16(end + 10);
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count || count === 65535)
    throw formatError("ZIP multi-volume atau ZIP64 belum didukung.");
  let pos = u32(end + 16), expanded = 0;
  const directoryStart = pos;
  if (pos + u32(end + 12) !== end) throw formatError("Lokasi direktori tidak sesuai.");
  const files = new Map(), names = new Set();
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || u32(pos) !== directorySignature) throw formatError("Direktori berkas rusak.");
    const flags = u16(pos + 8), method = u16(pos + 10), crc = u32(pos + 16);
    const size = u32(pos + 24), packed = u32(pos + 20);
    const nameLength = u16(pos + 28), local = u32(pos + 42), nameAt = pos + 46;
    pos = nameAt + nameLength + u16(pos + 30) + u16(pos + 32);
    if (pos > end || local + 30 > directoryStart || u32(local) !== localSignature) throw formatError("Header anggota rusak.");
    const name = decodeText(bytes.subarray(nameAt, nameAt + nameLength));
    const isDir = name.endsWith("/");
    if (!safePath(isDir ? name.slice(0, -1) : name) || names.has(name)) throw formatError("Nama berkas tidak sah atau berulang.");
    names.add(name);
    if (flags & 1 || (method !== 0 && method !== 8)) throw formatError("Metode kompresi atau enkripsi ZIP belum didukung.");
    if (u16(local + 6) !== flags || u16(local + 8) !== method) throw formatError("Header lokal dan direktori berbeda.");
    const localNameLength = u16(local + 26);
    const start = local + 30 + localNameLength + u16(local + 28);
    if (start + packed > directoryStart || decodeText(bytes.subarray(local + 30, local + 30 + localNameLength)) !== name)
      throw formatError("Nama atau ukuran berkas lokal tidak cocok.");
    expanded += size;
    if (size > maxMember || expanded > maxTotal) throw formatError("Ukuran isi melampaui kapasitas pemutar.");
    const packedData = bytes.subarray(start, start + packed);
    if (method === 0 && packed !== size) throw formatError("Ukuran anggota tanpa kompresi berbeda.");
    if (isDir && size) throw formatError("Entri direktori berisi data.");
    if (isDir) continue;
    const data = method === 0 ? packedData : await inflate(packedData, size);
    files.set(name, { data, crcOk: crc32(data) === crc });
  }
  if (pos !== end) throw formatError("Jumlah anggota tidak sesuai.");
  return files;
}
