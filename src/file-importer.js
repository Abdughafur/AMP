import { createId } from "./storage.js";
import { parseAudioMetadata } from "./metadata-parser.js";

const SUPPORTED_TYPES = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  flac: "audio/flac",
};

export function validateAudioFile(file, audio = document.createElement("audio")) {
  if (!file.size) return { valid: false, error: "This audio file is empty." };
  const extension = file.name.split(".").pop().toLowerCase();
  const inferredType = SUPPORTED_TYPES[extension];
  if (!inferredType) return { valid: false, error: "Choose an MP3, M4A, AAC, WAV, OGG, or FLAC audio file." };
  const declaredType = file.type || inferredType;
  if (file.type && !file.type.startsWith("audio/") && file.type !== "application/octet-stream") {
    return { valid: false, error: "This file is not identified as audio." };
  }
  if (audio.canPlayType(inferredType) === "" || audio.canPlayType(inferredType) === "no") {
    return { valid: false, error: `This browser may not support ${extension.toUpperCase()} playback.` };
  }
  return { valid: true, mimeType: declaredType, playbackType: inferredType };
}

export async function importAudioFiles(files, repository, onProgress = () => {}) {
  const existing = await repository.listTracks();
  const results = [];
  for (const [index, file] of Array.from(files).entries()) {
    const validation = validateAudioFile(file);
    if (!validation.valid) {
      results.push({ filename: file.name, status: "rejected", message: validation.error });
      onProgress(index + 1, files.length, results[results.length - 1]);
      continue;
    }
    if (existing.some((track) =>
      track.filename === file.name && track.size === file.size && track.lastModified === file.lastModified
    )) {
      results.push({ filename: file.name, status: "duplicate", message: "This exact file is already in your library." });
      onProgress(index + 1, files.length, results[results.length - 1]);
      continue;
    }
    let metadata;
    try {
      metadata = await parseAudioMetadata(file);
    } catch (error) {
      results.push({ filename: file.name, status: "failed", message: `Metadata could not be read: ${error.message}` });
      onProgress(index + 1, files.length, results[results.length - 1]);
      continue;
    }
    const title = metadata.title || file.name.replace(/\.[^/.]+$/, "") || "Untitled audio";
    const track = {
      id: createId(),
      filename: file.name,
      title,
      artist: metadata.artist || "Unknown artist",
      album: metadata.album || "Unknown album",
      duration: 0,
      mimeType: file.type,
      playbackType: validation.playbackType,
      size: file.size,
      lastModified: file.lastModified,
      addedAt: Date.now(),
      lastPlayedAt: null,
      playCount: 0,
      favorite: false,
      fingerprint: null,
      lyrics: "",
    };
    try {
      await repository.addTrack(track, file);
      existing.push(track);
      results.push({ filename: file.name, status: "imported", track });
    } catch (error) {
      results.push({ filename: file.name, status: "failed", message: error.message });
    }
    onProgress(index + 1, files.length, results[results.length - 1]);
  }
  return results;
}
