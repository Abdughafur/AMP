export class AudioEngine {
  constructor(audioElement) {
    this.audio = audioElement;
    this.objectUrl = null;
    this.listeners = new Map();
    this.audioEvents = [
      "loadedmetadata",
      "durationchange",
      "timeupdate",
      "play",
      "pause",
      "ended",
      "waiting",
      "playing",
      "error",
      "volumechange",
      "seeking",
      "seeked",
    ];
    this.handleAudioEvent = (event) => this.emit(event.type, this.getState());
    this.audioEvents.forEach((type) => this.audio.addEventListener(type, this.handleAudioEvent));
  }

  on(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
    return () => this.listeners.get(type)?.delete(listener);
  }

  emit(type, state = this.getState()) {
    for (const listener of this.listeners.get(type) || []) listener(state);
  }

  load(blob) {
    this.releaseSource();
    this.objectUrl = URL.createObjectURL(blob);
    this.audio.src = this.objectUrl;
    this.audio.load();
  }

  async play() {
    try {
      await this.audio.play();
    } catch (error) {
      this.emit("playerror", { error, ...this.getState() });
      throw error;
    }
  }

  pause() {
    this.audio.pause();
  }

  seek(time) {
    if (Number.isFinite(this.audio.duration)) {
      this.audio.currentTime = Math.max(0, Math.min(time, this.audio.duration));
    }
  }

  setVolume(value) {
    this.audio.volume = Math.max(0, Math.min(1, value));
  }

  setPlaybackRate(value) {
    this.audio.playbackRate = value;
  }

  getState() {
    return {
      currentTime: this.audio.currentTime || 0,
      duration: Number.isFinite(this.audio.duration) ? this.audio.duration : 0,
      paused: this.audio.paused,
      volume: this.audio.volume,
      muted: this.audio.muted,
      playbackRate: this.audio.playbackRate,
      seeking: this.audio.seeking,
      readyState: this.audio.readyState,
    };
  }

  releaseSource() {
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  destroy() {
    this.audioEvents.forEach((type) => this.audio.removeEventListener(type, this.handleAudioEvent));
    this.releaseSource();
    this.listeners.clear();
  }
}
