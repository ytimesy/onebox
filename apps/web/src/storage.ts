import {
  type Attempt,
  type Puzzle,
  validateAttempt,
} from "../../../packages/game-core";
import {
  validatePublishedPuzzle,
  type PublishedProblem,
} from "../../../packages/game-core/release";
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
    if (this.ephemeral) return true;
    try {
      localStorage.setItem(prefix + k, v);
      this.unsaved.delete(k);
      return true;
    } catch {
      this.unsaved.add(k);
      this.warning = true;
      return false;
    }
  }
  firstKey(p: Puzzle) {
    return `first:${p.puzzle_id}:${p.rules_version}`;
  }
  preferences(): { timer_visible?: boolean; reduce_motion?: boolean } {
    const raw = this.get("preferences");
    if (!raw) return {};
    try {
      const v = JSON.parse(raw);
      if (
        typeof v.timer_visible !== "boolean" ||
        typeof v.reduce_motion !== "boolean"
      )
        throw Error();
      return { timer_visible: v.timer_visible, reduce_motion: v.reduce_motion };
    } catch {
      this.warning = true;
      return {};
    }
  }
  setPreferences(timer_visible: boolean, reduce_motion: boolean) {
    this.set("preferences", JSON.stringify({ timer_visible, reduce_motion }));
  }
  read(p: Puzzle, hash: string): Attempt | null {
    this.wasCleared();
    const raw = this.get(`current:${p.puzzle_id}`);
    if (!raw) return null;
    try {
      return validateAttempt(JSON.parse(raw), p, hash);
    } catch {
      // Corruption must not reissue a first attempt on the next page load.
      if (!this.get(this.firstKey(p))) this.set(this.firstKey(p), "unverified");
      // Never destroy the only durable copy if quarantine cannot be saved.
      if (this.set(`quarantine:${p.puzzle_id}:${crypto.randomUUID()}`, raw))
        this.remove(`current:${p.puzzle_id}`);
      this.warning = true;
      return null;
    }
  }
  mode(p: Puzzle): "first" | "practice" {
    this.wasCleared();
    const first = this.get(this.firstKey(p));
    return first || this.warning ? "practice" : "first";
  }
  private runRecords(): Array<{ key: string; value: Attempt }> {
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
    const records: Array<{ key: string; value: Attempt }> = [];
    for (const k of keys) {
      if (!k.startsWith("run:")) continue;
      const raw = this.get(k);
      if (!raw) continue;
      try {
        const value = JSON.parse(raw);
        if (!value || typeof value !== "object") throw Error("Invalid record");
        records.push({ key: k, value });
      } catch {
        // History is read-only: exclude damaged records without deleting originals.
        this.warning = true;
      }
    }
    return records.sort(
      (a, b) =>
        (Date.parse(b.value.started_at_client) || 0) -
          (Date.parse(a.value.started_at_client) || 0) ||
        b.key.localeCompare(a.key),
    );
  }
  private historyAttempt(value: Attempt, key: string, p: Puzzle, hash: string) {
    const a = validateAttempt(value, p, hash);
    if (a.run_id !== key.slice(4)) throw Error("Invalid record key");
    const terminal = ["completed", "revealed", "abandoned"].includes(a.state);
    if (terminal !== (a.finished_at_client !== null))
      throw Error("Invalid record state");
    return a;
  }
  recent(p: Puzzle, hash: string): Attempt[] {
    this.wasCleared();
    const attempts: Attempt[] = [];
    for (const { key, value } of this.runRecords()) {
      if (value.puzzle_id !== p.puzzle_id || value.mode === "tutorial")
        continue;
      try {
        attempts.push(this.historyAttempt(value, key, p, hash));
      } catch {
        this.warning = true;
      }
    }
    return attempts.slice(0, 7);
  }
  async recentPublished(
    entries: PublishedProblem[],
    load: (entry: PublishedProblem) => Promise<Puzzle>,
  ): Promise<{ records: Attempt[]; unavailable: boolean }> {
    this.wasCleared();
    const generation = this.clearGeneration;
    const allowed = new Map(
      entries
        .filter((e) => e.purpose === "production_daily")
        .map((e) => [e.puzzle_id, e]),
    );
    const puzzles = new Map<string, Puzzle | null>();
    const records: Attempt[] = [];
    let unavailable = false;
    for (const { key, value } of this.runRecords()) {
      const entry = allowed.get(value.puzzle_id);
      if (!entry || value.mode === "tutorial") continue;
      if (value.puzzle_hash !== entry.sha256) {
        this.warning = true;
        continue;
      }
      if (!puzzles.has(entry.puzzle_id)) {
        try {
          puzzles.set(
            entry.puzzle_id,
            await validatePublishedPuzzle(await load(entry), entry),
          );
        } catch {
          puzzles.set(entry.puzzle_id, null);
          unavailable = true;
        }
      }
      const p = puzzles.get(entry.puzzle_id);
      if (!p) continue;
      // Loading a payload may yield to deletion in this or another tab.
      this.wasCleared();
      if (generation !== this.clearGeneration)
        return { records: [], unavailable: false };
      const latest = this.get(key);
      if (!latest) continue;
      try {
        const a = this.historyAttempt(JSON.parse(latest), key, p, entry.sha256);
        if (a.mode !== "tutorial") records.push(a);
      } catch {
        this.warning = true;
      }
      if (records.length === 7) break;
    }
    this.wasCleared();
    if (generation !== this.clearGeneration)
      return { records: [], unavailable: false };
    return {
      records: records.filter((a) => this.get(`run:${a.run_id}`) !== null),
      unavailable,
    };
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
