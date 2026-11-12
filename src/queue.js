export class QueueManager {
  constructor({ ids = [], currentIndex = -1, repeat = "off", shuffle = false } = {}) {
    this.ids = [...ids];
    this.currentIndex = currentIndex;
    this.repeat = repeat;
    this.shuffle = shuffle;
    this.history = [];
  }

  set(ids, startId = ids[0], shuffle = this.shuffle) {
    const uniqueIds = [...new Set(ids)];
    const start = Math.max(0, uniqueIds.indexOf(startId));
    this.ids = [...uniqueIds.slice(start), ...uniqueIds.slice(0, start)];
    this.currentIndex = this.ids.length ? 0 : -1;
    this.history = [];
    this.shuffle = shuffle;
    if (shuffle) this.shuffleUpcoming();
    return this.currentId();
  }

  currentId() {
    return this.currentIndex >= 0 ? this.ids[this.currentIndex] || null : null;
  }

  upcoming() {
    return this.ids.slice(this.currentIndex + 1);
  }

  add(id, position = this.ids.length) {
    if (this.ids.includes(id)) return false;
    const index = Math.max(this.currentIndex + 1, Math.min(position, this.ids.length));
    this.ids.splice(index, 0, id);
    return true;
  }

  remove(id) {
    const index = this.ids.indexOf(id);
    if (index < 0) return false;
    this.ids.splice(index, 1);
    if (index < this.currentIndex) this.currentIndex--;
    else if (index === this.currentIndex) this.currentIndex = Math.min(index, this.ids.length - 1);
    return true;
  }

  move(id, offset) {
    const from = this.ids.indexOf(id);
    const to = from + offset;
    if (from <= this.currentIndex || to <= this.currentIndex || to >= this.ids.length) return false;
    const [item] = this.ids.splice(from, 1);
    this.ids.splice(to, 0, item);
    return true;
  }

  next() {
    if (!this.ids.length) return null;
    if (this.currentIndex < this.ids.length - 1) {
      if (this.currentIndex >= 0) this.history.push(this.ids[this.currentIndex]);
      this.currentIndex++;
      return this.currentId();
    }
    if (this.repeat === "all") {
      const previousId = this.currentId();
      if (previousId) this.history.push(previousId);
      if (this.shuffle && this.ids.length > 1) {
        const upcoming = this.ids.filter((id) => id !== previousId);
        for (let index = upcoming.length - 1; index > 0; index--) {
          const swap = Math.floor(Math.random() * (index + 1));
          [upcoming[index], upcoming[swap]] = [upcoming[swap], upcoming[index]];
        }
        this.ids = [previousId, ...upcoming];
        this.currentIndex = 1;
        return this.currentId();
      }
      this.currentIndex = 0;
      return this.currentId();
    }
    return null;
  }

  previous() {
    if (!this.ids.length) return null;
    if (this.history.length) {
      const previousId = this.history.pop();
      const index = this.ids.indexOf(previousId);
      if (index >= 0) {
        this.currentIndex = index;
        return previousId;
      }
    }
    this.currentIndex = Math.max(0, this.currentIndex - 1);
    return this.currentId();
  }

  clear() {
    this.ids = [];
    this.currentIndex = -1;
    this.history = [];
  }

  shuffleUpcoming() {
    const current = this.currentId();
    const upcoming = this.ids.slice(this.currentIndex + 1);
    for (let index = upcoming.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1));
      [upcoming[index], upcoming[swap]] = [upcoming[swap], upcoming[index]];
    }
    this.ids = current ? [current, ...upcoming] : upcoming;
    this.currentIndex = current ? 0 : -1;
  }
}
