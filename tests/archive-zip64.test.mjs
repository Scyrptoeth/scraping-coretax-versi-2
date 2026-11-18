import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeText, readZip, writeZip } from "../extension/archive/zip.js";

// Python zipfile with ZIP64_LIMIT = 8 wrote these two deflated members.
// Both central entries use ZIP64 sizes, and the second also uses a ZIP64 offset.
const pythonZip64 = Buffer.from(
  "UEsDBC0AAAAIAAAAIVBnohJ1//////////8FABQAYS50eHQBABAADgAAAAAAAAAFAAAAAAAAAHN0RAYA" +
  "UEsDBC0AAAAIAAAAIVCkn9sf//////////8FABQAYi50eHQBABAAEgAAAAAAAAAFAAAAAAAAAHNyQgcA" +
  "UEsBAi0DLQAAAAgAAAAhUGeiEnX//////////wUAFAAAAAAAAAAAAIABAAAAAGEudHh0AQAQAA4AAAAAAAAABQAAAAAAAABQ" +
  "SwECLQMtAAAACAAAACFQpJ/bH///////////BQAcAAAAAAAAAAAAgAH/////Yi50eHQBABgAEgAAAAAAAAAFAAAAAAAAADwAAAAAAAAA" +
  "UEsGBiwAAAAAAAAALQAtAAAAAAAAAAAAAgAAAAAAAAACAAAAAAAAAJYAAAAAAAAAeAAAAAAAAABQSwYHAAAAAA4BAAAAAAAAAQAAAFBLBQYAAAAAAgACAJYAAAB4AAAAAAA=", "base64");

test("read a single-volume ZIP64 written independently, including member extra fields", async () => {
  const files = await readZip(pythonZip64);
  assert.deepEqual([...files.keys()], ["a.txt", "b.txt"]);
  assert.equal(decodeText(files.get("a.txt").data), "A".repeat(14));
  assert.equal(decodeText(files.get("b.txt").data), "B".repeat(18));
  for (const { crcOk } of files.values()) assert.equal(crcOk, true);
});

test("read both the last classic count and the first count requiring ZIP64", async () => {
  const members = Array.from({ length: 65536 }, (_, i) => ({ name: "a/" + i, data: "" }));
  for (const count of [65535, 65536]) {
    const raw = new Uint8Array(await (await writeZip(members.slice(0, count), { compress: false })).arrayBuffer());
    const end = raw.byteLength - 22;
    const view = new DataView(raw.buffer);
    assert.equal(view.getUint16(end + 10, true), 65535);
    assert.equal(view.getUint32(end - 20, true) === 0x07064b50, count > 65535);
    const files = await readZip(raw);
    assert.equal(files.size, count);
    assert.equal(files.get("a/" + (count - 1)).crcOk, true);
  }
});

test("ZIP64 continues enforcing decompression, directory and volume limits", async () => {
  const copy = () => Buffer.from(pythonZip64);
  const end64 = pythonZip64.indexOf(Buffer.from("504b0606", "hex"));
  const central = pythonZip64.indexOf(Buffer.from("504b0102", "hex"));
  const sizes = central + 46 + pythonZip64.readUInt16LE(central + 28) + 4;
  const big = copy(); big.writeBigUInt64LE(256n * 1024n * 1024n + 1n, sizes);
  await assert.rejects(readZip(big), /kapasitas/);
  const short = copy(); short.writeBigUInt64LE(1n, sizes);
  await assert.rejects(readZip(short), /dekompresi/);
  const changedCrc = copy(); changedCrc.writeUInt32LE(1, central + 16);
  assert.equal((await readZip(changedCrc)).get("a.txt").crcOk, false);
  const missing = copy(); missing.writeUInt16LE(0x9999, sizes - 4);
  await assert.rejects(readZip(missing), /ZIP64/);
  const disk = copy(); disk.writeUInt32LE(2, disk.length - 26);
  await assert.rejects(readZip(disk), /multi-volume/);
  const memberDisk = copy(); memberDisk.writeUInt16LE(1, central + 34);
  await assert.rejects(readZip(memberDisk), /multi-volume/);
  const count = copy(); count.writeBigUInt64LE(200001n, end64 + 24); count.writeBigUInt64LE(200001n, end64 + 32);
  count.writeUInt16LE(65535, count.length - 14); count.writeUInt16LE(65535, count.length - 12);
  await assert.rejects(readZip(count), /Jumlah anggota|Jumlah berkas/);
  const offset = copy(); offset.writeBigUInt64LE(9007199254740993n, offset.length - 34);
  await assert.rejects(readZip(offset), /ZIP64/);
});
