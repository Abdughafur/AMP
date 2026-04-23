const player = document.getElementById("audio-player");
const playBtn = document.getElementById("play-btn");
const playIcon = document.getElementById("play-icon");
const repeatBtn = document.getElementById("repeat-btn");
const progress = document.getElementById("progress");
const title = document.getElementById("title");
const listEl = document.getElementById("library-list");
const body = document.getElementById("main-body");
const overlay = document.getElementById("drop-overlay");

let db;
let isRepeatOne = false;
let currentPlaying = "";
let songPendingDeletion = "";

const req = indexedDB.open("InfinityEliteDB", 1);
req.onupgradeneeded = (e) =>
  e.target.result.createObjectStore("songs", { keyPath: "name" });
req.onsuccess = (e) => {
  db = e.target.result;
  renderList();
};

function renderList() {
  listEl.innerHTML = "";
  const trans = db.transaction(["songs"], "readonly");
  trans.objectStore("songs").openCursor().onsuccess = (e) => {
    const cursor = e.target.result;
    if (cursor) {
      const item = document.createElement("div");
      item.className = `library-item ${cursor.value.name === currentPlaying ? "active" : ""}`;
      item.innerHTML = `
                    <span>${cursor.value.name}</span>
                    <div class="del-icon">
                        <svg width="18" height="18" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                    </div>
                `;
      const d = cursor.value.data;
      const n = cursor.value.name;
      item.onclick = () => playSong(d, n);
      item.querySelector(".del-icon").onclick = (ev) => {
        ev.stopPropagation();
        requestDelete(n);
      };
      listEl.appendChild(item);
      cursor.continue();
    }
  };
}

function addFiles(files) {
  Array.from(files).forEach((file) => {
    if (file.name.endsWith(".mp3") || file.name.endsWith(".m4a")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const trans = db.transaction(["songs"], "readwrite");
        trans
          .objectStore("songs")
          .put({ name: file.name, data: e.target.result });
        trans.oncomplete = () => renderList();
      };
      reader.readAsArrayBuffer(file);
    }
  });
}

function playSong(data, name) {
  currentPlaying = name;
  const blob = new Blob([data], { type: "audio/mpeg" });
  player.src = URL.createObjectURL(blob);
  title.innerText = name.replace(/\.[^/.]+$/, "");
  player.play();
  renderList();
}

function openModal(id) {
  document.getElementById(id).classList.add("active");
}
function closeModals() {
  document
    .querySelectorAll(".modal-overlay")
    .forEach((m) => m.classList.remove("active"));
}

function requestDelete(name) {
  songPendingDeletion = name;
  document.getElementById("delete-song-name").innerText = name;
  openModal("confirm-single-modal");
}

function executeDelete() {
  const trans = db.transaction(["songs"], "readwrite");
  trans.objectStore("songs").delete(songPendingDeletion);
  trans.oncomplete = () => {
    if (currentPlaying === songPendingDeletion) player.src = "";
    renderList();
    closeModals();
  };
}

function wipeLibrary() {
  const trans = db.transaction(["songs"], "readwrite");
  trans.objectStore("songs").clear();
  trans.oncomplete = () => {
    player.src = "";
    currentPlaying = "";
    renderList();
    closeModals();
  };
}

function skip(v) {
  player.currentTime += v;
}
function toggleFS() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen();
  else document.exitFullscreen();
}

repeatBtn.onclick = () => {
  isRepeatOne = !isRepeatOne;
  repeatBtn.classList.toggle("active", isRepeatOne);
};
player.onended = () => {
  if (isRepeatOne) {
    player.currentTime = 0;
    player.play();
  }
};
playBtn.onclick = () => (player.paused ? player.play() : player.pause());

player.onplay = () => {
  body.classList.add("is-playing");
  playIcon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
};
player.onpause = () => {
  body.classList.remove("is-playing");
  playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
};

player.ontimeupdate = () => {
  progress.value = (player.currentTime / player.duration) * 100 || 0;
  document.getElementById("current-time").innerText = fmt(player.currentTime);
  document.getElementById("duration").innerText = fmt(player.duration || 0);
};

function fmt(s) {
  const m = Math.floor(s / 60),
    sc = Math.floor(s % 60);
  return `${m}:${sc < 10 ? "0" + sc : sc}`;
}
progress.oninput = () =>
  (player.currentTime = (progress.value / 100) * player.duration);

window.ondragenter = (e) => {
  e.preventDefault();
  overlay.style.display = "flex";
};
overlay.ondragleave = () => (overlay.style.display = "none");
window.ondragover = (e) => e.preventDefault();
window.ondrop = (e) => {
  e.preventDefault();
  overlay.style.display = "none";
  addFiles(e.dataTransfer.files);
};
document.getElementById("file-input").onchange = (e) =>
  addFiles(e.target.files);
