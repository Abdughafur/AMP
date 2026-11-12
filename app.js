import { AudioEngine } from "./src/audio-engine.js";
import { EQUALIZER_PRESETS, Equalizer } from "./src/equalizer.js";
import { importAudioFiles } from "./src/file-importer.js";
import { QueueManager } from "./src/queue.js";
import { LibraryRepository, openDatabase, createId } from "./src/storage.js";

const byId = (id) => document.getElementById(id);
const make = (tag, className = "", text = "") => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== "") node.textContent = text;
  return node;
};
const formatTime = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
};

const ui = {
  audio: byId("audio-player"),
  content: byId("page-content"),
  title: byId("page-title"),
  search: byId("search-input"),
  importInput: byId("audio-files"),
  backupInput: byId("backup-file"),
  playlistInput: byId("playlist-file"),
  overlay: byId("drop-overlay"),
  queuePanel: byId("queue-panel"),
  queueList: byId("queue-list"),
  queueCount: byId("queue-count"),
  dockTitle: byId("dock-title"),
  dockArtist: byId("dock-artist"),
  dockArtwork: byId("dock-artwork"),
  largeArtwork: byId("large-artwork"),
  largeTitle: byId("large-title"),
  largeArtist: byId("large-artist"),
  lyricsPanel: byId("lyrics-panel"),
  nowPlaying: byId("now-playing-screen"),
  playButton: byId("play-button"),
  seek: [byId("seek-input"), byId("large-seek-input")],
  currentTime: [byId("current-time"), byId("large-current-time")],
  durationTime: [byId("duration-time"), byId("large-duration-time")],
  volume: byId("volume-input"),
  mute: byId("mute-button"),
  speed: byId("speed-select"),
  connectionDot: byId("connection-dot"),
  connectionTitle: byId("connection-title"),
  connectionLabel: byId("connection-label"),
  storagePercent: byId("storage-percent"),
  storageProgress: byId("storage-progress"),
  storageLabel: byId("storage-label"),
  toastRegion: byId("toast-region"),
  playlistDialog: byId("playlist-dialog"),
  playlistForm: byId("playlist-form"),
  playlistName: byId("playlist-name"),
  playlistDescription: byId("playlist-description"),
  confirmDialog: byId("confirm-dialog"),
  confirmForm: byId("confirm-form"),
};

const engine = new AudioEngine(ui.audio);
const equalizer = new Equalizer(ui.audio);
let repository;
let tracks = [];
let playlists = [];
let history = [];
let page = "home";
let activePlaylistId = null;
let collectionFilter = null;
let currentTrackId = null;
let activeTrackIds = [];
let pendingPlaylistId = null;
let loadSequence = 0;
let sleepTimerId = 0;
let stopAfterTrack = false;
let visualizerOn = false;
let equalizerGains = { bass: 0, mid: 0, treble: 0 };
let lastPlayerTrackKey = "";
let queue = new QueueManager();
let settings = { theme: "dark", volume: 0.8, speed: 1 };

function notify(message, type = "info") {
  const toast = make(
    "div",
    `toast${type === "error" ? " is-error" : ""}`,
    message,
  );
  ui.toastRegion.appendChild(toast);
  window.setTimeout(() => toast.remove(), 4800);
}

function showError(error, prefix = "Something went wrong") {
  const message = error instanceof Error ? error.message : String(error);
  notify(`${prefix}: ${message}`, "error");
}

function button(text, action, label, className = "icon-button", extra = {}) {
  const element = make("button", className, text);
  element.type = "button";
  element.dataset.action = action;
  element.setAttribute("aria-label", label);
  for (const [key, value] of Object.entries(extra))
    element.dataset[key] = value;
  return element;
}

function pageLabel(id) {
  return (
    {
      home: "Your music",
      library: "Your library",
      playlists: "Playlists",
      albums: "Albums",
      artists: "Artists",
      favorites: "Favorites",
      recent: "Recently played",
      settings: "Settings",
    }[id] || "Your music"
  );
}

function setNavigation() {
  document.querySelectorAll("[data-page]").forEach((item) => {
    const active = item.dataset.page === page;
    item.classList.toggle("is-active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
}

function setPage(nextPage) {
  page = nextPage;
  activePlaylistId = null;
  collectionFilter = null;
  ui.search.value = "";
  setNavigation();
  render();
}

function emptyState(title, message, actionText = "", action = "") {
  const state = make("div", "empty-state");
  state.append(
    make("span", "empty-symbol", "♫"),
    make("h2", "", title),
    make("p", "", message),
  );
  if (actionText)
    state.append(
      button(actionText, action, actionText, "button button-primary"),
    );
  return state;
}

function artwork(className = "artwork", track = null) {
  const art = make("div", className);
  art.setAttribute("aria-hidden", "true");
  if (track) {
    let hash = 0;
    for (const character of track.id)
      hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    art.classList.add(`artwork-tone-${hash % 6}`);
    art.append(
      make("span", "cover-initial", (track.title || "♫").trim().charAt(0).toUpperCase()),
    );
  } else art.append(make("span", "", "♫"));
  return art;
}

function filteredTracks() {
  let list = [...tracks];
  if (page === "favorites") list = list.filter((track) => track.favorite);
  if (page === "recent") {
    const seen = new Set();
    const recentIds = history
      .filter((item) => {
        if (seen.has(item.trackId)) return false;
        seen.add(item.trackId);
        return true;
      })
      .map((item) => item.trackId);
    list = recentIds
      .map((id) => tracks.find((track) => track.id === id))
      .filter(Boolean);
  }
  if (collectionFilter) {
    list = list.filter(
      (track) => track[collectionFilter.key] === collectionFilter.value,
    );
  }
  const term = ui.search.value.trim().toLocaleLowerCase();
  if (term) {
    list = tracks.filter((track) =>
      [track.title, track.artist, track.album, track.filename].some((value) =>
        String(value || "")
          .toLocaleLowerCase()
          .includes(term),
      ),
    );
  }
  return list;
}

function renderTrackRow(track, index, list) {
  const row = make(
    "article",
    `track-row${track.id === currentTrackId ? " is-current" : ""}`,
  );
  row.dataset.trackId = track.id;
  const order = make("span", "track-index", String(index + 1).padStart(2, "0"));
  const main = make("div", "track-main");
  main.append(artwork("artwork", track));
  const titleButton = make("button", "track-title-button");
  titleButton.type = "button";
  titleButton.dataset.action = "play-track";
  titleButton.dataset.trackId = track.id;
  const copy = make("span", "track-copy");
  copy.append(
    make("strong", "", track.title),
    make("span", "", track.artist || "Unknown artist"),
  );
  titleButton.append(copy);
  main.append(titleButton);

  const album = make("span", "track-album", track.album || "Unknown album");
  album.title = album.textContent;
  const duration = make("span", "track-duration", formatTime(track.duration));
  const actions = make("div", "track-actions");
  const favorite = button(
    track.favorite ? "♥" : "♡",
    "favorite",
    track.favorite ? "Remove from favorites" : "Add to favorites",
    "icon-button",
    { trackId: track.id },
  );
  if (track.favorite) favorite.classList.add("favorite-on");
  favorite.setAttribute("aria-pressed", String(Boolean(track.favorite)));
  actions.append(
    favorite,
    button("＋", "add-queue", "Add to queue", "icon-button", {
      trackId: track.id,
    }),
    button("✎", "edit-track", "Edit track details", "icon-button", {
      trackId: track.id,
    }),
    button("×", "delete-track", "Delete track", "icon-button", {
      trackId: track.id,
    }),
  );
  row.append(order, main, album, duration, actions);
  row.addEventListener("dblclick", (event) => {
    if (!event.target.closest("button"))
      startTrack(track.id, list).catch((error) =>
        showError(error, "Could not play track"),
      );
  });
  return row;
}

function renderTrackList(list, options = {}) {
  const section = make("section", "track-list");
  activeTrackIds = [];
  const sorted = [...list];
  if (options.sort === "title")
    sorted.sort((a, b) => a.title.localeCompare(b.title));
  if (options.sort === "artist")
    sorted.sort(
      (a, b) =>
        a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title),
    );
  if (options.sort === "recent")
    sorted.sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0));
  if (!sorted.length) {
    return emptyState(
      options.emptyTitle || "No tracks here yet",
      options.emptyMessage ||
        "Import music from your device. Your files stay in this browser.",
      options.allowImport === false ? "" : "Add music",
      "import",
    );
  }
  activeTrackIds = sorted.map((track) => track.id);
  sorted.forEach((track, index) =>
    section.append(renderTrackRow(track, index, activeTrackIds)),
  );
  return section;
}

function renderHome() {
  const fragment = document.createDocumentFragment();
  const welcome = make("section", "welcome-panel");
  const copy = make("div", "welcome-copy");
  const featured = [...tracks].sort((a, b) => b.addedAt - a.addedAt)[0];
  copy.append(
    make("p", "hero-kicker", tracks.length ? "✦ YOUR PERSONAL MUSIC SPACE" : "✦ A PRIVATE SPACE FOR YOUR SOUND"),
    make("h2", "", tracks.length ? "Good evening." : "Bring your music home."),
    make(
      "p",
      "",
      tracks.length
        ? `${tracks.length} ${tracks.length === 1 ? "track" : "tracks"} ready when you are. Your music stays on this device.`
        : "Make a little room for the music you love. Your files stay yours.",
    ),
  );
  const heroActions = make("div", "hero-actions");
  const playAll = button("▶  Play your music", "play-all", "Play your music", "button button-primary");
  const shuffle = button("⤨", "shuffle-play", "Shuffle your library", "icon-button hero-shuffle");
  playAll.disabled = !tracks.length;
  shuffle.disabled = !tracks.length;
  heroActions.append(playAll, shuffle);
  copy.append(heroActions);
  const visual = make("div", "hero-visual");
  visual.append(
    make("span", "hero-orbit orbit-one"),
    make("span", "hero-orbit orbit-two"),
    make("span", "hero-wave", "♫"),
  );
  if (featured) {
    const featureCard = make("div", "hero-feature");
    const featureArt = artwork("artwork hero-feature-art", featured);
    const featureInfo = make("span", "hero-feature-info");
    featureInfo.append(
      make("strong", "", featured.title),
      make("small", "", featured.artist || "Unknown artist"),
    );
    featureCard.append(
      featureArt,
      featureInfo,
      button("▶", "play-track", "Play featured track", "hero-feature-play", {
        trackId: featured.id,
      }),
    );
    visual.append(featureCard);
  } else visual.append(make("span", "hero-note", "♫"));
  welcome.append(copy, visual);
  fragment.append(welcome);

  const columns = make("div", "home-columns");
  const primary = make("div", "home-primary");
  const quickActions = make("section", "quick-actions");
  const actionCards = [
    { title: "Create playlist", detail: "Gather your favorites", icon: "♫", action: "new-playlist" },
    { title: "Your favorites", detail: `${tracks.filter((track) => track.favorite).length} loved tracks`, icon: "♡", page: "favorites" },
    { title: "Recently played", detail: `${history.length} listening moments`, icon: "◷", page: "recent" },
    { title: "Your stats", detail: `${tracks.reduce((sum, track) => sum + (track.playCount || 0), 0)} plays`, icon: "▥", page: "settings" },
    { title: "Backup library", detail: "Keep a safe copy", icon: "⇧", action: "export-backup" },
  ];
  for (const item of actionCards) {
    const card = make("button", "quick-card");
    card.type = "button";
    if (item.page) card.dataset.page = item.page;
    else card.dataset.action = item.action;
    const cardCopy = make("span", "quick-copy");
    cardCopy.append(
      make("strong", "", item.title),
      make("small", "", item.detail),
    );
    card.append(
      make("span", "quick-icon", item.icon),
      cardCopy,
      make("span", "quick-arrow", "›"),
    );
    quickActions.append(card);
  }
  primary.append(quickActions);

  const recent = [...tracks].sort((a, b) => b.addedAt - a.addedAt).slice(0, 10);
  const heading = make("div", "section-heading home-section-heading");
  const headingCopy = make("div");
  headingCopy.append(
    make("h2", "", "Recently added"),
    make("p", "", "Fresh from your library"),
  );
  heading.append(
    headingCopy,
    button("View all  →", "navigate", "View all tracks", "text-button", {
      page: "library",
    }),
  );
  const shelf = make("div", "music-shelf");
  if (recent.length) {
    for (const track of recent) {
      const card = make("article", "music-card");
      const artButton = make("button", "music-card-cover");
      artButton.type = "button";
      artButton.dataset.action = "play-track";
      artButton.dataset.trackId = track.id;
      artButton.setAttribute("aria-label", `Play ${track.title}`);
      const cover = artwork("artwork music-card-art", track);
      cover.append(make("span", "cover-play", "▶"));
      artButton.append(cover);
      const favorite = button(
        track.favorite ? "♥" : "♡",
        "favorite",
        track.favorite ? "Remove from favorites" : "Add to favorites",
        "music-card-favorite",
        { trackId: track.id },
      );
      card.append(
        artButton,
        favorite,
        make("strong", "music-card-title", track.title),
        make("span", "music-card-artist", track.artist || "Unknown artist"),
      );
      shelf.append(card);
    }
  } else {
    shelf.append(
      emptyState(
        "Your library is ready",
        "Add local audio files to start building your collection.",
        "Add music",
        "import",
      ),
    );
  }
  primary.append(heading, shelf);

  const queuePreview = make("section", "home-queue-card");
  const queueHeading = make("div", "queue-preview-heading");
  const queueTitle = make("div");
  queueTitle.append(make("p", "eyebrow", "UP NEXT"), make("h2", "", "Playing queue"));
  queueHeading.append(
    queueTitle,
    button("↗", "toggle-queue", "Open full queue", "icon-button"),
  );
  const queueItems = make("ol", "queue-preview-list");
  queueItems.id = "home-queue-items";
  queuePreview.append(queueHeading, queueItems);
  columns.append(primary, queuePreview);
  fragment.append(columns);
  ui.content.replaceChildren(fragment);
  renderHomeQueue();
}

function renderHomeQueue() {
  const list = byId("home-queue-items");
  if (!list) return;
  const visible = queue.ids
    .map((id, index) => ({ id, index, track: tracks.find((item) => item.id === id) }))
    .filter(({ track }) => track)
    .slice(0, 6);
  if (!visible.length) {
    list.replaceChildren(make("li", "queue-preview-empty", "Play a track to start your queue."));
    return;
  }
  list.replaceChildren(...visible.map(({ id, index, track }) => {
    const row = make("li", `queue-preview-item${id === currentTrackId ? " is-current" : ""}`);
    const play = make("button", "queue-preview-play");
    play.type = "button";
    play.dataset.action = "play-queue-item";
    play.dataset.queueIndex = String(index);
    play.append(artwork("artwork queue-preview-art", track));
    const copy = make("span", "queue-preview-copy");
    copy.append(
      make("strong", "", track.title),
      make("small", "", track.artist || "Unknown artist"),
    );
    row.append(play, copy);
    if (id === currentTrackId) row.append(make("span", "playing-bars", "▮▮▮"));
    return row;
  }));
}

function renderCollectionPage(kind) {
  const key = kind === "albums" ? "album" : "artist";
  const label = kind === "albums" ? "album" : "artist";
  if (collectionFilter) {
    const header = make("div", "section-heading");
    header.append(
      make("div", "", ""),
      button(
        "← Back",
        "collection-back",
        "Back to collections",
        "button button-quiet",
      ),
    );
    header.firstChild.append(
      make("h2", "", collectionFilter.value),
      make("p", "", `${label} collection`),
    );
    ui.content.replaceChildren(
      header,
      renderTrackList(filteredTracks(), { allowImport: false }),
    );
    return;
  }
  const grouped = new Map();
  for (const track of tracks) {
    const name = track[key] || `Unknown ${label}`;
    grouped.set(name, (grouped.get(name) || 0) + 1);
  }
  if (!grouped.size) {
    ui.content.replaceChildren(
      emptyState(
        `No ${kind} yet`,
        "Import music with album or artist information to see collections here.",
        "Add music",
        "import",
      ),
    );
    return;
  }
  const grid = make("div", "collection-grid");
  for (const [name, count] of [...grouped].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const card = make("button", "collection-card");
    card.type = "button";
    card.dataset.action = "open-collection";
    card.dataset.key = key;
    card.dataset.value = name;
    card.append(
      artwork(),
      make("strong", "", name),
      make("span", "", `${count} ${count === 1 ? "track" : "tracks"}`),
    );
    grid.append(card);
  }
  ui.content.replaceChildren(grid);
}

function renderPlaylistPage() {
  if (activePlaylistId) {
    const playlist = playlists.find((item) => item.id === activePlaylistId);
    if (!playlist) {
      activePlaylistId = null;
      renderPlaylistPage();
      return;
    }
    const validTracks = playlist.trackIds
      .map((id) => tracks.find((track) => track.id === id))
      .filter(Boolean);
    const heading = make("div", "section-heading");
    const copy = make("div");
    copy.append(
      make("h2", "", playlist.name),
      make("p", "", playlist.description || "A playlist made for you"),
    );
    const actions = make("div", "playlist-heading-actions");
    actions.append(
      button(
        "Play all",
        "play-playlist",
        "Play playlist",
        "button button-primary",
      ),
      button(
        "Add songs",
        "add-playlist-tracks",
        "Add songs to playlist",
        "button button-quiet",
      ),
      button("Export", "export-playlist", "Export playlist", "button button-quiet"),
      button("Edit", "edit-playlist", "Edit playlist", "button button-quiet"),
      button(
        "Delete",
        "delete-playlist",
        "Delete playlist",
        "button button-quiet",
      ),
    );
    heading.append(copy, actions);
    const detail = make(
      "p",
      "details-line",
      `${validTracks.length} ${validTracks.length === 1 ? "track" : "tracks"} · ${playlist.trackIds.length} in playlist`,
    );
    ui.content.replaceChildren(
      heading,
      detail,
      renderTrackList(validTracks, {
        allowImport: false,
        emptyTitle: "This playlist is empty",
        emptyMessage: "Add tracks from your library to get started.",
      }),
    );
    return;
  }

  const heading = make("div", "section-heading");
  const copy = make("div");
  copy.append(
    make("h2", "", "Made for your listening"),
    make(
      "p",
      "",
      `${playlists.length} ${playlists.length === 1 ? "playlist" : "playlists"}`,
    ),
  );
  const playlistActions = make("div", "playlist-heading-actions");
  playlistActions.append(
    button("Import", "import-playlist", "Import playlist", "button button-quiet"),
    button("＋ New playlist", "new-playlist", "Create playlist", "button button-primary"),
  );
  heading.append(copy, playlistActions);
  const grid = make("div", "playlist-grid");
  for (const playlist of playlists) {
    const count = playlist.trackIds.filter((id) =>
      tracks.some((track) => track.id === id),
    ).length;
    const card = make("button", "playlist-card");
    card.type = "button";
    card.dataset.action = "open-playlist";
    card.dataset.playlistId = playlist.id;
    card.append(
      artwork(),
      make("strong", "", playlist.name),
      make("span", "", `${count} ${count === 1 ? "track" : "tracks"}`),
    );
    grid.append(card);
  }
  if (!playlists.length) {
    ui.content.replaceChildren(
      heading,
      emptyState(
        "Create your first playlist",
        "Gather favorite tracks into a collection that stays on this device.",
        "New playlist",
        "new-playlist",
      ),
    );
  } else {
    ui.content.replaceChildren(heading, grid);
  }
}

function renderSettings() {
  const grid = make("div", "settings-grid");

  const appearance = make("section", "setting-card");
  appearance.append(
    make("h2", "", "Appearance"),
    make("p", "", "Choose the look that feels right."),
  );
  const themeToggle = make(
    "button",
    "button button-quiet",
    settings.theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
  );
  themeToggle.type = "button";
  themeToggle.dataset.action = "toggle-theme";
  appearance.append(themeToggle);

  const equalizerCard = make("section", "setting-card");
  equalizerCard.append(
    make("h2", "", "Equalizer"),
    make(
      "p",
      "",
      "Tune local playback with three Web Audio frequency bands.",
    ),
  );
  const preset = make("select", "field-input");
  preset.setAttribute("aria-label", "Equalizer preset");
  preset.dataset.eqPreset = "";
  Object.keys(EQUALIZER_PRESETS).forEach((name) => {
    const option = make("option", "", name);
    option.value = name;
    preset.append(option);
  });
  equalizerCard.append(preset);
  for (const [band, label] of [
    ["bass", "Bass"],
    ["mid", "Midrange"],
    ["treble", "Treble"],
  ]) {
    const wrapper = make("label", "eq-control");
    const range = make("input");
    range.type = "range";
    range.min = "-12";
    range.max = "12";
    range.step = "1";
    range.value = String(equalizerGains[band]);
    range.dataset.eqBand = band;
    const labelText = make("span", "", `${label} · ${equalizerGains[band]} dB`);
    wrapper.append(labelText, range);
    equalizerCard.append(wrapper);
  }

  const backup = make("section", "setting-card");
  backup.append(
    make("h2", "", "Backup & restore"),
    make(
      "p",
      "",
      "Export tracks, playlists, and audio into a portable local backup.",
    ),
  );
  const backupActions = make("div", "setting-actions");
  backupActions.append(
    button(
      "Export backup",
      "export-backup",
      "Export music backup",
      "button button-primary",
    ),
    button(
      "Restore backup",
      "restore-backup",
      "Restore music backup",
      "button button-quiet",
    ),
  );
  backup.append(backupActions);

  const sleep = make("section", "setting-card");
  sleep.append(
    make("h2", "", "Sleep timer"),
    make(
      "p",
      "",
      "Stop playback after a timer or when the current track ends.",
    ),
  );
  const sleepInput = make("input", "field-input");
  sleepInput.type = "number";
  sleepInput.id = "sleep-minutes";
  sleepInput.min = "1";
  sleepInput.max = "240";
  sleepInput.placeholder = "Minutes";
  sleepInput.setAttribute("aria-label", "Sleep timer minutes");
  const sleepActions = make("div", "setting-actions");
  sleepActions.append(
    sleepInput,
    button(
      "Start timer",
      "sleep-timer",
      "Start sleep timer",
      "button button-primary",
    ),
  );
  sleepActions.append(
    button(
      stopAfterTrack ? "Cancel end of track" : "Stop after track",
      "stop-after-track",
      "Toggle stop after current track",
      "button button-quiet",
    ),
  );
  if (sleepTimerId) sleep.append(make("p", "timer-status", "Timer is active."));
  sleep.append(sleepActions);

  const stats = make("section", "setting-card");
  const totalPlays = tracks.reduce(
    (sum, track) => sum + (track.playCount || 0),
    0,
  );
  stats.append(
    make("h2", "", "Listening stats"),
    make("p", "", `${totalPlays} plays across ${tracks.length} tracks.`),
  );
  stats.append(
    button(
      "Clear play history",
      "clear-history",
      "Clear listening history",
      "button button-quiet",
    ),
  );

  const storage = make("section", "setting-card");
  storage.append(
    make("h2", "", "Local storage"),
    make(
      "p",
      "",
      "Your music remains in this browser. Deleting tracks removes their audio and playlist references.",
    ),
  );
  storage.append(
    button(
      "Delete all tracks",
      "delete-all-tracks",
      "Delete all tracks",
      "button button-danger",
    ),
  );

  const info = make("section", "setting-card");
  info.append(
    make("h2", "", "About AMP"),
    make(
      "p",
      "",
      "AMP is a local-first player. Audio is not uploaded or sent to external services.",
    ),
    make(
      "p",
      "",
      `Database: ${tracks.length} tracks · Browser audio support varies by format.`,
    ),
  );
  const install = button(
    "Install AMP",
    "install-app",
    "Install AMP",
    "button button-quiet",
  );
  install.hidden =
    !installPrompt && !window.matchMedia("(display-mode: standalone)").matches;
  info.append(install);

  grid.append(appearance, equalizerCard, backup, sleep, stats, storage, info);
  ui.content.replaceChildren(grid);
}

function render() {
  ui.title.textContent = pageLabel(page);
  setNavigation();
  if (ui.search.value.trim()) {
    ui.title.textContent = "Search results";
    const list = filteredTracks();
    const heading = make("div", "section-heading");
    const copy = make("div");
    copy.append(
      make(
        "h2",
        "",
        `Found ${list.length} ${list.length === 1 ? "track" : "tracks"}`,
      ),
    );
    heading.append(copy);
    ui.content.replaceChildren(
      heading,
      renderTrackList(list, {
        allowImport: false,
        emptyTitle: "No matches",
        emptyMessage: "Try a different title, artist, or album.",
      }),
    );
    return;
  }
  switch (page) {
    case "home":
      renderHome();
      break;
    case "playlists":
      renderPlaylistPage();
      break;
    case "albums":
    case "artists":
      renderCollectionPage(page);
      break;
    case "settings":
      renderSettings();
      break;
    default: {
      const heading = make("div", "section-heading");
      const copy = make("div");
      const list = filteredTracks();
      copy.append(
        make("h2", "", pageLabel(page)),
        make(
          "p",
          "",
          `${list.length} ${list.length === 1 ? "track" : "tracks"}`,
        ),
      );
      heading.append(copy);
      const sort = make("select");
      sort.setAttribute("aria-label", "Sort tracks");
      [
        ["added", "Recently added"],
        ["title", "Title"],
        ["artist", "Artist"],
        ["recent", "Recently played"],
      ].forEach(([value, label]) => {
        const option = make("option", "", label);
        option.value = value;
        sort.append(option);
      });
      sort.addEventListener("change", () => {
        const sorted = renderTrackList(list, {
          sort: sort.value,
          allowImport: false,
        });
        const current = ui.content.querySelector(".track-list, .empty-state");
        if (current) current.replaceWith(sorted);
      });
      heading.append(sort);
      ui.content.replaceChildren(
        heading,
        renderTrackList(list, { allowImport: false, sort: sort.value }),
      );
    }
  }
}

function renderQueue() {
  const upcoming = queue.ids
    .map((id, index) => ({
      id,
      index,
      track: tracks.find((item) => item.id === id),
    }))
    .filter(({ track }) => track);
  ui.queueCount.textContent = `${upcoming.length} ${upcoming.length === 1 ? "track" : "tracks"} in queue`;
  const items = upcoming.map(({ id, index, track }) => {
    const item = make(
      "li",
      `queue-item${id === currentTrackId ? " is-current" : ""}`,
    );
    const copy = make("button", "queue-item-copy");
    copy.type = "button";
    copy.dataset.action = "play-queue-item";
    copy.dataset.queueIndex = String(index);
    copy.append(
      make("strong", "", track.title),
      make("span", "", track.artist || "Unknown artist"),
    );
    item.append(copy);
    if (id !== currentTrackId) {
      item.append(
        button("↑", "move-queue", "Move track up", "icon-button", {
          trackId: id,
          direction: "-1",
        }),
        button("↓", "move-queue", "Move track down", "icon-button", {
          trackId: id,
          direction: "1",
        }),
        button("×", "remove-queue", "Remove from queue", "icon-button", {
          trackId: id,
        }),
      );
    }
    return item;
  });
  ui.queueList.replaceChildren(...items);
  renderHomeQueue();
}

function renderPlayer(state = engine.getState()) {
  const current = tracks.find((track) => track.id === currentTrackId);
  const trackKey = current
    ? [
        current.id,
        current.title,
        current.artist,
        current.favorite,
        current.lyrics,
      ].join("\u0000")
    : "";
  const trackChanged = trackKey !== lastPlayerTrackKey;
  if (trackChanged) lastPlayerTrackKey = trackKey;
  if (trackChanged && current) {
    ui.dockTitle.textContent = current.title;
    ui.dockArtist.textContent = current.artist || "Unknown artist";
    ui.largeTitle.textContent = current.title;
    ui.largeArtist.textContent = current.artist || "Unknown artist";
    document.querySelectorAll(".favorite-button").forEach((favorite) => {
      favorite.textContent = current.favorite ? "♥" : "♡";
      favorite.classList.toggle("is-favorite", Boolean(current.favorite));
      favorite.setAttribute("aria-pressed", String(Boolean(current.favorite)));
      favorite.setAttribute(
        "aria-label",
        current.favorite
          ? "Remove current track from favorites"
          : "Add current track to favorites",
      );
    });
    const lyrics = current.lyrics?.trim();
    ui.lyricsPanel.replaceChildren(
      make("p", "", lyrics || "Lyrics are stored locally with your tracks."),
      button(
        lyrics ? "Edit lyrics" : "Add lyrics",
        "edit-lyrics",
        lyrics ? "Edit lyrics" : "Add lyrics",
        "button button-quiet",
      ),
    );
  } else if (trackChanged && !current) {
    lastPlayerTrackKey = "";
    ui.dockTitle.textContent = "Nothing playing";
    ui.dockArtist.textContent = "Add music to begin";
    ui.largeTitle.textContent = "Nothing playing";
    ui.largeArtist.textContent = "Your library is waiting";
    ui.lyricsPanel.replaceChildren(
      make("p", "", "Lyrics are stored locally with your tracks."),
    );
  }
  const playing = !state.paused;
  document.querySelectorAll('[data-action="play-pause"]').forEach((control) => {
    control.textContent = playing ? "Ⅱ" : "▶";
    control.setAttribute("aria-label", playing ? "Pause" : "Play");
  });
  ui.playButton.setAttribute("aria-pressed", String(playing));
  const duration = state.duration || current?.duration || 0;
  const progress = duration ? (state.currentTime / duration) * 1000 : 0;
  ui.seek.forEach((input) => {
    input.disabled = !current || !duration;
    input.value = String(progress);
  });
  ui.currentTime.forEach((label) => {
    label.textContent = formatTime(state.currentTime);
  });
  ui.durationTime.forEach((label) => {
    label.textContent = formatTime(duration);
  });
  ui.volume.value = String(state.volume);
  ui.mute.setAttribute("aria-label", state.muted ? "Unmute" : "Mute");
  const shuffle = document.querySelector('[data-action="shuffle"]');
  shuffle?.setAttribute("aria-pressed", String(queue.shuffle));
  const repeat = document.querySelector('[data-action="repeat"]');
  repeat?.setAttribute("aria-pressed", String(queue.repeat !== "off"));
  repeat?.setAttribute("aria-label", `Repeat ${queue.repeat}`);
  repeat.textContent = queue.repeat === "one" ? "↻¹" : "↻";
  if (trackChanged && current) {
    ui.dockArtwork.replaceChildren(make("span", "", "♫"));
    ui.largeArtwork.replaceChildren(make("span", "", "♫"));
  }
}

function saveQueue() {
  repository
    .setSetting("queue", {
      ids: queue.ids,
      currentIndex: queue.currentIndex,
      repeat: queue.repeat,
      shuffle: queue.shuffle,
    })
    .catch((error) => showError(error, "Could not save queue"));
}

async function startTrack(trackId, ids = activeTrackIds) {
  const sequence = ++loadSequence;
  const track = tracks.find((item) => item.id === trackId);
  if (!track) throw new Error("Track is no longer in your library.");
  if (!queue.ids.includes(trackId))
    queue.set(
      ids.length ? ids : tracks.map((item) => item.id),
      trackId,
      queue.shuffle,
    );
  else queue.currentIndex = queue.ids.indexOf(trackId);
  renderQueue();
  saveQueue();

  const record = await repository.getAudio(trackId);
  if (sequence !== loadSequence) return;
  if (!record?.blob) throw new Error("Audio data is missing for this track.");
  const playbackType = track.playbackType || record.mimeType || track.mimeType;
  const blob =
    playbackType && record.blob.type !== playbackType
      ? new Blob([record.blob], { type: playbackType })
      : record.blob;
  currentTrackId = trackId;
  render();
  engine.load(blob);
  await engine.play();
  if (sequence !== loadSequence) return;
  try {
    await repository.recordPlay(trackId);
    await reloadLibrary();
  } catch (error) {
    showError(
      error,
      "Playback started, but listening history could not be saved",
    );
  }
  updateMediaSession();
}

async function reloadLibrary() {
  [tracks, playlists, history] = await Promise.all([
    repository.listTracks(),
    repository.listPlaylists(),
    repository.listHistory(),
  ]);
  render();
  renderQueue();
  renderPlayer();
  updateStorageInfo();
}

function updateMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const track = tracks.find((item) => item.id === currentTrackId);
  if (!track) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist || "Unknown artist",
      album: track.album || "",
      artwork: [
        {
          src: new URL("./logo.jpeg", location.href).href,
          sizes: "512x512",
          type: "image/jpeg",
        },
      ],
    });
    navigator.mediaSession.setActionHandler("play", () => togglePlayback());
    navigator.mediaSession.setActionHandler("pause", () => engine.pause());
    navigator.mediaSession.setActionHandler("nexttrack", () => playNext());
    navigator.mediaSession.setActionHandler("previoustrack", () =>
      playPrevious(),
    );
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (Number.isFinite(details.seekTime)) engine.seek(details.seekTime);
    });
  } catch (error) {
    console.warn("Media Session metadata is unavailable.", error);
  }
}

async function togglePlayback() {
  if (!currentTrackId) {
    const first = tracks[0];
    if (first)
      await startTrack(
        first.id,
        tracks.map((track) => track.id),
      );
    else notify("Add music to start listening.");
    return;
  }
  if (ui.audio.paused) {
    try {
      await engine.play();
    } catch (error) {
      showError(error, "Playback could not start");
    }
  } else engine.pause();
}

async function playNext() {
  const nextId = queue.next();
  if (!nextId) {
    engine.pause();
    return;
  }
  await startTrack(nextId, queue.ids);
}

async function playPrevious() {
  if (ui.audio.currentTime > 3) {
    engine.seek(0);
    return;
  }
  const previousId = queue.previous();
  if (previousId) await startTrack(previousId, queue.ids);
}

function setConnectionStatus() {
  const online = navigator.onLine;
  ui.connectionDot.classList.toggle("is-offline", !online);
  ui.connectionTitle.textContent = online ? "Offline mode ready" : "Offline mode";
  ui.connectionLabel.textContent = online
    ? "Your library is on this device"
    : "Local tracks are available";
}

function closeNowPlaying() {
  ui.nowPlaying.hidden = true;
  if (visualizerOn) equalizer.stopVisualizer();
  visualizerOn = false;
  byId("visualizer").hidden = true;
  const control = document.querySelector('[data-action="toggle-visualizer"]');
  if (control) control.textContent = "Show visualizer";
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

async function updateStorageInfo() {
  const trackBytes = tracks.reduce((total, track) => total + (track.size || 0), 0);
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate && Number.isFinite(estimate.quota) && estimate.quota > 0) {
      const usage = estimate.usage || 0;
      const percent = Math.min(100, Math.round((usage / estimate.quota) * 100));
      ui.storagePercent.textContent = `${percent}%`;
      ui.storageProgress.value = percent;
      ui.storageLabel.textContent = `${formatBytes(usage)} of ${formatBytes(estimate.quota)} used`;
      return;
    }
  } catch (error) {
    console.warn("Browser storage estimate is unavailable.", error);
  }
  ui.storagePercent.textContent = formatBytes(trackBytes);
  ui.storageProgress.value = 0;
  ui.storageLabel.textContent = "Audio stored in this library";
}

function openConfirm(title, message, acceptText = "Remove") {
  return new Promise((resolve) => {
    byId("confirm-title").textContent = title;
    byId("confirm-message").textContent = message;
    byId("confirm-accept").textContent = acceptText;
    const closed = () => resolve(ui.confirmDialog.returnValue === "confirm");
    ui.confirmDialog.addEventListener("close", closed, { once: true });
    ui.confirmDialog.showModal();
  });
}

function openPlaylistDialog(playlist = null) {
  pendingPlaylistId = playlist?.id || null;
  byId("playlist-dialog-title").textContent = playlist
    ? "Edit playlist"
    : "New playlist";
  byId("save-playlist-button").textContent = playlist
    ? "Save changes"
    : "Create playlist";
  ui.playlistName.value = playlist?.name || "";
  ui.playlistDescription.value = playlist?.description || "";
  ui.playlistDialog.showModal();
  ui.playlistName.focus();
}

function openLyricsDialog() {
  const track = tracks.find((item) => item.id === currentTrackId);
  if (!track) return notify("Choose a track before adding lyrics.");
  byId("lyrics-input").value = track.lyrics || "";
  byId("lyrics-dialog").showModal();
  byId("lyrics-input").focus();
}

function openAddTracksDialog() {
  const playlist = playlists.find((item) => item.id === activePlaylistId);
  if (!playlist) return;
  const dialog = byId("add-tracks-dialog");
  const list = byId("add-tracks-list");
  const existing = new Set(playlist.trackIds);
  const choices = tracks.filter((track) => !existing.has(track.id));
  list.replaceChildren();
  if (!choices.length)
    list.append(
      emptyState(
        "Everything is here",
        "All library tracks are already in this playlist.",
      ),
    );
  for (const track of choices) {
    const label = make("label", "check-row");
    const checkbox = make("input");
    checkbox.type = "checkbox";
    checkbox.value = track.id;
    label.append(
      checkbox,
      make("span", "", `${track.title} — ${track.artist || "Unknown artist"}`),
    );
    list.append(label);
  }
  dialog.showModal();
}

async function handleAction(action, target) {
  const trackId = target.dataset.trackId;
  const track = tracks.find((item) => item.id === trackId);
  switch (action) {
    case "navigate":
      setPage(target.dataset.page);
      break;
    case "import":
      ui.importInput.click();
      break;
    case "play-track":
      await startTrack(
        trackId,
        activeTrackIds.includes(trackId)
          ? activeTrackIds
          : tracks.map((item) => item.id),
      );
      break;
    case "play-all": {
      const ids = tracks.map((item) => item.id);
      if (ids.length) await startTrack(ids[0], ids);
      break;
    }
    case "shuffle-play": {
      const ids = tracks.map((item) => item.id);
      if (ids.length) {
        queue.shuffle = true;
        const startId = ids[Math.floor(Math.random() * ids.length)];
        queue.set(ids, startId, true);
        await startTrack(queue.currentId(), queue.ids);
      }
      break;
    }
    case "play-pause":
      await togglePlayback();
      break;
    case "next":
      await playNext();
      break;
    case "previous":
      await playPrevious();
      break;
    case "mute":
      ui.audio.muted = !ui.audio.muted;
      renderPlayer();
      break;
    case "favorite":
      if (track) {
        await repository.setFavorite(track.id, !track.favorite);
        await reloadLibrary();
      }
      break;
    case "toggle-current-favorite":
      if (currentTrackId) {
        const current = tracks.find((item) => item.id === currentTrackId);
        await repository.setFavorite(currentTrackId, !current?.favorite);
        await reloadLibrary();
      }
      break;
    case "add-queue":
      if (track && queue.add(track.id)) {
        saveQueue();
        renderQueue();
        ui.queuePanel.hidden = false;
        notify(`Added “${track.title}” to the queue.`);
      } else notify("That track is already in the queue.");
      break;
    case "delete-track":
      if (
        track &&
        (await openConfirm(
          "Delete this track?",
          `“${track.title}” and its local audio will be removed. Playlist references will also be removed.`,
        ))
      ) {
        if (currentTrackId === track.id) {
          loadSequence++;
          engine.releaseSource();
          currentTrackId = null;
        }
        queue.remove(track.id);
        await repository.removeTracks([track.id]);
        await reloadLibrary();
        saveQueue();
        notify("Track deleted.");
      }
      break;
    case "edit-track":
      if (track) openMetadataDialog(track);
      break;
    case "new-playlist":
      openPlaylistDialog();
      break;
    case "open-playlist":
      activePlaylistId = target.dataset.playlistId;
      renderPlaylistPage();
      break;
    case "edit-playlist":
      openPlaylistDialog(
        playlists.find((item) => item.id === activePlaylistId),
      );
      break;
    case "delete-playlist": {
      const playlist = playlists.find((item) => item.id === activePlaylistId);
      if (
        playlist &&
        (await openConfirm(
          "Delete this playlist?",
          `“${playlist.name}” will be deleted. Its tracks will stay in your library.`,
        ))
      ) {
        await repository.deletePlaylist(playlist.id);
        activePlaylistId = null;
        await reloadLibrary();
        notify("Playlist deleted.");
      }
      break;
    }
    case "play-playlist": {
      const playlist = playlists.find((item) => item.id === activePlaylistId);
      if (playlist?.trackIds.length)
        await startTrack(playlist.trackIds[0], playlist.trackIds);
      else notify("Add tracks to this playlist first.");
      break;
    }
    case "add-playlist-tracks":
      openAddTracksDialog();
      break;
    case "collection-back":
      collectionFilter = null;
      render();
      break;
    case "open-collection":
      collectionFilter = {
        key: target.dataset.key,
        value: target.dataset.value,
      };
      render();
      break;
    case "shuffle":
      queue.shuffle = !queue.shuffle;
      if (queue.shuffle) queue.shuffleUpcoming();
      saveQueue();
      renderQueue();
      renderPlayer();
      break;
    case "repeat":
      queue.repeat = { off: "all", all: "one", one: "off" }[queue.repeat];
      saveQueue();
      renderPlayer();
      break;
    case "toggle-queue":
      ui.queuePanel.hidden = !ui.queuePanel.hidden;
      renderQueue();
      break;
    case "close-queue":
      ui.queuePanel.hidden = true;
      break;
    case "clear-queue":
      queue.clear();
      saveQueue();
      renderQueue();
      break;
    case "remove-queue":
      queue.remove(trackId);
      saveQueue();
      renderQueue();
      break;
    case "move-queue":
      queue.move(trackId, Number(target.dataset.direction));
      saveQueue();
      renderQueue();
      break;
    case "play-queue-item": {
      const id = queue.ids[Number(target.dataset.queueIndex)];
      if (id) await startTrack(id, queue.ids);
      break;
    }
    case "toggle-now-playing":
      ui.nowPlaying.hidden = !ui.nowPlaying.hidden;
      if (ui.nowPlaying.hidden) closeNowPlaying();
      break;
    case "close-now-playing":
      closeNowPlaying();
      break;
    case "toggle-visualizer":
      visualizerOn = !visualizerOn;
      byId("visualizer").hidden = !visualizerOn;
      target.textContent = visualizerOn ? "Hide visualizer" : "Show visualizer";
      if (visualizerOn) {
        await equalizer.setGains(equalizerGains);
        await equalizer.startVisualizer(byId("visualizer"));
      }
      else equalizer.stopVisualizer();
      break;
    case "edit-lyrics":
      openLyricsDialog();
      break;
    case "toggle-theme":
      settings.theme = settings.theme === "dark" ? "light" : "dark";
      document.body.classList.toggle("is-light", settings.theme === "light");
      await repository.setSetting("theme", settings.theme);
      document.querySelectorAll(".theme-toggle").forEach((item) => {
        item.textContent = settings.theme === "dark" ? "☼" : "☾";
        item.setAttribute("aria-label", settings.theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
      });
      render();
      break;
    case "toggle-sidebar": {
      const collapsed = document.body.classList.toggle("sidebar-collapsed");
      const control = document.querySelector(".collapse-button");
      control?.setAttribute("aria-pressed", String(collapsed));
      control?.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
      if (control) control.textContent = collapsed ? "›" : "‹";
      await repository.setSetting("sidebarCollapsed", collapsed);
      break;
    }
    case "export-backup":
      await exportBackup();
      break;
    case "export-playlist": {
      const playlist = playlists.find((item) => item.id === activePlaylistId);
      if (playlist) exportPlaylist(playlist);
      break;
    }
    case "import-playlist":
      ui.playlistInput.click();
      break;
    case "restore-backup":
      ui.backupInput.click();
      break;
    case "delete-all-tracks":
      if (
        tracks.length &&
        (await openConfirm(
          "Delete all tracks?",
          `This removes ${tracks.length} tracks and their audio from this browser. Export a backup first if you may want them later.`,
          "Delete all",
        ))
      ) {
        loadSequence++;
        engine.releaseSource();
        currentTrackId = null;
        queue.clear();
        await repository.removeTracks(tracks.map((item) => item.id));
        await reloadLibrary();
        saveQueue();
        notify("All tracks deleted.");
      }
      break;
    case "clear-history":
      await repository.clearHistory();
      history = [];
      await reloadLibrary();
      notify("Listening history cleared.");
      break;
    case "sleep-timer": {
      const minutes = Number(byId("sleep-minutes").value);
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 240)
        return notify("Choose a timer between 1 and 240 minutes.", "error");
      clearTimeout(sleepTimerId);
      sleepTimerId = window.setTimeout(
        () => {
          engine.pause();
          sleepTimerId = 0;
          notify("Sleep timer stopped playback.");
          render();
        },
        minutes * 60 * 1000,
      );
      notify(`Playback will stop in ${minutes} minutes.`);
      render();
      break;
    }
    case "stop-after-track":
      stopAfterTrack = !stopAfterTrack;
      render();
      notify(
        stopAfterTrack
          ? "Playback will stop after this track."
          : "Stop after track cancelled.",
      );
      break;
    case "install-app":
      await promptInstall();
      break;
  }
}

function openMetadataDialog(track) {
  const dialog = byId("metadata-dialog");
  byId("metadata-title").value = track.title;
  byId("metadata-artist").value = track.artist || "";
  byId("metadata-album").value = track.album || "";
  dialog.dataset.trackId = track.id;
  dialog.showModal();
}

async function exportBackup() {
  const backup = await repository.createBackupBlob();
  const url = URL.createObjectURL(backup);
  const link = make("a");
  link.href = url;
  link.download = `amp-backup-${new Date().toISOString().slice(0, 10)}.ampbackup`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify("Backup exported. Keep it somewhere safe.");
}

function exportPlaylist(playlist) {
  const payload = {
    format: "amp-playlist",
    version: 1,
    name: playlist.name,
    description: playlist.description || "",
    exportedAt: new Date().toISOString(),
    tracks: playlist.trackIds.map((id) => {
      const track = tracks.find((item) => item.id === id);
      return track
        ? {
            id: track.id,
            filename: track.filename,
            size: track.size,
            title: track.title,
            artist: track.artist,
            album: track.album,
          }
        : null;
    }).filter(Boolean),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = make("a");
  link.href = url;
  link.download = `${playlist.name.replace(/[\\/:*?"<>|]+/g, "-")}.ampplaylist`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify("Playlist exported. Audio files are not included.");
}

async function importPlaylistFile(file) {
  if (!file || file.size > 2 * 1024 * 1024) {
    throw new Error("Playlist files must be smaller than 2 MB.");
  }
  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch (error) {
    throw new Error("The playlist file is not valid JSON.", { cause: error });
  }
  if (
    !payload || payload.format !== "amp-playlist" || payload.version !== 1 ||
    typeof payload.name !== "string" || !payload.name.trim() ||
    payload.name.length > 80 || !Array.isArray(payload.tracks) ||
    payload.tracks.length > 5000 ||
    (payload.description !== undefined &&
      (typeof payload.description !== "string" || payload.description.length > 300))
  ) {
    throw new Error("This is not a supported AMP playlist file.");
  }

  const matchedIds = [];
  for (const entry of payload.tracks) {
    if (!entry || typeof entry !== "object") {
      throw new Error("The playlist contains an invalid track reference.");
    }
    let match = typeof entry.id === "string"
      ? tracks.find((track) => track.id === entry.id)
      : null;
    if (!match && typeof entry.filename === "string" && Number.isSafeInteger(entry.size)) {
      match = tracks.find((track) =>
        track.filename === entry.filename && track.size === entry.size &&
        (!entry.title || track.title === entry.title),
      );
    }
    if (match) matchedIds.push(match.id);
  }

  const usedNames = new Set(playlists.map((playlist) => playlist.name.toLocaleLowerCase()));
  let name = payload.name.trim();
  if (usedNames.has(name.toLocaleLowerCase())) name = `${name} (Imported)`.slice(0, 80);
  let suffix = 2;
  while (usedNames.has(name.toLocaleLowerCase())) {
    name = `${payload.name.trim()} (${suffix++})`.slice(0, 80);
  }
  await repository.savePlaylist({
    id: createId(),
    name,
    description: payload.description || "",
    trackIds: [...new Set(matchedIds)],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  await reloadLibrary();
  notify(
    `${name} imported with ${new Set(matchedIds).size} matching local tracks. Audio files are not included.`,
  );
}

async function onImport(files) {
  const list = Array.from(files);
  if (!list.length) return;
  const result = await importAudioFiles(list, repository, (done, total) => {
    ui.connectionLabel.textContent = `Importing ${done} of ${total}…`;
  });
  await reloadLibrary();
  const imported = result.filter((item) => item.status === "imported").length;
  const rejected = result.filter(
    (item) => item.status === "rejected" || item.status === "failed",
  ).length;
  const duplicates = result.filter(
    (item) => item.status === "duplicate",
  ).length;
  notify(
    `${imported} imported${duplicates ? ` · ${duplicates} already in library` : ""}${rejected ? ` · ${rejected} could not be imported` : ""}`,
    rejected ? "error" : "info",
  );
  const failed = result.filter((item) => item.status === "failed");
  failed.forEach((item) =>
    notify(`${item.filename}: ${item.message}`, "error"),
  );
  setConnectionStatus();
}

function registerEvents() {
  document.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    try {
      await handleAction(target.dataset.action, target);
    } catch (error) {
      showError(error);
    }
  });
  document.addEventListener("click", (event) => {
    const navigation = event.target.closest("[data-page]");
    if (navigation) setPage(navigation.dataset.page);
  });

  ui.search.addEventListener("input", () => render());
  byId("import-button").addEventListener("click", () => ui.importInput.click());
  ui.importInput.addEventListener("change", async () => {
    try {
      await onImport(ui.importInput.files);
    } catch (error) {
      showError(error, "Import failed");
    }
    ui.importInput.value = "";
  });
  ui.backupInput.addEventListener("change", async () => {
    const file = ui.backupInput.files[0];
    if (!file) return;
    try {
      await repository.restoreBackupFile(file);
      await reloadLibrary();
      notify(
        "Backup restored. Existing tracks were preserved unless IDs matched.",
      );
    } catch (error) {
      showError(error, "Backup restore failed");
    }
    ui.backupInput.value = "";
  });
  ui.playlistInput.addEventListener("change", async () => {
    const file = ui.playlistInput.files[0];
    if (!file) return;
    try {
      await importPlaylistFile(file);
      page = "playlists";
      activePlaylistId = null;
      setNavigation();
      render();
    } catch (error) {
      showError(error, "Playlist import failed");
    }
    ui.playlistInput.value = "";
  });

  ui.playlistForm.addEventListener("submit", async (event) => {
    if (event.submitter?.value !== "save") return;
    event.preventDefault();
    const existing = playlists.find((item) => item.id === pendingPlaylistId);
    const playlist = {
      id: pendingPlaylistId || createId(),
      name: ui.playlistName.value.trim(),
      description: ui.playlistDescription.value.trim(),
      trackIds: existing?.trackIds || [],
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    if (!playlist.name) return notify("Playlist name is required.", "error");
    try {
      await repository.savePlaylist(playlist);
      ui.playlistDialog.close();
      activePlaylistId = playlist.id;
      await reloadLibrary();
      page = "playlists";
      setNavigation();
      render();
      notify(existing ? "Playlist updated." : "Playlist created.");
    } catch (error) {
      showError(error, "Could not save playlist");
    }
  });

  byId("metadata-form").addEventListener("submit", async (event) => {
    if (event.submitter?.value !== "save") return;
    event.preventDefault();
    const id = byId("metadata-dialog").dataset.trackId;
    try {
      await repository.updateTrackMetadata(id, {
        title: byId("metadata-title").value.trim() || "Untitled audio",
        artist: byId("metadata-artist").value.trim() || "Unknown artist",
        album: byId("metadata-album").value.trim() || "Unknown album",
      });
      byId("metadata-dialog").close();
      await reloadLibrary();
      updateMediaSession();
      notify("Track details updated.");
    } catch (error) {
      showError(error, "Could not update track");
    }
  });

  byId("lyrics-form").addEventListener("submit", async (event) => {
    if (event.submitter?.value !== "save") return;
    event.preventDefault();
    try {
      await repository.updateTrackMetadata(currentTrackId, {
        lyrics: byId("lyrics-input").value,
      });
      byId("lyrics-dialog").close();
      await reloadLibrary();
      notify("Lyrics saved on this device.");
    } catch (error) {
      showError(error, "Could not save lyrics");
    }
  });

  byId("add-tracks-form").addEventListener("submit", async (event) => {
    if (event.submitter?.value !== "add") return;
    event.preventDefault();
    const playlist = playlists.find((item) => item.id === activePlaylistId);
    if (!playlist) return;
    const selected = [
      ...byId("add-tracks-list").querySelectorAll(
        'input[type="checkbox"]:checked',
      ),
    ].map((input) => input.value);
    if (!selected.length) return notify("Select at least one track.");
    try {
      playlist.trackIds = [...playlist.trackIds, ...selected];
      playlist.updatedAt = Date.now();
      await repository.savePlaylist(playlist);
      byId("add-tracks-dialog").close();
      await reloadLibrary();
      notify(`${selected.length} tracks added to playlist.`);
    } catch (error) {
      showError(error, "Could not add tracks");
    }
  });

  ui.seek.forEach((input) =>
    input.addEventListener("input", () => {
      const duration = engine.getState().duration;
      if (duration) engine.seek((Number(input.value) / 1000) * duration);
    }),
  );
  ui.volume.addEventListener("input", () => {
    engine.setVolume(Number(ui.volume.value));
    settings.volume = Number(ui.volume.value);
    repository
      .setSetting("volume", settings.volume)
      .catch((error) => showError(error, "Could not save volume"));
  });
  ui.speed.addEventListener("change", () => {
    engine.setPlaybackRate(Number(ui.speed.value));
    settings.speed = Number(ui.speed.value);
    repository
      .setSetting("speed", settings.speed)
      .catch((error) => showError(error, "Could not save playback speed"));
  });
  document.addEventListener("input", async (event) => {
    const input = event.target.closest("[data-eq-band]");
    if (!input) return;
    const band = input.dataset.eqBand;
    equalizerGains[band] = Number(input.value);
    input.previousElementSibling.textContent = `${band[0].toUpperCase()}${band.slice(1)} · ${input.value} dB`;
    try {
      await equalizer.setGains(equalizerGains);
      repository
        .setSetting("equalizer", equalizerGains)
        .catch((error) => showError(error, "Could not save equalizer"));
    } catch (error) {
      showError(error, "Equalizer unavailable");
      input.disabled = true;
    }
  });
  document.addEventListener("change", async (event) => {
    const select = event.target.closest("[data-eq-preset]");
    if (!select) return;
    try {
      const values = await equalizer.applyPreset(select.value);
      equalizerGains = { bass: values[0], mid: values[1], treble: values[2] };
      await repository.setSetting("equalizer", equalizerGains);
      renderSettings();
      notify(`${select.value} equalizer preset applied.`);
    } catch (error) {
      showError(error, "Equalizer unavailable");
    }
  });
  ui.audio.addEventListener("ended", async () => {
    if (stopAfterTrack) {
      stopAfterTrack = false;
      engine.pause();
      notify("Playback stopped after this track.");
      render();
      return;
    }
    if (queue.repeat === "one") {
      engine.seek(0);
      try {
        await engine.play();
      } catch (error) {
        showError(error, "Could not repeat track");
      }
      return;
    }
    try {
      await playNext();
    } catch (error) {
      showError(error, "Could not play next track");
    }
  });

  engine.on("timeupdate", (state) => {
    renderPlayer(state);
    if ("mediaSession" in navigator && state.duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: state.duration,
          playbackRate: state.playbackRate,
          position: Math.min(state.currentTime, state.duration),
        });
      } catch {
        // Position state is optional and may be rejected by some browsers.
      }
    }
  });
  engine.on("play", (state) => renderPlayer(state));
  engine.on("pause", (state) => renderPlayer(state));
  engine.on("loadedmetadata", async (state) => {
    if (!currentTrackId || !state.duration) return;
    const track = tracks.find((item) => item.id === currentTrackId);
    if (track && Math.abs((track.duration || 0) - state.duration) > 1) {
      try {
        await repository.updateTrackMetadata(track.id, {
          duration: state.duration,
        });
        await reloadLibrary();
      } catch (error) {
        showError(error, "Could not save track duration");
      }
    } else renderPlayer(state);
  });
  engine.on("error", () =>
    notify("This audio format could not be decoded by the browser.", "error"),
  );

  window.addEventListener("online", setConnectionStatus);
  window.addEventListener("offline", setConnectionStatus);
  window.addEventListener(
    "beforeunload",
    () => {
      engine.destroy();
      equalizer.destroy();
      if (sleepTimerId) clearTimeout(sleepTimerId);
    },
    { once: true },
  );

  let dragDepth = 0;
  window.addEventListener("dragenter", (event) => {
    event.preventDefault();
    dragDepth++;
    ui.overlay.hidden = false;
  });
  window.addEventListener("dragover", (event) => event.preventDefault());
  window.addEventListener("dragleave", (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) ui.overlay.hidden = true;
  });
  window.addEventListener("drop", async (event) => {
    event.preventDefault();
    dragDepth = 0;
    ui.overlay.hidden = true;
    try {
      await onImport(event.dataTransfer.files);
    } catch (error) {
      showError(error, "Import failed");
    }
  });

  document.addEventListener("keydown", async (event) => {
    const active = document.activeElement;
    if (active.matches("input, textarea, select") || active.isContentEditable)
      return;
    if (event.key === "/" && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      ui.search.focus();
    } else if (event.code === "Space") {
      event.preventDefault();
      await togglePlayback();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      engine.seek(engine.getState().currentTime - 5);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      engine.seek(engine.getState().currentTime + 5);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      engine.setVolume(Math.min(1, engine.getState().volume + 0.05));
      ui.volume.value = String(engine.getState().volume);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      engine.setVolume(Math.max(0, engine.getState().volume - 0.05));
      ui.volume.value = String(engine.getState().volume);
    } else if (event.key.toLowerCase() === "m") {
      ui.audio.muted = !ui.audio.muted;
      renderPlayer();
    } else if (event.key.toLowerCase() === "n") {
      await playNext();
    } else if (event.key.toLowerCase() === "p") {
      await playPrevious();
    } else if (event.key === "Escape") {
      ui.queuePanel.hidden = true;
      closeNowPlaying();
    }
  });
}

let installPrompt = null;
async function promptInstall() {
  if (!installPrompt)
    return notify("Use your browser menu to install AMP on this device.");
  await installPrompt.prompt();
  const choice = await installPrompt.userChoice;
  notify(
    choice.outcome === "accepted"
      ? "AMP installation started."
      : "Installation was dismissed.",
  );
  installPrompt = null;
  byId("install-button").hidden = true;
}

async function registerPwa() {
  if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol))
    return;
  try {
    const hadController = Boolean(navigator.serviceWorker.controller);
    const registration = await navigator.serviceWorker.register("./sw.js");
    const offerUpdate = (worker) => {
      if (!worker || !navigator.serviceWorker.controller) return;
      openConfirm(
        "AMP update ready",
        "Update the app now? Your local music and playlists will be preserved.",
        "Update",
      ).then((accepted) => {
        if (accepted) worker.postMessage({ type: "SKIP_WAITING" });
      });
    };
    if (registration.waiting) offerUpdate(registration.waiting);
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed")
          offerUpdate(registration.waiting || worker);
      });
    });
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      installPrompt = event;
      byId("install-button").hidden = false;
    });
    byId("install-button").addEventListener("click", () =>
      promptInstall().catch((error) =>
        showError(error, "Install prompt failed"),
      ),
    );
    if (hadController) {
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => window.location.reload(),
        { once: true },
      );
    }
  } catch (error) {
    showError(error, "Offline support could not start");
  }
}

async function initialize() {
  registerEvents();
  setConnectionStatus();
  try {
    const db = await openDatabase();
    repository = new LibraryRepository(db);
    const [theme, volume, speed, savedQueue, savedEqualizer, sidebarCollapsed] =
      await Promise.all([
        repository.getSetting("theme"),
        repository.getSetting("volume"),
        repository.getSetting("speed"),
        repository.getSetting("queue"),
        repository.getSetting("equalizer"),
        repository.getSetting("sidebarCollapsed"),
      ]);
    settings.theme = theme || "dark";
    settings.volume = Number.isFinite(volume) ? volume : 0.8;
    settings.speed = Number.isFinite(speed) ? speed : 1;
    if (savedEqualizer && typeof savedEqualizer === "object") {
      equalizerGains = {
        bass: Number(savedEqualizer.bass) || 0,
        mid: Number(savedEqualizer.mid) || 0,
        treble: Number(savedEqualizer.treble) || 0,
      };
    }
    document.body.classList.toggle("is-light", settings.theme === "light");
    document.body.classList.toggle("sidebar-collapsed", sidebarCollapsed === true);
    const collapseButton = document.querySelector(".collapse-button");
    collapseButton?.setAttribute("aria-pressed", String(sidebarCollapsed === true));
    collapseButton?.setAttribute("aria-label", sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar");
    if (collapseButton) collapseButton.textContent = sidebarCollapsed ? "›" : "‹";
    document.querySelectorAll(".theme-toggle").forEach((item) => {
      item.textContent = settings.theme === "dark" ? "☼" : "☾";
    });
    engine.setVolume(settings.volume);
    engine.setPlaybackRate(settings.speed);
    ui.speed.value = String(settings.speed);
    queue = new QueueManager(savedQueue || {});
    await reloadLibrary();
    const currentId = queue.currentId();
    if (currentId && tracks.some((track) => track.id === currentId)) {
      const record = await repository.getAudio(currentId);
      const track = tracks.find((item) => item.id === currentId);
      if (record?.blob && track) {
        const type = track.playbackType || record.mimeType || track.mimeType;
        engine.load(
          type && record.blob.type !== type
            ? new Blob([record.blob], { type })
            : record.blob,
        );
        currentTrackId = currentId;
      }
    }
    render();
    renderQueue();
    renderPlayer();
    registerPwa();
  } catch (error) {
    showError(error, "AMP could not open its local library");
    ui.content.replaceChildren(
      emptyState("Library unavailable", error.message, "Reload", "reload"),
    );
  }
}

document.addEventListener(
  "click",
  (event) => {
    const reload = event.target.closest('[data-action="reload"]');
    if (reload) window.location.reload();
  },
  { once: true },
);

initialize();
