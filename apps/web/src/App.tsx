import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  type Puzzle,
  type Piece,
  type Placement,
  type Attempt,
  type Cell,
  type Rotation,
  type PieceId,
  validatePuzzle,
  rotate,
  occupied,
  key,
  placementError,
  commit,
  complete,
  sixtyTag,
  hashPuzzle,
  hint,
  orientations,
} from "../../../packages/game-core";
import raw from "./fixture.json";
import playtestRaw from "./playtest.json";
import tutorialRaw from "./tutorial.json";
import { words, type Locale } from "./i18n";
import { store } from "./storage";
import { TransactionLease, withStorageMutation } from "./lease";
import type {
  PublishedProblem,
  ReleaseManifest,
} from "../../../packages/game-core/release.ts";
import ShareResult from "./ShareResult";
import RecentAttempts from "./RecentAttempts";
import { DailyStartError } from "./daily-start";
import {
  fixedPath,
  publicRoute,
  publicPracticeId,
  publicOrigin,
  publicMetadata,
} from "../../../packages/game-core/public-route.ts";
const playtest =
  import.meta.env.VITE_STAGE === "playtest" ||
  (import.meta.env.VITE_STAGE === "daily" &&
    /^\/(ja|en)\/p\/playtest-fixed-v1\/$/.test(location.pathname));
const puzzle = validatePuzzle(
    import.meta.env.VITE_STAGE === "playtest" ||
      import.meta.env.VITE_STAGE === "daily-preview" ||
      import.meta.env.VITE_STAGE === "daily"
      ? playtestRaw
      : raw,
  ),
  tutorialPuzzle = validatePuzzle(tutorialRaw);
type Selection = {
  piece_id: PieceId;
  rotation: Rotation;
  x: number;
  y: number;
};
type Drag = {
  selection: Selection;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  active: boolean;
  pointerId: number;
  touch: boolean;
};
function time(ms: number) {
  const sec = Math.ceil(ms / 1000);
  return `${Math.floor(sec / 60)
    .toString()
    .padStart(2, "0")}:${(sec % 60).toString().padStart(2, "0")}`;
}
function Mini({ piece, rotation = 0 }: { piece: Piece; rotation?: number }) {
  const cs = rotate(piece.cells, rotation),
    width = Math.max(...cs.map((c) => c[0])) + 1,
    height = Math.max(...cs.map((c) => c[1])) + 1;
  return (
    <svg
      className="mini"
      viewBox={`-2 -2 ${width * 22 + 4} ${height * 22 + 4}`}
      aria-hidden="true"
    >
      {cs.map(([x, y]) => (
        <g key={`${x},${y}`}>
          <rect
            x={x * 22 + 1}
            y={y * 22 + 1}
            width="20"
            height="20"
            rx="4"
            className={`fill-${piece.id}`}
          />
          <text x={x * 22 + 11} y={y * 22 + 15} textAnchor="middle">
            {piece.id}
          </text>
        </g>
      ))}
      <circle cx="1" cy="1" r="2" fill="#172b28" />
    </svg>
  );
}
export default function App({
  initialPuzzle = puzzle,
  reviewer = false,
  onAttempt,
  onReport,
  publication,
  beforeStart,
  historyEntries,
}: {
  initialPuzzle?: Puzzle;
  reviewer?: boolean;
  onAttempt?: (attempt: Attempt, locale: Locale) => void;
  onReport?: (attempt: Attempt, locale: Locale) => void;
  beforeStart?: (signal: AbortSignal) => Promise<boolean>;
  historyEntries?: (signal: AbortSignal) => Promise<PublishedProblem[]>;
  publication?: {
    entry: PublishedProblem;
    manifest: ReleaseManifest;
    fallback: boolean;
    updated?: boolean;
    archived?: boolean;
    denied?: "withdrawn" | "missing";
  };
} = {}) {
  const [locale, setLocale] = useState<Locale>(() =>
      location.pathname.startsWith("/en/") ? "en" : "ja",
    ),
    t = words[locale];
  const [p, setPuzzle] = useState(initialPuzzle),
    [hash, setHash] = useState(""),
    [a, setAttempt] = useState<Attempt | null>(null),
    [loading, setLoading] = useState(true),
    [fatal, setFatal] = useState(false),
    [selection, setSelection] = useState<Selection | null>(null),
    [message, setMessage] = useState(""),
    [checkingStart, setCheckingStart] = useState(false),
    [startingRun, setStartingRun] = useState(false),
    [startFailure, setStartFailure] = useState<DailyStartError["code"] | null>(
      null,
    ),
    [hintView, setHintView] = useState<ReturnType<typeof hint>>(null),
    [hintBusy, setHintBusy] = useState(false),
    [settings, setSettings] = useState(false),
    [preferences] = useState(() => store.preferences()),
    [timerVisible, setTimerVisible] = useState(
      preferences.timer_visible ?? true,
    ),
    [reduce, setReduce] = useState(preferences.reduce_motion ?? false),
    [blocked, setBlocked] = useState(false),
    [dragView, setDragView] = useState<{ x: number; y: number } | null>(null);
  const live = useRef<Attempt | null>(null),
    base = useRef(0),
    segment = useRef(0),
    wall = useRef(0),
    board = useRef<HTMLDivElement>(null),
    drag = useRef<Drag | null>(null),
    release = useRef<(() => void) | null>(null),
    worker = useRef<Worker | null>(null),
    generation = useRef(0),
    leaseId = useRef(crypto.randomUUID()),
    leaseTimer = useRef<ReturnType<typeof setInterval> | null>(null),
    settingsRef = useRef<HTMLDialogElement>(null);
  const leasePuzzle = useRef<string | null>(null);
  const leaseKind = useRef<"web" | "idb" | "memory" | null>(null);
  const fallback = useRef<TransactionLease | null>(null);
  const writes = useRef(Promise.resolve(true));
  const starting = useRef(false);
  const startAbort = useRef<AbortController | null>(null);
  const playing = a?.state === "playing",
    ended = a?.state === "completed" || a?.state === "revealed";
  const history = a?.undo_history ?? [];
  const publicationUnavailable =
    publication &&
    (publication.denied ||
      publication.manifest.recalled_ids.includes(publication.entry.puzzle_id) ||
      (!publication.archived &&
        !publication.manifest.recent.some(
          (e) =>
            e.puzzle_id === publication.entry.puzzle_id &&
            e.sha256 === publication.entry.sha256,
        )));
  // Start/resume after the board commits, excluding hash/lock/loading delays.
  useLayoutEffect(() => {
    if (live.current?.state === "playing") {
      base.current = live.current.active_elapsed_ms;
      segment.current = performance.now();
      wall.current = Date.now();
    }
  }, [a?.run_id, a?.state]);
  function update(next: Attempt | null) {
    live.current = next;
    setAttempt(next);
    if (next) onAttempt?.(structuredClone(next), locale);
  }
  function ownsLease(id: string) {
    if (leasePuzzle.current !== id) return false;
    return leaseKind.current !== null;
  }

  function loseLease() {
    const current = snapshot();
    invalidateHint();
    if (current)
      update({
        ...current,
        state: "paused",
        interrupted: true,
        finished_at_client: null,
      });
    setSelection(null);
    setDragView(null);
    drag.current = null;
    setBlocked(true);
    setMessage(t.conflict);
    stopLease();
  }
  function save(next: Attempt): Promise<boolean> {
    if (store.wasCleared()) {
      resetFromClear();
      return Promise.resolve(false);
    }
    if (!ownsLease(next.puzzle_id)) {
      loseLease();
      return Promise.resolve(false);
    }
    // Close terminal input immediately, but present a result after its save settles.
    const terminal = ["completed", "revealed", "abandoned"].includes(
      next.state,
    );
    if (terminal) live.current = next;
    else update(next);
    const owner = fallback.current;
    const write = () => {
      if (store.wasCleared()) {
        resetFromClear();
        return false;
      }
      const ok = ownsLease(next.puzzle_id) && store.save(next);
      if (
        ok &&
        store.warning &&
        live.current?.run_id === next.run_id &&
        live.current.mode === "first"
      )
        update({ ...live.current, mode: "practice" });
      return ok;
    };
    const result = writes.current.then(async () => {
      try {
        const ok = owner
          ? await owner.write(write)
          : leaseKind.current === "memory"
            ? write()
            : await withStorageMutation(write);
        if (!ok && live.current) loseLease();
        if (ok && terminal && live.current?.run_id === next.run_id)
          update(live.current);
        return ok;
      } catch {
        // An unavailable lock cannot authorize writes to shared records.
        loseLease();
        return false;
      }
    });
    writes.current = result;
    return result;
  }

  function resetFromClear() {
    invalidateHint();
    stopLease();
    store.discardCache();
    update(null);
    setSelection(null);
    setHintView(null);
    setDragView(null);
    drag.current = null;
    setBlocked(false);
    setMessage("");
    setStartFailure(null);
    setSettings(false);
    setPuzzle(initialPuzzle);
  }
  function elapsed() {
    const current = live.current;
    if (!current || current.state !== "playing")
      return current?.active_elapsed_ms ?? 0;
    const now = performance.now(),
      delta = now - segment.current,
      wd = Date.now() - wall.current;
    if (
      !Number.isFinite(delta) ||
      delta < 0 ||
      !Number.isFinite(wd) ||
      Math.abs(wd - delta) > 2000
    ) {
      current.clock_status = "uncertain";
    }
    return base.current + (Number.isFinite(delta) ? Math.max(0, delta) : 0);
  }
  function snapshot() {
    const current = live.current;
    if (!current) return null;
    const activeElapsed = elapsed();
    return { ...current, active_elapsed_ms: activeElapsed };
  }
  function invalidateHint() {
    generation.current++;
    startAbort.current?.abort();
    worker.current?.terminate();
    worker.current = null;
    setHintBusy(false);
    setHintView(null);
  }
  function stopLease() {
    leasePuzzle.current = null;
    leaseKind.current = null;
    release.current?.();
    release.current = null;
    if (leaseTimer.current) {
      clearInterval(leaseTimer.current);
      leaseTimer.current = null;
    }
    const old = fallback.current;
    fallback.current = null;
    void old?.release().catch(() => {});
  }
  async function claim(target: Puzzle, takeover = false): Promise<boolean> {
    if (ownsLease(target.puzzle_id)) return true;
    if (leasePuzzle.current) stopLease();
    if (navigator.locks) {
      if (takeover) {
        try {
          localStorage.setItem(
            `onebox:v1:takeover:${target.puzzle_id}`,
            crypto.randomUUID(),
          );
        } catch {
          return false;
        }
      }
      const controller = new AbortController();
      const deadline = takeover
        ? setTimeout(() => controller.abort(), 2500)
        : null;
      return new Promise((resolve) => {
        void navigator.locks
          .request(
            `onebox:${target.puzzle_id}`,
            takeover ? { signal: controller.signal } : { ifAvailable: true },
            async (lock) => {
              if (deadline) clearTimeout(deadline);
              if (!lock) {
                resolve(false);
                return;
              }
              leasePuzzle.current = target.puzzle_id;
              leaseKind.current = "web";
              resolve(true);
              await new Promise<void>((r) => {
                release.current = r;
              });
            },
          )
          .catch(() => {
            if (deadline) clearTimeout(deadline);
            resolve(false);
          });
      });
    }
    try {
      const owner = await TransactionLease.open(
        target.puzzle_id,
        leaseId.current,
      );
      if (!(await owner.claim(takeover))) {
        await owner.release();
        return false;
      }
      fallback.current = owner;
      leasePuzzle.current = target.puzzle_id;
      leaseKind.current = "idb";
      leaseTimer.current = setInterval(() => {
        // Heartbeats use the same transaction and fence as result writes.
        writes.current = writes.current.then(async () => {
          try {
            const ok = await owner.write(() => true);
            if (!ok) loseLease();
            return ok;
          } catch {
            loseLease();
            return false;
          }
        });
      }, 1000);
      return true;
    } catch {
      store.useMemoryOnly();
      leasePuzzle.current = target.puzzle_id;
      leaseKind.current = "memory";
      return true;
    }
  }

  useEffect(() => {
    let cancelled = false;
    hashPuzzle(p)
      .then(async (h) => {
        if (cancelled) return;
        setHash(h);
        if (live.current?.puzzle_id === p.puzzle_id) {
          setLoading(false);
          return;
        }
        let saved: Attempt | null;
        try {
          saved = await withStorageMutation(() => store.read(p, h));
        } catch {
          store.useMemoryOnly();
          saved = store.read(p, h);
        }
        if (cancelled) return;
        if (saved) {
          if (saved.state === "playing" || saved.state === "paused")
            update({
              ...saved,
              timer_visible: preferences.timer_visible ?? saved.timer_visible,
              state: "paused",
              interrupted: true,
              clock_status:
                saved.clock_status === "uncertain" ? "uncertain" : "resumed",
            });
          else
            update({
              ...saved,
              timer_visible: preferences.timer_visible ?? saved.timer_visible,
            });
          setTimerVisible(preferences.timer_visible ?? saved.timer_visible);
        }
        setLoading(false);
      })
      .catch(() => {
        setFatal(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [p]);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title =
      locale === "ja"
        ? "ONEBOX — 4つの形を、ひとつの箱に。"
        : "ONEBOX — Four pieces. One perfect fit.";
    if (playtest && !reviewer) {
      const route = publicRoute(location.pathname, location.search);
      if (route) {
        const path = route.fixed ? fixedPath(locale) : `/${locale}/`;
        window.history.replaceState(null, "", path + location.search);
        document
          .querySelector('link[rel="canonical"]')
          ?.setAttribute("href", publicOrigin + path);
        document
          .querySelector('meta[property="og:url"]')
          ?.setAttribute("content", publicOrigin + path);
        const meta = publicMetadata(locale);
        document
          .querySelector('meta[name="description"]')
          ?.setAttribute("content", meta.description);
        document
          .querySelector('meta[property="og:title"]')
          ?.setAttribute("content", meta.title);
        document
          .querySelector('meta[property="og:description"]')
          ?.setAttribute("content", meta.description);
      }
    }
    if (publication) {
      const fixed = /\/p\//.test(location.pathname);
      const path = fixed
        ? `/${locale}/p/${publication.entry.slug}/`
        : `/${locale}/`;
      window.history.replaceState(
        null,
        "",
        (fixed ? `/${locale}/p/${publication.entry.slug}/` : `/${locale}/`) +
          location.search,
      );
      document
        .querySelector('link[rel="canonical"]')
        ?.setAttribute("href", publicOrigin + path);
      document
        .querySelector('meta[property="og:url"]')
        ?.setAttribute("content", publicOrigin + path);
    }
  }, [locale]);
  useEffect(() => {
    if (settings) settingsRef.current?.showModal();
    else settingsRef.current?.close();
  }, [settings]);
  useEffect(() => {
    const tick = setInterval(() => {
      const next = snapshot();
      if (next?.state === "playing" && !blocked) save(next);
    }, 500);
    function hidden() {
      if (document.hidden) pause();
    }
    async function leaving() {
      await pause();
      stopLease();
    }
    function external(e: StorageEvent) {
      if (
        e.key === "onebox:v1:clear-generation" ||
        (e.key === `onebox:v1:current:${p.puzzle_id}` && e.newValue === null)
      ) {
        store.wasCleared();
        resetFromClear();
        return;
      }
      if (
        e.key === `onebox:v1:takeover:${p.puzzle_id}` &&
        leaseKind.current === "web"
      ) {
        const current = snapshot();
        invalidateHint();
        if (current?.state === "playing")
          void save({ ...current, state: "paused", interrupted: true }).then(
            loseLease,
          );
        else loseLease();
        return;
      }
      if (
        e.key === `onebox:v1:current:${p.puzzle_id}` &&
        live.current &&
        e.newValue
      ) {
        try {
          const other = JSON.parse(e.newValue);
          if (other.run_id !== live.current.run_id) {
            loseLease();
          }
        } catch {
          /* corrupt external state does not replace current */
        }
      }
    }
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leaving);
    window.addEventListener("storage", external);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leaving);
      window.removeEventListener("storage", external);
    };
  }, [p, locale, blocked]);
  useEffect(
    () => () => {
      startAbort.current?.abort();
      worker.current?.terminate();
      stopLease();
    },
    [],
  );
  async function start(
    target = p,
    mode?: Attempt["mode"],
    initial: Placement[] = [],
    takeover = false,
  ) {
    if (starting.current) return;
    starting.current = true;
    setStartingRun(true);
    setStartFailure(null);
    try {
      await startRun(target, mode, initial, takeover);
    } finally {
      starting.current = false;
      setStartingRun(false);
    }
  }
  async function startRun(
    target = p,
    mode?: Attempt["mode"],
    initial: Placement[] = [],
    takeover = false,
  ) {
    if (loading) return;
    await writes.current;
    invalidateHint();
    const startGeneration = generation.current;
    if (leasePuzzle.current !== target.puzzle_id) stopLease();
    const claimed = await claim(target, takeover);
    if (startGeneration !== generation.current) {
      if (!live.current) stopLease();
      return;
    }
    if (!claimed) {
      setBlocked(true);
      setMessage(t.conflict);
      return;
    }
    if (store.wasCleared()) {
      resetFromClear();
      return;
    }
    setBlocked(false);
    const h = await hashPuzzle(target);
    if (startGeneration !== generation.current) {
      if (!live.current) stopLease();
      return;
    }
    setPuzzle(target);
    setHash(h);
    const saved =
      leaseKind.current === "memory"
        ? store.read(target, h)
        : await withStorageMutation(() => store.read(target, h));
    setSelection(null);
    setMessage("");
    if (
      !mode &&
      saved &&
      (saved.state === "playing" || saved.state === "paused")
    ) {
      const next = {
        ...saved,
        timer_visible: timerVisible,
        mode:
          leaseKind.current === "memory" ? ("practice" as const) : saved.mode,
        state: "playing" as const,
        interrupted: true,
        clock_status:
          saved.clock_status === "uncertain"
            ? ("uncertain" as const)
            : ("resumed" as const),
      };
      base.current = next.active_elapsed_ms;
      segment.current = performance.now();
      wall.current = Date.now();
      await save(next);
    } else {
      let practiceOnly = false;
      if (
        beforeStart &&
        target.puzzle_id === publication?.entry.puzzle_id &&
        mode !== "tutorial"
      ) {
        const controller = new AbortController();
        startAbort.current = controller;
        setCheckingStart(true);
        try {
          practiceOnly = await beforeStart(controller.signal);
        } catch (e) {
          if (startGeneration === generation.current)
            setStartFailure(e instanceof DailyStartError ? e.code : "invalid");
          stopLease();
          return;
        } finally {
          setCheckingStart(false);
          if (startAbort.current === controller) startAbort.current = null;
        }
        if (
          startGeneration !== generation.current ||
          !ownsLease(target.puzzle_id)
        ) {
          if (!live.current) stopLease();
          return;
        }
        if (store.wasCleared()) {
          resetFromClear();
          return;
        }
      }
      const next: Attempt = {
        record_version: 1,
        run_id: crypto.randomUUID(),
        puzzle_id: target.puzzle_id,
        puzzle_hash: h,
        rules_version: target.rules_version,
        mode:
          mode === "tutorial"
            ? "tutorial"
            : mode === "practice" ||
                practiceOnly ||
                store.warning ||
                (playtest && !reviewer) ||
                publication?.fallback ||
                publication?.updated ||
                publication?.manifest.release_status === "delayed"
              ? "practice"
              : store.mode(target),
        state: "playing",
        placements: initial,
        active_elapsed_ms: 0,
        interrupted: false,
        clock_status: "continuous",
        hint_count: 0,
        timer_visible: timerVisible,
        started_at_client: new Date().toISOString(),
        finished_at_client: null,
        undo_history: [],
      };
      base.current = 0;
      segment.current = performance.now();
      wall.current = Date.now();
      await save(next);
    }
  }
  async function pause() {
    const current = snapshot();
    if (current?.state === "playing") {
      invalidateHint();
      setSelection(null);
      setDragView(null);
      drag.current = null;
      await save({ ...current, state: "paused", interrupted: true });
    }
    await writes.current;
  }
  async function changePlacement(q: Placement) {
    const current = snapshot();
    if (current?.state !== "playing" || blocked) return;
    const err = placementError(p, current.placements, q);
    if (err) {
      setMessage(t[err]);
      return;
    }
    const placements = commit(p, current.placements, q);
    invalidateHint();
    const done = complete(p, placements);
    setSelection(null);
    setMessage(done ? t.done : t.placed);
    const saved = await save({
      ...current,
      placements,
      undo_history: [...(current.undo_history ?? []), current.placements].slice(
        -512,
      ),
      state: done ? "completed" : "playing",
      finished_at_client: done ? new Date().toISOString() : null,
    });
    if (done && saved) stopLease();
  }
  function select(id: PieceId) {
    if (!playing || blocked) return;
    const existing = a.placements.find((q) => q.piece_id === id),
      piece = p.pieces.find((q) => q.id === id)!;
    setSelection(
      existing ?? {
        piece_id: id,
        rotation: piece.initial_rotation,
        x: 0,
        y: 0,
      },
    );
    setMessage("");
  }
  function doRotate() {
    if (selection && playing) {
      setSelection({
        ...selection,
        rotation: ((selection.rotation + 1) % 4) as Rotation,
      });
      setHintView(null);
    }
  }
  function remove() {
    const current = snapshot();
    if (!selection || current?.state !== "playing" || blocked) return;
    const placements = current.placements.filter(
      (q) => q.piece_id !== selection.piece_id,
    );
    if (placements.length !== current.placements.length) {
      invalidateHint();
      save({
        ...current,
        placements,
        undo_history: [
          ...(current.undo_history ?? []),
          current.placements,
        ].slice(-512),
      });
      setMessage(t.returned);
    }
    setSelection(null);
  }
  function undo() {
    const current = snapshot();
    if (current?.state !== "playing" || blocked) return;
    if (selection) {
      setSelection(null);
      return;
    }
    if (history.length) {
      save({
        ...current,
        placements: history[history.length - 1],
        undo_history: history.slice(0, -1),
      });
      invalidateHint();
      setMessage(t.undone);
    }
  }
  async function practice() {
    if (a?.state === "playing" || a?.state === "paused") {
      if (!confirm(t.restartConfirm)) return;
      const old = snapshot()!;
      if (
        !(await save({
          ...old,
          state: "abandoned",
          finished_at_client: new Date().toISOString(),
        }))
      )
        return;
    }
    await start(p, "practice");
  }
  function requestSolution(
    reveal = false,
    target = p,
    onSolution?: (s: Placement[]) => void,
  ) {
    if (reveal && !confirm(t.revealConfirm)) return;
    if (!onSolution && (!playing || blocked)) return;
    invalidateHint();
    setHintBusy(true);
    const token = generation.current;
    let w: Worker;
    try {
      w = new Worker(new URL("./hint.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      setHintBusy(false);
      setMessage(t.hintFail);
      return;
    }
    worker.current = w;
    function timeout() {
      w.terminate();
      if (token === generation.current) {
        setHintBusy(false);
        setMessage(t.hintFail);
      }
    }
    // Network/startup may take longer than the bounded local search.
    let deadline = setTimeout(timeout, 6000);
    w.onerror = () => {
      clearTimeout(deadline);
      w.terminate();
      if (token === generation.current) {
        setHintBusy(false);
        setMessage(t.hintFail);
      }
    };
    w.onmessage = async (e) => {
      if (e.data.ready === true) {
        clearTimeout(deadline);
        if (token === generation.current) deadline = setTimeout(timeout, 2500);
        return;
      }
      clearTimeout(deadline);
      w.terminate();
      if (token !== generation.current) return;
      setHintBusy(false);
      const sol = e.data.solution as Placement[] | undefined;
      if (!sol) {
        setMessage(t.hintFail);
        return;
      }
      if (onSolution) {
        onSolution(sol);
        return;
      }
      const current = snapshot();
      if (current?.state !== "playing") return;
      if (reveal) {
        await save({
          ...current,
          state: "revealed",
          placements: sol,
          finished_at_client: new Date().toISOString(),
        });
        setSelection(null);
        setMessage(t.revealed);
        stopLease();
      } else {
        const h = hint(p, current.placements, sol);
        if (h) {
          setHintView(h);
          save({ ...current, hint_count: current.hint_count + 1 });
          setMessage(
            (h.kind === "remove" ? t.hintRemove : t.hintPlace) +
              h.placement.piece_id,
          );
        }
      }
    };
    w.postMessage(target);
  }
  function tutorial() {
    requestSolution(false, tutorialPuzzle, (sol) => {
      void start(
        tutorialPuzzle,
        "tutorial",
        sol.filter((q) => q.piece_id !== "A"),
      );
    });
  }
  function cellAt(clientX: number, clientY: number) {
    const r = board.current?.getBoundingClientRect();
    if (
      !r ||
      clientX < r.left ||
      clientX >= r.right ||
      clientY < r.top ||
      clientY >= r.bottom
    )
      return null;
    return [
      Math.floor((clientX - r.left) / (r.width / 5)),
      Math.floor((clientY - r.top) / (r.height / 5)),
    ] as Cell;
  }
  function dragStart(e: ReactPointerEvent, id: PieceId, fromBoard = false) {
    if (!playing || blocked || e.button !== 0 || drag.current) return;
    const current = a.placements.find((q) => q.piece_id === id),
      piece = p.pieces.find((q) => q.id === id)!,
      s =
        selection?.piece_id === id
          ? selection
          : (current ?? {
              piece_id: id,
              rotation: piece.initial_rotation,
              x: 0,
              y: 0,
            });
    let dx = 0,
      dy = 0;
    if (fromBoard && current) {
      const c = cellAt(e.clientX, e.clientY);
      if (c) {
        dx = c[0] - current.x;
        dy = c[1] - current.y;
      }
    } else {
      const svg = e.currentTarget.querySelector("svg") as SVGSVGElement | null;
      if (svg) {
        const point = svg.createSVGPoint();
        point.x = e.clientX;
        point.y = e.clientY;
        const matrix = svg.getScreenCTM();
        if (matrix) {
          const local = point.matrixTransform(matrix.inverse()),
            cs = rotate(piece.cells, s.rotation),
            w = Math.max(...cs.map((c) => c[0])) + 1,
            h = Math.max(...cs.map((c) => c[1])) + 1;
          dx = Math.max(0, Math.min(w - 1, Math.floor(local.x / 22)));
          dy = Math.max(0, Math.min(h - 1, Math.floor(local.y / 22)));
        }
      }
    }
    drag.current = {
      selection: s,
      startX: e.clientX,
      startY: e.clientY,
      dx,
      dy,
      active: false,
      pointerId: e.pointerId,
      touch: e.pointerType === "touch",
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function moveDrag(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 8 && !d.active)
      return;
    d.active = true;
    const y = e.clientY - (d.touch ? 56 : 0),
      c = cellAt(e.clientX, y);
    setDragView({ x: e.clientX, y });
    if (c) setSelection({ ...d.selection, x: c[0] - d.dx, y: c[1] - d.dy });
    else setSelection({ ...d.selection, x: -6, y: -6 });
  }
  function endDrag(e: ReactPointerEvent, cancelled = false) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    setDragView(null);
    if (d.active) {
      e.preventDefault();
      const c = cellAt(e.clientX, e.clientY - (d.touch ? 56 : 0));
      if (!cancelled && c)
        changePlacement({ ...d.selection, x: c[0] - d.dx, y: c[1] - d.dy });
      setSelection(null);
      suppressClick.current = true;
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    }
  }
  const suppressClick = useRef(false);
  function keyboard(e: React.KeyboardEvent) {
    if (!playing || blocked || !selection) return;
    const delta: Record<string, Cell> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (delta[e.key]) {
      e.preventDefault();
      const [dx, dy] = delta[e.key];
      setSelection({
        ...selection,
        x: Math.max(-4, Math.min(4, selection.x + dx)),
        y: Math.max(-4, Math.min(4, selection.y + dy)),
      });
    } else if (e.key.toLowerCase() === "r") {
      e.preventDefault();
      doRotate();
    } else if (e.key === "Enter") {
      e.preventDefault();
      changePlacement(selection);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setSelection(null);
    }
  }
  const placed = new Map(
      (a?.placements ?? []).flatMap((q) =>
        occupied(p, q).map((c) => [key(c), q.piece_id] as const),
      ),
    ),
    pre = new Set(selection ? occupied(p, selection).map(key) : []),
    ghost = new Set(
      hintView?.kind === "place"
        ? occupied(p, hintView.placement).map(key)
        : [],
    ),
    invalid = selection && placementError(p, a?.placements ?? [], selection);
  if (fatal)
    return (
      <main>
        <h1>{t.loadError}</h1>
        <button onClick={() => location.reload()}>{t.retry}</button>
      </main>
    );
  return (
    <div
      className={`${reduce ? "app reduce" : "app"}${playing ? " is-playing" : ""}`}
    >
      <header>
        <a className="brand" href="/" aria-label="ONEBOX">
          <span className="brand-box">▦</span> ONEBOX
        </a>
        <nav>
          <button
            className="lang"
            onClick={() => setLocale(locale === "ja" ? "en" : "ja")}
            aria-label="Language"
          >
            {locale === "ja" ? "EN" : "日本語"}
          </button>
          <button
            className="settings-button"
            onClick={() => setSettings(true)}
            aria-label={t.settings}
          >
            ☷
          </button>
        </nav>
      </header>
      <main>
        <div className="eyebrow">
          <span className="dot" />
          {reviewer
            ? locale === "ja"
              ? "未承認候補 · PC内の試遊"
              : "Unapproved candidate · Local trial"
            : publication
              ? `${publication.entry.edition_utc} · ${import.meta.env.VITE_STAGE === "daily" ? (locale === "ja" ? "日替わりパズル" : "Daily puzzle") : locale === "ja" ? "日次のローカル検証版" : "Local daily preview"}`
              : playtest
                ? t.playtestEdition
                : t.edition}
        </div>
        {publication && (
          <p className="local-note" role="status">
            {publicationUnavailable
              ? locale === "ja"
                ? "この画面の問題では、新しい挑戦を開始できません。"
                : "New attempts on this puzzle are unavailable."
              : publication.updated
                ? locale === "ja"
                  ? "新しい問題が公開されています。この画面の問題で新しく遊ぶ場合は練習になります。"
                  : "A new puzzle is available. New attempts on this screen are practice."
                : publication.fallback ||
                    publication.manifest.release_status === "delayed"
                  ? locale === "ja"
                    ? `${publication.entry.edition_utc}版の取得済み問題です。新しい挑戦は練習になります。`
                    : `Cached edition ${publication.entry.edition_utc}. New attempts are practice.`
                  : import.meta.env.VITE_STAGE === "daily"
                    ? locale === "ja"
                      ? "世界共通、毎日ひとつの箱。"
                      : "One shared puzzle, every day."
                    : locale === "ja"
                      ? "日次配信のローカル検証用です。一般公開ではありません。"
                      : "Local daily delivery preview. This is not a public release."}
            {publication.manifest.next_update_at &&
              !publication.fallback &&
              !publication.updated &&
              !publicationUnavailable &&
              ` ${locale === "ja" ? "更新予定" : "Scheduled update"}: ${new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(publication.manifest.next_update_at))}`}
          </p>
        )}
        {!a ? (
          <section className="welcome">
            <div className="intro-art" aria-hidden="true">
              <div className="art-box">
                {["A", "B", "C", "D"].map((id) => (
                  <span key={id} className={`art-piece ${id}`}>
                    {id}
                  </span>
                ))}
              </div>
              <span className="art-caption">4 → 1</span>
            </div>
            <h1>
              {locale === "ja" ? (
                <>
                  4つの形を、
                  <br />
                  ひとつの箱に。
                </>
              ) : (
                <>
                  Four pieces.
                  <br />
                  One perfect fit.
                </>
              )}
            </h1>
            <p className="subtitle">{t.subtitle}</p>
            <p className="goal">{t.goal}</p>
            <button
              className="primary start"
              disabled={loading || hintBusy || startingRun}
              onClick={() => void start()}
            >
              {loading ? t.wait : t.start}
              <span>↗</span>
            </button>
            {!reviewer && (
              <button
                className="text-button"
                disabled={loading || hintBusy || startingRun}
                onClick={tutorial}
              >
                {t.tutorial} →
              </button>
            )}
            <label className="timer-option">
              <input
                type="checkbox"
                checked={timerVisible}
                onChange={(e) => {
                  setTimerVisible(e.target.checked);
                  store.setPreferences(e.target.checked, reduce);
                }}
              />
              {t.timer}
            </label>
            <p className="local-note">
              {publication && import.meta.env.VITE_STAGE === "daily"
                ? locale === "ja"
                  ? "登録不要。時間を気にせず遊ぶこともできます。"
                  : "No sign-up. Play without the timer if you prefer."
                : playtest
                  ? t.playtestNote
                  : t.localOnly}
            </p>
          </section>
        ) : (
          <section className="game" aria-label="Game">
            <div className="game-title">
              <div>
                <h1>{a.mode === "tutorial" ? t.tutorialMode : "THE BOX"}</h1>
                <span className="puzzle-id">
                  #{p.puzzle_id} ·{" "}
                  {a.mode === "first"
                    ? t.first
                    : a.mode === "tutorial"
                      ? t.tutorialMode
                      : t.practice}
                </span>
              </div>
              {a.timer_visible && (
                <span className="clock" aria-label={t.timer}>
                  {time(a.active_elapsed_ms)}
                </span>
              )}
            </div>
            {a.state === "paused" ? (
              <div className="pause-cover">
                <span>Ⅱ</span>
                <h2>{t.paused}</h2>
                <p>{t.pauseText}</p>
                <button
                  className="primary"
                  disabled={startingRun}
                  onClick={() => void start()}
                >
                  {t.resume} →
                </button>
              </div>
            ) : (
              <>
                <div
                  className={`board-wrap${a.state === "completed" ? " completed" : ""}`}
                >
                  <div
                    className="board"
                    ref={board}
                    role="group"
                    aria-label={
                      locale === "ja" ? "5行5列の盤面" : "5 by 5 board"
                    }
                    tabIndex={playing ? 0 : -1}
                    onKeyDown={keyboard}
                  >
                    {Array.from({ length: 25 }, (_, i) => {
                      const c: Cell = [i % 5, Math.floor(i / 5)],
                        k = key(c),
                        fixed = p.board.blocked.some((v) => key(v) === k),
                        id = placed.get(k),
                        preview = pre.has(k),
                        hinted = ghost.has(k),
                        anchor = selection?.x === c[0] && selection?.y === c[1];
                      return (
                        <button
                          key={k}
                          type="button"
                          data-cell={k}
                          className={`cell ${fixed ? "fixed" : ""} ${id ? `piece-${id}` : ""} ${preview ? `preview ${invalid ? "invalid" : `piece-${selection!.piece_id}`}` : ""} ${hinted ? "hint-cell" : ""} ${anchor ? "anchor" : ""}`}
                          disabled={!playing || blocked}
                          tabIndex={-1}
                          aria-label={`${c[1] + 1}${t.row} ${c[0] + 1}${t.col}: ${fixed ? t.fixed : (id ?? t.empty)}${preview ? " " + t.preview : ""}${hinted ? " " + t.hintGhost : ""}${anchor ? " " + t.anchor : ""}`}
                          onPointerDown={(e) => {
                            if (id) dragStart(e, id, true);
                          }}
                          onPointerMove={moveDrag}
                          onPointerUp={(e) => endDrag(e)}
                          onPointerCancel={(e) => endDrag(e, true)}
                          onLostPointerCapture={(e) => endDrag(e, true)}
                          onClick={() => {
                            if (suppressClick.current) return;
                            if (selection)
                              setSelection({ ...selection, x: c[0], y: c[1] });
                            else if (id) select(id);
                          }}
                        >
                          {preview
                            ? selection!.piece_id
                            : (id ??
                              (fixed
                                ? ""
                                : hinted
                                  ? hintView!.placement.piece_id
                                  : ""))}
                          {anchor && <span className="anchor-mark">⌜</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div
                  className="tray"
                  aria-label={locale === "ja" ? "ピース" : "Pieces"}
                >
                  {p.pieces.map((piece) => {
                    const used = a.placements.some(
                        (q) => q.piece_id === piece.id,
                      ),
                      r =
                        selection?.piece_id === piece.id
                          ? selection.rotation
                          : piece.initial_rotation;
                    const cs = rotate(piece.cells, r);
                    return (
                      <button
                        key={piece.id}
                        data-piece={piece.id}
                        className={`tray-piece ${selection?.piece_id === piece.id ? "selected" : ""} ${used ? "used" : ""}`}
                        disabled={!playing || blocked}
                        aria-pressed={selection?.piece_id === piece.id}
                        aria-label={`${piece.id}: ${cs.map(([x, y]) => `${y + 1}${t.row}${x + 1}${t.col}`).join(", ")}`}
                        onClick={() => {
                          if (!suppressClick.current) select(piece.id);
                        }}
                        onPointerDown={(e) => dragStart(e, piece.id)}
                        onPointerMove={moveDrag}
                        onPointerUp={(e) => endDrag(e)}
                        onPointerCancel={(e) => endDrag(e, true)}
                        onLostPointerCapture={(e) => endDrag(e, true)}
                      >
                        <Mini piece={piece} rotation={r} />
                        <span className="piece-caption">
                          {piece.id}
                          <span>{used ? "✓" : "↻"}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {playing && (
              <>
                <div className="status" role="status">
                  {(selection
                    ? `${t.selected}: ${selection.piece_id} · ${invalid ? t[invalid] : t.legal} `
                    : "") +
                    (message ||
                      (selection
                        ? `${t.selected}: ${selection.piece_id} · ${t.origin}`
                        : a.mode === "tutorial"
                          ? t.tutorialText
                          : t.ready))}
                </div>
                <div className="controls">
                  <button disabled={!selection || blocked} onClick={doRotate}>
                    ↻ <span>{t.rotate}</span>
                  </button>
                  <button
                    className="primary"
                    disabled={!selection || blocked}
                    onClick={() => selection && changePlacement(selection)}
                  >
                    ＋ <span>{t.place}</span>
                  </button>
                  <button disabled={!selection || blocked} onClick={remove}>
                    ↩ <span>{t.remove}</span>
                  </button>
                  <button
                    disabled={(!history.length && !selection) || blocked}
                    onClick={undo}
                  >
                    ← <span>{t.undo}</span>
                  </button>
                </div>
                <div className="secondary-controls">
                  <button
                    disabled={hintBusy || blocked}
                    onClick={() => requestSolution()}
                  >
                    ✧ {hintBusy ? t.wait : t.hint}
                    {a.hint_count > 0 ? ` · ${a.hint_count}` : ""}
                  </button>
                  <button onClick={pause}>Ⅱ {t.pause}</button>
                </div>
                <div className="quiet-controls">
                  <button
                    onClick={() => {
                      setSelection(null);
                      setHintView(null);
                    }}
                    disabled={!selection && !hintView}
                  >
                    {t.cancel}
                  </button>
                  <button
                    onClick={() => requestSolution(true)}
                    disabled={hintBusy || blocked}
                  >
                    {t.reveal}
                  </button>
                </div>
                {a.active_elapsed_ms >= 60000 && (
                  <p className="goal">{t.overtime}</p>
                )}
              </>
            )}
            {ended && (
              <div className="result" role="status">
                <div className="result-symbol">
                  {a.state === "completed" ? "✦" : "◇"}
                </div>
                <h2>{a.state === "completed" ? t.done : t.revealed}</h2>
                <p>{a.state === "completed" ? t.doneText : t.revealedText}</p>
                <div className="result-meta">
                  <span>
                    {t.hintUsed}: {a.hint_count}
                  </span>
                  <span>{a.interrupted ? t.interrupted : t.continuous}</span>
                  <span>
                    {a.mode === "first"
                      ? t.first
                      : a.mode === "tutorial"
                        ? t.tutorialMode
                        : t.practice}
                  </span>
                </div>
                {!reviewer && a.timer_visible && sixtyTag(a) && (
                  <p className="badge">{t.sixty}</p>
                )}
                <p className="local-note">{t.noOfficial}</p>
              </div>
            )}
            <div className="bottom-actions">
              {!reviewer &&
                a.state === "completed" &&
                startFailure !== "withdrawn" &&
                startFailure !== "missing" &&
                !publicationUnavailable &&
                ((publication && p.puzzle_id === publication.entry.puzzle_id) ||
                  (playtest &&
                    a.mode === "practice" &&
                    p.puzzle_id === publicPracticeId)) && (
                  <ShareResult
                    attempt={a}
                    locale={locale}
                    published={publication?.entry}
                  />
                )}
              {ended &&
                publication &&
                publication.entry.puzzle_id !==
                  publication.manifest.active.puzzle_id && (
                  <a className="text-button" href={`/${locale}/`}>
                    {locale === "ja" ? "今日の問題へ" : "Go to today's puzzle"}
                  </a>
                )}
              {reviewer && a.state === "abandoned" && (
                <p role="status">
                  {locale === "ja"
                    ? "この試遊は未完了で終了しました。"
                    : "This trial ended unfinished."}
                </p>
              )}
              {onReport && (
                <button
                  onClick={async () => {
                    if (
                      ["playing", "paused"].includes(live.current?.state ?? "")
                    ) {
                      const owned = ownsLease(p.puzzle_id);
                      if (!(await claim(p))) {
                        setBlocked(true);
                        setMessage(t.conflict);
                        return;
                      }
                      if (!owned) {
                        const saved = store.read(p, hash);
                        if (!saved || saved.run_id !== live.current?.run_id) {
                          loseLease();
                          return;
                        }
                        update(
                          ["playing", "paused"].includes(saved.state)
                            ? { ...saved, state: "paused", interrupted: true }
                            : saved,
                        );
                      }
                      const current = snapshot();
                      if (!current) return;
                      if (
                        ["playing", "paused"].includes(current.state) &&
                        !(await save({
                          ...current,
                          state: "abandoned",
                          interrupted: true,
                          finished_at_client: new Date().toISOString(),
                        }))
                      )
                        return;
                      invalidateHint();
                      setSelection(null);
                      stopLease();
                    }
                    const current = snapshot();
                    if (current) onReport(current, locale);
                  }}
                  disabled={blocked || loading}
                >
                  {["playing", "paused"].includes(a.state)
                    ? locale === "ja"
                      ? "終了して試遊を記録"
                      : "End and record this trial"
                    : locale === "ja"
                      ? "この試遊を記録"
                      : "Record this trial"}
                </button>
              )}
              <button
                className={
                  ended &&
                  !(
                    playtest &&
                    !reviewer &&
                    p.puzzle_id === publicPracticeId &&
                    a.state === "completed"
                  )
                    ? "primary"
                    : "text-button"
                }
                onClick={() => void practice()}
                disabled={blocked || startingRun}
              >
                {t.restart} →
              </button>
              {a.mode === "tutorial" && ended && (
                <button
                  className="text-button"
                  onClick={() => {
                    stopLease();
                    update(null);
                    setPuzzle(initialPuzzle);
                    setLoading(true);
                  }}
                >
                  {t.start} →
                </button>
              )}
            </div>
          </section>
        )}
        {checkingStart && (
          <p role="status">
            {locale === "ja"
              ? "公開状態を確認しています…"
              : "Checking puzzle availability…"}
          </p>
        )}
        {startFailure && (
          <p role="alert" className="notice">
            {startFailure === "withdrawn"
              ? locale === "ja"
                ? "この問題は公開を取り下げました。新しい挑戦は開始できません。"
                : "This puzzle has been withdrawn. New attempts are unavailable."
              : startFailure === "missing"
                ? locale === "ja"
                  ? "この問題は現在公開されていません。新しい挑戦は開始できません。"
                  : "This puzzle is no longer listed. New attempts are unavailable."
                : locale === "ja"
                  ? "公開状態を確認できませんでした。もう一度、開始操作で再確認してください。"
                  : "Could not verify puzzle availability. Try starting again to recheck."}
          </p>
        )}
        {publication &&
          (startFailure || publication.updated || publicationUnavailable) && (
            <p>
              <a className="navigation-link" href={`/${locale}/`}>
                {locale === "ja"
                  ? "公開中の問題を確認"
                  : "Check available puzzles"}
              </a>
            </p>
          )}
        {blocked && (
          <div className="notice" role="alert">
            <p>{t.conflict}</p>
            <button onClick={() => void start(p, undefined, [], true)}>
              {t.takeover}
            </button>
          </div>
        )}
        {store.warning && (
          <p className="notice" role="status">
            {t.noSave}
          </p>
        )}
        {!reviewer &&
          (publication ||
            (playtest && initialPuzzle.puzzle_id === publicPracticeId)) && (
            <RecentAttempts
              puzzle={initialPuzzle}
              locale={locale}
              timerVisible={timerVisible}
              onOpen={pause}
              manifest={publication?.manifest}
              loadEntries={historyEntries}
              currentEntry={publication?.entry}
            />
          )}
        <footer>
          <span>ONE BOX. A LITTLE JOY.</span>
          <p>{t.noTracking}</p>
        </footer>
      </main>
      <dialog
        ref={settingsRef}
        onCancel={() => setSettings(false)}
        onClose={() => setSettings(false)}
      >
        <div className="dialog-header">
          <h2>{t.settings}</h2>
          <button onClick={() => setSettings(false)} aria-label={t.close}>
            ×
          </button>
        </div>
        <p>{t.help}</p>
        <p>{t.keys}</p>
        <label>
          <input
            type="checkbox"
            checked={timerVisible}
            onChange={(e) => {
              setTimerVisible(e.target.checked);
              store.setPreferences(e.target.checked, reduce);
              const cur = snapshot();
              if (cur) {
                if (
                  ["playing", "paused"].includes(cur.state) &&
                  ownsLease(p.puzzle_id)
                )
                  save({ ...cur, timer_visible: e.target.checked });
                else update({ ...cur, timer_visible: e.target.checked });
              }
            }}
          />
          {t.timer}
        </label>
        <label>
          <input
            type="checkbox"
            checked={reduce}
            onChange={(e) => {
              setReduce(e.target.checked);
              store.setPreferences(timerVisible, e.target.checked);
            }}
          />
          {t.motion}
        </label>
        <p>{t.sound}</p>
        {!reviewer && (
          <button
            className="danger"
            onClick={async () => {
              if (confirm(t.clearConfirm)) {
                await writes.current;
                if (fallback.current)
                  await fallback.current.clear(() => store.clear());
                else {
                  try {
                    await withStorageMutation(() => store.clear());
                  } catch {
                    store.useMemoryOnly();
                    store.clear();
                  }
                }
                invalidateHint();
                stopLease();
                update(null);
                setSelection(null);
                setPuzzle(initialPuzzle);
                setSettings(false);
              }
            }}
          >
            {t.clear}
          </button>
        )}
      </dialog>
      {dragView && selection && (
        <div
          className="drag-ghost"
          style={{ left: dragView.x, top: dragView.y }}
        >
          <Mini
            piece={p.pieces.find((q) => q.id === selection.piece_id)!}
            rotation={selection.rotation}
          />
        </div>
      )}
    </div>
  );
}
