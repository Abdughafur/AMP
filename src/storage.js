const DATABASE_NAME = "InfinityEliteDB";
const DATABASE_VERSION = 2;

const requestValue = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });

const transactionDone = (transaction) =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction was aborted."));
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
  });

async function transact(db, stores, mode, action) {
  const transaction = db.transaction(stores, mode);
  const done = transactionDone(transaction);
  try {
    const result = await action(transaction);
    await done;
    return result;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // The transaction may already have completed or aborted.
    }
    await done.catch(() => {});
    if (error && error.name === "QuotaExceededError") {
      throw new Error("Browser storage is full. Export a backup or free storage space, then try again.", { cause: error });
    }
    throw error;
  }
}

function createId() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function legacyMimeType(filename) {
  const extension = filename.split(".").pop().toLowerCase();
  return extension === "m4a" ? "audio/mp4" : "audio/mpeg";
}

function createTrackStore(db) {
  const store = db.createObjectStore("tracks", { keyPath: "id" });
  store.createIndex("title", "title");
  store.createIndex("addedAt", "addedAt");
  store.createIndex("favorite", "favorite");
  store.createIndex("fingerprint", "fingerprint");
}

function migrateLegacySongs(event, db) {
  if (!db.objectStoreNames.contains("songs")) return;
  const transaction = event.target.transaction;
  const legacyStore = transaction.objectStore("songs");
  const tracks = transaction.objectStore("tracks");
  const audioFiles = transaction.objectStore("audioFiles");
  const cursorRequest = legacyStore.openCursor();

  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;

    const oldSong = cursor.value;
    const filename = String(oldSong.name || "Untitled audio");
    const title = filename.replace(/\.[^/.]+$/, "") || "Untitled audio";
    const mimeType = legacyMimeType(filename);
    const data = oldSong.data instanceof Blob
      ? oldSong.data
      : new Blob([oldSong.data], { type: mimeType });
    const id = createId();

    tracks.add({
      id,
      filename,
      title,
      artist: "Unknown artist",
      album: "Unknown album",
      duration: 0,
      mimeType,
      size: data.size,
      addedAt: Date.now(),
      lastPlayedAt: null,
      playCount: 0,
      favorite: false,
      fingerprint: null,
      legacy: true,
    });
    audioFiles.add({ trackId: id, blob: data, mimeType });
    cursor.continue();
  };
};

export function openDatabase({ indexedDB = globalThis.indexedDB, name = DATABASE_NAME } = {}) {
  if (!indexedDB) return Promise.reject(new Error("IndexedDB is unavailable in this browser."));

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DATABASE_VERSION);
    let blocked = false;
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains("tracks")) createTrackStore(db);
      if (!db.objectStoreNames.contains("audioFiles")) {
        db.createObjectStore("audioFiles", { keyPath: "trackId" });
      }
      if (!db.objectStoreNames.contains("playlists")) {
        db.createObjectStore("playlists", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("favorites")) {
        db.createObjectStore("favorites", { keyPath: "trackId" });
      }
      if (!db.objectStoreNames.contains("history")) {
        const history = db.createObjectStore("history", { keyPath: "id" });
        history.createIndex("playedAt", "playedAt");
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }

      if (event.oldVersion < 2) migrateLegacySongs(event, db);
    };
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Close other AMP tabs to finish the safe library upgrade."));
    };
    request.onerror = () => reject(request.error || new Error("Could not open the music library."));
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) {
        db.close();
        return;
      }
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

export class LibraryRepository {
  constructor(db) {
    this.db = db;
  }

  async listTracks() {
    const tx = this.db.transaction("tracks", "readonly");
    const done = transactionDone(tx);
    const tracks = await requestValue(tx.objectStore("tracks").getAll());
    await done;
    return tracks.sort((a, b) => b.addedAt - a.addedAt);
  }

  async getTrack(id) {
    const tx = this.db.transaction("tracks", "readonly");
    const done = transactionDone(tx);
    const track = await requestValue(tx.objectStore("tracks").get(id));
    await done;
    return track || null;
  }

  async getAudio(id) {
    const tx = this.db.transaction("audioFiles", "readonly");
    const done = transactionDone(tx);
    const record = await requestValue(tx.objectStore("audioFiles").get(id));
    await done;
    return record || null;
  }

  async addTrack(track, blob) {
    return transact(this.db, ["tracks", "audioFiles"], "readwrite", async (tx) => {
      await requestValue(tx.objectStore("tracks").add(track));
      await requestValue(tx.objectStore("audioFiles").add({
        trackId: track.id,
        blob,
        mimeType: track.mimeType,
      }));
      return track;
    });
  }

  async updateTrack(track) {
    return transact(this.db, "tracks", "readwrite", (tx) =>
      requestValue(tx.objectStore("tracks").put(track)),
    );
  }

  async updateTrackMetadata(id, patch) {
    return transact(this.db, "tracks", "readwrite", async (tx) => {
      const store = tx.objectStore("tracks");
      const track = await requestValue(store.get(id));
      if (!track) throw new Error("Track no longer exists.");
      return requestValue(store.put({ ...track, ...patch, id }));
    });
  }

  async removeTracks(ids) {
    return transact(
      this.db,
      ["tracks", "audioFiles", "favorites", "history", "playlists"],
      "readwrite",
      async (tx) => {
        const idSet = new Set(ids);
        const tracks = tx.objectStore("tracks");
        const audio = tx.objectStore("audioFiles");
        const favorites = tx.objectStore("favorites");
        const history = tx.objectStore("history");
        const playlists = tx.objectStore("playlists");
        for (const id of idSet) {
          tracks.delete(id);
          audio.delete(id);
          favorites.delete(id);
        }

        const [allPlaylists, allHistory] = await Promise.all([
          requestValue(playlists.getAll()),
          requestValue(history.getAll()),
        ]);
        for (const playlist of allPlaylists) {
          if (!Array.isArray(playlist.trackIds)) continue;
          const nextTrackIds = playlist.trackIds.filter((id) => !idSet.has(id));
          if (nextTrackIds.length !== playlist.trackIds.length) {
            playlists.put({ ...playlist, trackIds: nextTrackIds, updatedAt: Date.now() });
          }
        }
        for (const item of allHistory) {
          if (idSet.has(item.trackId)) history.delete(item.id);
        }
      },
    );
  }

  async listPlaylists() {
    const tx = this.db.transaction("playlists", "readonly");
    const done = transactionDone(tx);
    const result = await requestValue(tx.objectStore("playlists").getAll());
    await done;
    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async listHistory() {
    const tx = this.db.transaction("history", "readonly");
    const done = transactionDone(tx);
    const result = await requestValue(tx.objectStore("history").getAll());
    await done;
    return result.sort((a, b) => b.playedAt - a.playedAt);
  }

  async clearHistory() {
    return transact(this.db, "history", "readwrite", (tx) =>
      requestValue(tx.objectStore("history").clear()),
    );
  }

  async savePlaylist(playlist) {
    return transact(this.db, "playlists", "readwrite", (tx) =>
      requestValue(tx.objectStore("playlists").put(playlist)),
    );
  }

  async deletePlaylist(id) {
    return transact(this.db, "playlists", "readwrite", (tx) =>
      requestValue(tx.objectStore("playlists").delete(id)),
    );
  }

  async setFavorite(trackId, favorite) {
    return transact(this.db, ["tracks", "favorites"], "readwrite", async (tx) => {
      const trackStore = tx.objectStore("tracks");
      const track = await requestValue(trackStore.get(trackId));
      if (!track) throw new Error("Track no longer exists.");
      track.favorite = favorite;
      trackStore.put(track);
      const favorites = tx.objectStore("favorites");
      if (favorite) favorites.put({ trackId, addedAt: Date.now() });
      else favorites.delete(trackId);
    });
  }

  async recordPlay(trackId) {
    return transact(this.db, ["tracks", "history"], "readwrite", async (tx) => {
      const trackStore = tx.objectStore("tracks");
      const track = await requestValue(trackStore.get(trackId));
      if (!track) return;
      const playedAt = Date.now();
      track.lastPlayedAt = playedAt;
      track.playCount = (track.playCount || 0) + 1;
      trackStore.put(track);
      tx.objectStore("history").add({ id: createId(), trackId, playedAt });
    });
  }

  async getSetting(key) {
    const tx = this.db.transaction("settings", "readonly");
    const done = transactionDone(tx);
    const record = await requestValue(tx.objectStore("settings").get(key));
    await done;
    return record ? record.value : undefined;
  }

  async setSetting(key, value) {
    return transact(this.db, "settings", "readwrite", (tx) =>
      requestValue(tx.objectStore("settings").put({ key, value })),
    );
  }

  async createBackupBlob() {
    const tracks = await this.listTracks();
    const playlists = await this.listPlaylists();
    const audio = [];
    for (const track of tracks) {
      const record = await this.getAudio(track.id);
      if (!record) throw new Error(`Audio data is missing for "${track.title}".`);
      audio.push(record);
    }
    const manifest = {
      format: "amp-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      tracks,
      playlists,
      audio: tracks.map((track, index) => ({
        trackId: track.id,
        mimeType: audio[index].mimeType || "",
        size: audio[index].blob.size,
      })),
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    if (manifestBytes.byteLength > 16 * 1024 * 1024) throw new Error("Library metadata is too large to export.");
    const header = new Uint8Array(12);
    header.set(new TextEncoder().encode("AMPBACK1"));
    new DataView(header.buffer).setUint32(8, manifestBytes.byteLength);
    return new Blob([header, manifestBytes, ...audio.map((record) => record.blob)], { type: "application/vnd.amp.backup" });
  }

  async restoreBackupFile(file) {
    if (!file || file.size < 12) throw new Error("The selected backup file is incomplete.");
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (new TextDecoder().decode(header.slice(0, 8)) !== "AMPBACK1") {
      throw new Error("This is not a supported AMP backup.");
    }
    const manifestLength = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(8);
    if (manifestLength > 16 * 1024 * 1024 || 12 + manifestLength > file.size) {
      throw new Error("The backup manifest is invalid or too large.");
    }
    let backup;
    try {
      backup = JSON.parse(await file.slice(12, 12 + manifestLength).text());
    } catch (error) {
      throw new Error("The backup metadata could not be read.", { cause: error });
    }
    if (
      !backup || backup.format !== "amp-backup" || backup.version !== 1 ||
      !Array.isArray(backup.tracks) || !Array.isArray(backup.playlists) || !Array.isArray(backup.audio)
    ) {
      throw new Error("This is not a supported AMP backup.");
    }

    const trackIds = new Set();
    const audioById = new Map();
    let offset = 12 + manifestLength;
    for (const item of backup.audio) {
      if (!item || typeof item.trackId !== "string" || !Number.isSafeInteger(item.size) || item.size < 0 ||
        audioById.has(item.trackId) || offset + item.size > file.size) {
        throw new Error("The backup contains invalid audio entries.");
      }
      audioById.set(item.trackId, {
        blob: file.slice(offset, offset + item.size, typeof item.mimeType === "string" ? item.mimeType : ""),
        mimeType: typeof item.mimeType === "string" ? item.mimeType : "",
      });
      offset += item.size;
    }
    if (offset !== file.size || backup.audio.length !== backup.tracks.length) {
      throw new Error("The backup audio data does not match its track list.");
    }

    const tracks = backup.tracks.map((track) => {
      if (
        !track || typeof track.id !== "string" || !track.id || track.id.length > 200 ||
        typeof track.title !== "string" || track.title.length > 160 || trackIds.has(track.id) ||
        (track.filename !== undefined && (typeof track.filename !== "string" || track.filename.length > 1024)) ||
        (track.artist !== undefined && (typeof track.artist !== "string" || track.artist.length > 160)) ||
        (track.album !== undefined && (typeof track.album !== "string" || track.album.length > 160)) ||
        (track.lyrics !== undefined && (typeof track.lyrics !== "string" || track.lyrics.length > 200000)) ||
        (track.duration !== undefined && (!Number.isFinite(track.duration) || track.duration < 0)) ||
        (track.size !== undefined && (!Number.isSafeInteger(track.size) || track.size < 0)) ||
        (track.favorite !== undefined && typeof track.favorite !== "boolean")
      ) {
        throw new Error("The backup contains invalid track metadata.");
      }
      trackIds.add(track.id);
      const audio = audioById.get(track.id);
      if (!audio || (track.size !== undefined && audio.blob.size !== track.size)) {
        throw new Error(`The backup is missing valid audio for "${track.title}".`);
      }
      return {
        track: {
          id: track.id,
          filename: typeof track.filename === "string" ? track.filename : track.title,
          title: track.title,
          artist: typeof track.artist === "string" ? track.artist : "Unknown artist",
          album: typeof track.album === "string" ? track.album : "Unknown album",
          duration: Number.isFinite(track.duration) ? track.duration : 0,
          mimeType: typeof track.mimeType === "string" ? track.mimeType : audio.mimeType,
          playbackType: typeof track.playbackType === "string" ? track.playbackType : "",
          size: audio.blob.size,
          lastModified: Number.isFinite(track.lastModified) ? track.lastModified : 0,
          addedAt: Number.isFinite(track.addedAt) ? track.addedAt : Date.now(),
          lastPlayedAt: Number.isFinite(track.lastPlayedAt) ? track.lastPlayedAt : null,
          playCount: Number.isSafeInteger(track.playCount) && track.playCount >= 0 ? track.playCount : 0,
          favorite: Boolean(track.favorite),
          fingerprint: null,
          lyrics: typeof track.lyrics === "string" ? track.lyrics : "",
        },
        audio,
      };
    });

    const playlistIds = new Set();
    for (const playlist of backup.playlists) {
      if (!playlist || typeof playlist.id !== "string" || !playlist.id || playlistIds.has(playlist.id) ||
        playlist.id.length > 200 || typeof playlist.name !== "string" || !playlist.name.trim() ||
        playlist.name.length > 80 ||
        (playlist.description !== undefined && (typeof playlist.description !== "string" || playlist.description.length > 300)) ||
        !Array.isArray(playlist.trackIds) || playlist.trackIds.length > 10000 ||
        !playlist.trackIds.every((id) => trackIds.has(id))) {
        throw new Error("The backup contains an invalid playlist.");
      }
      playlistIds.add(playlist.id);
    }

    return transact(this.db, ["tracks", "audioFiles", "playlists", "favorites"], "readwrite", async (tx) => {
      const trackStore = tx.objectStore("tracks");
      const audioStore = tx.objectStore("audioFiles");
      const playlistStore = tx.objectStore("playlists");
      const favorites = tx.objectStore("favorites");
      for (const { track, audio } of tracks) {
        trackStore.put(track);
        audioStore.put({ trackId: track.id, blob: audio.blob, mimeType: audio.mimeType });
        if (track.favorite) favorites.put({ trackId: track.id, addedAt: track.addedAt || Date.now() });
      }
      for (const playlist of backup.playlists) {
        playlistStore.put({
          id: playlist.id,
          name: playlist.name,
          description: typeof playlist.description === "string" ? playlist.description : "",
          trackIds: [...playlist.trackIds],
          createdAt: Number.isFinite(playlist.createdAt) ? playlist.createdAt : Date.now(),
          updatedAt: Number.isFinite(playlist.updatedAt) ? playlist.updatedAt : Date.now(),
        });
      }
    });
  }
}

export { createId };
