function decodeText(data) {
  if (!data.length) return "";
  const encoding = data[0];
  const payload = data.subarray(1);
  let decoder;
  if (encoding === 1) decoder = new TextDecoder("utf-16");
  else if (encoding === 2) decoder = new TextDecoder("utf-16be");
  else if (encoding === 3) decoder = new TextDecoder("utf-8");
  else decoder = new TextDecoder("windows-1252");
  return decoder.decode(payload).replace(/\0+$/g, "").trim();
}

function readSynchsafe(bytes, start) {
  return (bytes[start] << 21) | (bytes[start + 1] << 14) | (bytes[start + 2] << 7) | bytes[start + 3];
}

export async function parseAudioMetadata(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  if (extension !== "mp3") return {};

  const bytes = new Uint8Array(await file.slice(0, 4 * 1024 * 1024).arrayBuffer());
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return {};
  const version = bytes[3];
  if (version < 2 || version > 4) return {};
  const tagSize = readSynchsafe(bytes, 6);
  const end = Math.min(10 + tagSize, bytes.length);
  const frameHeaderSize = version === 2 ? 6 : 10;
  const result = {};
  const titleFrames = new Set(version === 2 ? ["TT2"] : ["TIT2"]);
  const artistFrames = new Set(version === 2 ? ["TP1"] : ["TPE1"]);
  const albumFrames = new Set(version === 2 ? ["TAL"] : ["TALB"]);

  for (let offset = 10; offset + frameHeaderSize <= end;) {
    const frameId = String.fromCharCode(...bytes.subarray(offset, offset + (version === 2 ? 3 : 4)));
    if (!frameId.trim() || frameId.startsWith("\0")) break;
    const size = version === 2
      ? (bytes[offset + 3] << 16) | (bytes[offset + 4] << 8) | bytes[offset + 5]
      : version === 4
        ? readSynchsafe(bytes, offset + 4)
        : new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0);
    if (!Number.isSafeInteger(size) || size <= 0 || offset + frameHeaderSize + size > end) break;
    const value = decodeText(bytes.subarray(offset + frameHeaderSize, offset + frameHeaderSize + size));
    if (titleFrames.has(frameId)) result.title = value;
    else if (artistFrames.has(frameId)) result.artist = value;
    else if (albumFrames.has(frameId)) result.album = value;
    offset += frameHeaderSize + size;
  }
  return result;
}
