const PRESETS = {
  Flat: [0, 0, 0],
  "Bass Boost": [6, 1, -1],
  "Treble Boost": [-1, 1, 6],
  Rock: [4, -1, 4],
  Pop: [2, 3, 1],
  Classical: [1, 0, 3],
  Jazz: [3, 1, 3],
};

export class Equalizer {
  constructor(audioElement) {
    this.audioElement = audioElement;
    this.context = null;
    this.source = null;
    this.filters = [];
    this.analyser = null;
    this.frame = 0;
    this.canvas = null;
    this.resizeHandler = null;
    this.visibilityHandler = null;
  }

  initialize() {
    if (this.context) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error("Web Audio equalization is not supported in this browser.");
    this.context = new AudioContext();
    this.source = this.context.createMediaElementSource(this.audioElement);
    this.filters = [
      { type: "lowshelf", frequency: 200 },
      { type: "peaking", frequency: 1000, Q: 0.8 },
      { type: "highshelf", frequency: 5000 },
    ].map((config) => {
      const filter = this.context.createBiquadFilter();
      filter.type = config.type;
      filter.frequency.value = config.frequency;
      if (config.Q) filter.Q.value = config.Q;
      return filter;
    });
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 128;
    this.analyser.smoothingTimeConstant = 0.82;
    this.source.connect(this.filters[0]);
    this.filters[0].connect(this.filters[1]);
    this.filters[1].connect(this.filters[2]);
    this.filters[2].connect(this.analyser);
    this.analyser.connect(this.context.destination);
  }

  async setGain(band, value) {
    this.initialize();
    const index = { bass: 0, mid: 1, treble: 2 }[band];
    if (index === undefined) throw new Error("Unknown equalizer band.");
    this.filters[index].gain.value = Math.max(-12, Math.min(12, Number(value)));
    await this.context.resume();
  }

  async setGains(gains) {
    this.initialize();
    for (const [band, index] of [["bass", 0], ["mid", 1], ["treble", 2]]) {
      const value = Number(gains[band]);
      this.filters[index].gain.value = Math.max(-12, Math.min(12, value));
    }
    await this.context.resume();
  }

  async applyPreset(name) {
    const values = PRESETS[name];
    if (!values) throw new Error("Unknown equalizer preset.");
    this.initialize();
    values.forEach((value, index) => { this.filters[index].gain.value = value; });
    await this.context.resume();
    return values;
  }

  async startVisualizer(canvas) {
    this.initialize();
    this.stopVisualizer();
    this.canvas = canvas;
    this.resizeHandler = () => this.resizeCanvas();
    this.visibilityHandler = () => {
      if (document.hidden) cancelAnimationFrame(this.frame);
      else this.drawFrame();
    };
    window.addEventListener("resize", this.resizeHandler);
    document.addEventListener("visibilitychange", this.visibilityHandler);
    this.resizeCanvas();
    try {
      await this.context.resume();
      this.drawFrame();
    } catch (error) {
      this.stopVisualizer();
      throw error;
    }
  }

  resizeCanvas() {
    if (!this.canvas) return;
    const bounds = this.canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(bounds.width * ratio));
    this.canvas.height = Math.max(1, Math.round(bounds.height * ratio));
  }

  drawFrame() {
    if (!this.canvas || document.hidden) return;
    const context = this.canvas.getContext("2d");
    if (!context) return;
    const values = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(values);
    const width = this.canvas.width;
    const height = this.canvas.height;
    context.clearRect(0, 0, width, height);
    const step = width / values.length;
    context.fillStyle = getComputedStyle(document.body).getPropertyValue("--accent").trim() || "#a28cff";
    values.forEach((value, index) => {
      const barHeight = (value / 255) * height;
      context.fillRect(index * step + step * 0.18, height - barHeight, step * 0.64, barHeight);
    });
    this.frame = requestAnimationFrame(() => this.drawFrame());
  }

  stopVisualizer() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.resizeHandler) window.removeEventListener("resize", this.resizeHandler);
    if (this.visibilityHandler) document.removeEventListener("visibilitychange", this.visibilityHandler);
    this.resizeHandler = null;
    this.visibilityHandler = null;
    this.canvas = null;
  }

  destroy() {
    this.stopVisualizer();
    if (this.context && this.context.state !== "closed") this.context.close();
  }
}

export { PRESETS as EQUALIZER_PRESETS };
