import {
  type Attempt,
  type Puzzle,
  validateAttempt,
} from "../../../packages/game-core";
const prefix = "onebox:v1:";
export class Store {
  warning = false;
  private ephemeral = false;
  useMemoryOnly() {
    this.ephemeral = true;
    this.warning = true;
  }
  private memory = new Map<string, string>();
  private unsaved = new Set<string>();
  private clearGeneration: string | null | undefined;
  discardCache() {
    this.memory.clear();
    this.unsaved.clear();
  }
  wasCleared() {
    try {
      const value = localStorage.getItem(prefix + "clear-generation");
      if (this.clearGeneration === undefined) {
        this.clearGeneration = value;
        return false;
      }
      if (value !== this.clearGeneration) {
        this.clearGeneration = value;
        this.discardCache();
        return true;
      }
    } catch {
      this.warning = true;
    }
    return false;
  }
  private get(k: string) {
    if (this.ephemeral || this.unsaved.has(k))
      return this.memory.get(k) ?? null;
    try {
      const value = localStorage.getItem(prefix + k);
      if (value !== null) this.memory.set(k, value);
      else this.memory.delete(k);
      return value;
    } catch {
      this.warning = true;
      return this.memory.get(k) ?? null;
    }
  }
  private set(k: string, v: string) {
    this.memory.set(k, v);
    if (this.ephemeral) return;
    try {
      localStorage.setItem(prefix + k, v);
      this.unsaved.delete(k);
    } catch {
      this.unsaved.add(k);
      this.warning = true;
    }
  }
  firstKey(p: Puzzle) {
    return `first:${p.puzzle_id}:${p.rules_version}`;
  }
  read(p: Puzzle, hash: string): Attempt | null {
    this.wasCleared();
    const raw = this.get(`current:${p.puzzle_id}`);
    if (!raw) return null;
    try {
      return validateAttempt(JSON.parse(raw), p, hash);
    } catch {
      this.set(`quarantine:${p.puzzle_id}`, raw);
      this.remove(`current:${p.puzzle_id}`);
      this.warning = true;
      return null;
    }
  }
  mode(p: Puzzle): "first" | "practice" {
    this.wasCleared();
    return this.get(this.firstKey(p)) ? "practice" : "first";
  }
  recent(p: Puzzle, hash: string): Attempt[] {
    this.wasCleared();
    // Enumerate only our run records. Successful storage reads remain authoritative
    // after another tab deletes records; unsaved writes still use the memory copy.
    const keys = new Set(this.memory.keys());
    if (!this.ephemeral) {
      try {
        for (const k of Object.keys(localStorage))
          if (k.startsWith(prefix + "run:")) keys.add(k.slice(prefix.length));
      } catch {
        this.warning = true;
      }
    }
    const attempts: Attempt[] = [];
    for (const k of keys) {
      if (!k.startsWith("run:")) continue;
      const raw = this.get(k);
      if (!raw) continue;
      try {
        const value = JSON.parse(raw);
        // Other problems (including private trials/tutorials) are outside this view.
        if (value?.puzzle_id !== p.puzzle_id) continue;
        const a = validateAttempt(value, p, hash);
        if (a.run_id !== k.slice(4)) throw Error("Invalid record key");
        if (a.mode === "tutorial") continue;
        const terminal = ["completed", "revealed", "abandoned"].includes(
          a.state,
        );
        if (terminal !== (a.finished_at_client !== null))
          throw Error("Invalid record state");
        attempts.push(a);
      } catch {
        // History is read-only: exclude damaged records without deleting originals.
        this.warning = true;
      }
    }
    return attempts
      .sort(
        (a, b) =>
          Date.parse(b.started_at_client) - Date.parse(a.started_at_client) ||
          b.run_id.localeCompare(a.run_id),
      )
      .slice(0, 7);
  }
  save(a: Attempt) {
    if (this.wasCleared()) return false;
    const p = {
      puzzle_id: a.puzzle_id,
      rules_version: a.rules_version,
    } as Puzzle;
    const first = this.get(this.firstKey(p));
    if (a.mode === "first" && !first) this.set(this.firstKey(p), a.run_id);
    if (a.mode === "first" && first && first !== a.run_id) return false;
    const previous = this.get(`run:${a.run_id}`);
    if (previous) {
      try {
        const old = JSON.parse(previous) as Attempt;
        if (["completed", "revealed", "abandoned"].includes(old.state))
          return old.state === a.state && old.run_id === a.run_id;
      } catch {
        /* replace corrupt run only */
      }
    }
    this.set(`run:${a.run_id}`, JSON.stringify(a));
    this.set(`current:${a.puzzle_id}`, JSON.stringify(a));
    this.prune();
    return true;
  }
  private remove(k: string) {
    this.memory.delete(k);
    this.unsaved.delete(k);
    if (this.ephemeral) return;
    try {
      localStorage.removeItem(prefix + k);
    } catch {
      this.warning = true;
    }
  }
  private prune() {
    if (this.ephemeral) return;
    try {
      const currents = Object.keys(localStorage)
        .filter((k) => k.startsWith(prefix + "current:"))
        .map((k) => ({ k, a: JSON.parse(localStorage.getItem(k)!) }))
        .sort(
          (a, b) =>
            Date.parse(b.a.started_at_client) -
            Date.parse(a.a.started_at_client),
        );
      for (const { a } of currents.slice(180)) {
        const pid = a.puzzle_id;
        for (const k of Object.keys(localStorage)) {
          if (!k.startsWith(prefix)) continue;
          const raw = localStorage.getItem(k);
          if (
            k === prefix + `current:${pid}` ||
            k.startsWith(prefix + `first:${pid}:`) ||
            (k.startsWith(prefix + "run:") &&
              raw &&
              JSON.parse(raw).puzzle_id === pid)
          )
            localStorage.removeItem(k);
        }
      }
    } catch {
      this.warning = true;
    }
  }
  clear() {
    this.discardCache();
    try {
      this.clearGeneration = crypto.randomUUID();
      // A non-personal reset marker prevents another open tab resurrecting runs.
      let marked = false;
      try {
        localStorage.setItem(prefix + "clear-generation", this.clearGeneration);
        marked = true;
      } catch {
        this.warning = true;
      }
      for (const k of Object.keys(localStorage))
        if (k.startsWith(prefix) && k !== prefix + "clear-generation")
          localStorage.removeItem(k);
      if (!marked)
        localStorage.setItem(prefix + "clear-generation", this.clearGeneration);
    } catch {
      this.warning = true;
    }
  }
}
export const store = new Store();
