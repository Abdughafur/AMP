import { AudioEngine } from "../src/audio-engine.js";
import { importAudioFiles, validateAudioFile } from "../src/file-importer.js";
import { QueueManager } from "../src/queue.js";
import { LibraryRepository, openDatabase } from "../src/storage.js";
import { parseAudioMetadata } from "../src/metadata-parser.js";

const results = document.getElementById("results");
const summary = document.getElementById("summary");
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function test(name, callback) {
  const item = document.createElement("li");
  item.textContent = `${name} …`;
  results.append(item);
  try {
    await callback();
    item.className = "pass";
    item.textContent = `${name} — PASS`;
    passed++;
  } catch (error) {
    item.className = "fail";
    item.textContent = `${name} — FAIL: ${error.message}`;
    failed++;
    console.error(name, error);
  }
}

function temporaryName() {
  return `AMP-test-${crypto.randomUUID()}`;
}

function deleteDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Test database is still open."));
  });
}

async function makeRepository(name = temporaryName()) {
  const db = await openDatabase({ name });
  return { db, name, repository: new LibraryRepository(db) };
}

function sampleTrack(id, filename = `${id}.mp3`) {
  return {
    id,
    filename,
    title: id,
    artist: "Test artist",
    album: "Test album",
    duration: 0,
    mimeType: "audio/mpeg",
    playbackType: "audio/mpeg",
    size: 3,
    lastModified: 1,
    addedAt: Date.now(),
    lastPlayedAt: null,
    playCount: 0,
    favorite: false,
    fingerprint: null,
    lyrics: "",
  };
}

await test("Queue navigation, repeat-all, and shuffle avoid immediate repeats", () => {
  const queue = new QueueManager();
  queue.set(["a", "b", "c"], "b");
  assert(queue.currentId() === "b", "The requested start track should be current.");
  assert(queue.next() === "c", "Next should advance in queue order.");
  assert(queue.previous() === "b", "Previous should return to the last track.");
  queue.currentIndex = queue.ids.length - 1;
  queue.repeat = "all";
  queue.shuffle = true;
  const finalTrack = queue.currentId();
  const nextTrack = queue.next();
  assert(nextTrack && nextTrack !== finalTrack, "Shuffle must not immediately repeat the last track.");
});

await test("Audio engine revokes replaced object URLs", async () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const revoked = [];
  let nextUrl = 0;
  URL.createObjectURL = () => `blob:test-${++nextUrl}`;
  URL.revokeObjectURL = (url) => revoked.push(url);
  const fakeAudio = {
    paused: true,
    currentTime: 0,
    duration: 0,
    volume: 1,
    muted: false,
    playbackRate: 1,
    readyState: 0,
    seeking: false,
    addEventListener() {},
    removeEventListener() {},
    pause() { this.paused = true; },
    load() {},
    removeAttribute() {},
    play() { this.paused = false; return Promise.resolve(); },
  };
  try {
    const engine = new AudioEngine(fakeAudio);
    engine.load(new Blob(["first"]));
    engine.load(new Blob(["second"]));
    await engine.play();
    engine.destroy();
    assert(revoked.length === 2, "Both replaced and final object URLs must be revoked.");
    assert(revoked[0] === "blob:test-1" && revoked[1] === "blob:test-2", "URLs should be revoked in order.");
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});

await test("AMP 1 database migration preserves old song data", async () => {
  const name = temporaryName();
  const oldDatabase = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("songs", { keyPath: "name" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const bytes = new Uint8Array([1, 2, 3, 4]);
  await new Promise((resolve, reject) => {
    const transaction = oldDatabase.transaction("songs", "readwrite");
    transaction.objectStore("songs").put({ name: "same.mp3", data: bytes.buffer });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  oldDatabase.close();

  const db = await openDatabase({ name });
  try {
    const repository = new LibraryRepository(db);
    const tracks = await repository.listTracks();
    assert(tracks.length === 1, "The legacy song should be migrated.");
    assert(tracks[0].filename === "same.mp3" && tracks[0].id !== tracks[0].filename, "The filename must not be used as the new ID.");
    const audio = await repository.getAudio(tracks[0].id);
    assert(audio?.blob.size === bytes.length, "The original audio bytes should survive.");
    assert(db.objectStoreNames.contains("songs"), "The old store should remain available for recovery.");
    assert(db.objectStoreNames.contains("audioFiles"), "Binary audio should be stored separately.");
  } finally {
    db.close();
    await deleteDatabase(name);
  }
});

await test("Duplicate filenames coexist; exact re-import is detected", async () => {
  const { db, name, repository } = await makeRepository();
  const originalCreate = document.createElement.bind(document);
  document.createElement = (tagName, options) => {
    if (tagName.toLowerCase() === "audio") return { canPlayType: () => "probably" };
    return originalCreate(tagName, options);
  };
  try {
    const first = new File(["abc"], "duplicate.mp3", { type: "audio/mpeg", lastModified: 100 });
    const second = new File(["abcd"], "duplicate.mp3", { type: "audio/mpeg", lastModified: 200 });
    const results = await importAudioFiles([first, second, first], repository);
    assert(results.filter((item) => item.status === "imported").length === 2, "Distinct files with the same name should both import.");
    assert(results.filter((item) => item.status === "duplicate").length === 1, "Reimporting the same file should be detected.");
    assert((await repository.listTracks()).length === 2, "Both unique records should be stored.");
  } finally {
    document.createElement = originalCreate;
    db.close();
    await deleteDatabase(name);
  }
});

await test("File validation rejects non-audio extensions", () => {
  const invalid = new File(["data"], "notes.txt", { type: "text/plain" });
  assert(!validateAudioFile(invalid, { canPlayType: () => "probably" }).valid, "Text files must not be accepted as audio.");
});

await test("MP3 ID3 title, artist, and album tags are extracted safely", async () => {
  const frame = (id, value) => {
    const text = new TextEncoder().encode(`\0${value}`);
    const header = new Uint8Array(10);
    header.set(new TextEncoder().encode(id));
    new DataView(header.buffer).setUint32(4, text.length);
    return new Uint8Array([...header, ...text]);
  };
  const frames = [frame("TIT2", "Tagged title"), frame("TPE1", "Tagged artist"), frame("TALB", "Tagged album")];
  const tagLength = frames.reduce((sum, item) => sum + item.length, 0);
  const header = new Uint8Array(10);
  header.set([0x49, 0x44, 0x33, 3, 0, 0]);
  header[6] = (tagLength >> 21) & 0x7f;
  header[7] = (tagLength >> 14) & 0x7f;
  header[8] = (tagLength >> 7) & 0x7f;
  header[9] = tagLength & 0x7f;
  const file = new File([header, ...frames], "tags.mp3", { type: "audio/mpeg" });
  const metadata = await parseAudioMetadata(file);
  assert(metadata.title === "Tagged title", "Title tags should be parsed.");
  assert(metadata.artist === "Tagged artist", "Artist tags should be parsed.");
  assert(metadata.album === "Tagged album", "Album tags should be parsed.");
});

await test("Favorites, playlists, deletion, and backup restore stay consistent", async () => {
  const source = await makeRepository();
  const target = await makeRepository();
  try {
    const one = sampleTrack("one", "shared.mp3");
    const two = sampleTrack("two", "shared.mp3");
    await source.repository.addTrack(one, new Blob(["one"], { type: "audio/mpeg" }));
    await source.repository.addTrack(two, new Blob(["two"], { type: "audio/mpeg" }));
    await source.repository.setFavorite("one", true);
    await source.repository.savePlaylist({
      id: "playlist",
      name: "Test playlist",
      description: "",
      trackIds: ["one", "two"],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await source.repository.recordPlay("one");
    const backup = await source.repository.createBackupBlob();
    await target.repository.restoreBackupFile(backup);
    assert((await target.repository.listTracks()).length === 2, "Restore should recover tracks with duplicate filenames.");
    assert((await target.repository.getAudio("one")).blob.size === 3, "Restore should recover audio data.");
    assert((await target.repository.listPlaylists())[0].trackIds.length === 2, "Restore should recover playlists.");
    assert((await target.repository.getTrack("one")).favorite, "Restore should preserve favorites.");
    await target.repository.removeTracks(["one"]);
    assert((await target.repository.listPlaylists())[0].trackIds.join() === "two", "Deleting a track should update playlist references.");
    assert(!(await target.repository.getAudio("one")), "Deleting a track should remove its binary data.");
    assert((await target.repository.listHistory()).length === 0, "Deleting a track should remove its history.");

    let rejected = false;
    try { await target.repository.restoreBackupFile(new Blob(["not a backup"])); } catch { rejected = true; }
    assert(rejected, "Invalid backup files should be rejected.");
    assert((await target.repository.listTracks()).length === 1, "A rejected restore must not alter stored tracks.");
  } finally {
    source.db.close();
    target.db.close();
    await deleteDatabase(source.name);
    await deleteDatabase(target.name);
  }
});

summary.textContent = `${passed} passed · ${failed} failed`;
summary.className = failed ? "fail" : "pass";
