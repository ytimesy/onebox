import {
  useEffect,
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
import ShareResult from "./ShareResult";
import RecentAttempts from "./RecentAttempts";
import {
  fixedPath,
  publicRoute,
  publicPracticeId,
  publicOrigin,
  publicMetadata,
} from "../../../packages/game-core/public-route.ts";
const playtest = import.meta.env.VITE_STAGE === "playtest";
const puzzle = validatePuzzle(playtest ? playtestRaw : raw),
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
  const sec = Math.floor(ms / 1000);
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
}: {
  initialPuzzle?: Puzzle;
  reviewer?: boolean;
  onAttempt?: (attempt: Attempt, locale: Locale) => void;
  onReport?: (attempt: Attempt, locale: Locale) => void;
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
    [history, setHistory] = useState<Placement[][]>([]),
    [hintView, setHintView] = useState<ReturnType<typeof hint>>(null),
    [hintBusy, setHintBusy] = useState(false),
    [settings, setSettings] = useState(false),
    [timerVisible, setTimerVisible] = useState(true),
    [reduce, setReduce] = useState(false),
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
  const leaseKind = useRef<"web" | "local" | "memory" | null>(null);
  const playing = a?.state === "playing",
    ended = a?.state === "completed" || a?.state === "revealed";
  function update(next: Attempt | null) {
    live.current = next;
    setAttempt(next);
    if (next) onAttempt?.(structuredClone(next), locale);
  }
  function ownsLease(id: string) {
    if (leasePuzzle.current !== id) return false;
    if (leaseKind.current !== "local") return leaseKind.current !== null;
    try {
      const lease = JSON.parse(
        localStorage.getItem(`onebox:v1:lease:${id}`) ?? "null",
      );
      return (
        lease?.owner === leaseId.current &&
        Number.isFinite(lease.until) &&
        lease.until > Date.now()
      );
    } catch {
      // Cannot confirm ownership: continue this page without writing shared state.
      store.useMemoryOnly();
      leaseKind.current = "memory";
      return true;
    }
  }
  function loseLease() {
    const current = snapshot();
    invalidateHint();
    if (current?.state === "playing")
      update({ ...current, state: "paused", interrupted: true });
    setSelection(null);
    setDragView(null);
    drag.current = null;
    setBlocked(true);
    setMessage(t.conflict);
    stopLease();
  }
  function save(next: Attempt) {
    if (store.wasCleared()) {
      resetFromClear();
      return false;
    }
    if (!ownsLease(next.puzzle_id) || !store.save(next)) {
      loseLease();
      return false;
    }
    update(next);
    return true;
  }
  function resetFromClear() {
    invalidateHint();
    stopLease();
    store.discardCache();
    update(null);
    setSelection(null);
    setHistory([]);
    setHintView(null);
    setDragView(null);
    drag.current = null;
    setBlocked(false);
    setMessage("");
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
    if (delta < 0 || Math.abs(wd - delta) > 2000) {
      current.clock_status = "uncertain";
    }
    return base.current + Math.max(0, delta);
  }
  function snapshot() {
    const current = live.current;
    if (!current) return null;
    const activeElapsed = elapsed();
    return { ...current, active_elapsed_ms: activeElapsed };
  }
  function invalidateHint() {
    generation.current++;
    worker.current?.terminate();
    worker.current = null;
    setHintBusy(false);
    setHintView(null);
  }
  function stopLease() {
    const leasedId = leasePuzzle.current;
    leasePuzzle.current = null;
    leaseKind.current = null;
    release.current?.();
    release.current = null;
    if (leaseTimer.current) {
      clearInterval(leaseTimer.current);
      leaseTimer.current = null;
    }
    if (!leasedId) return;
    try {
      const k = `onebox:v1:lease:${leasedId}`,
        v = JSON.parse(localStorage.getItem(k) ?? "null");
      if (v?.owner === leaseId.current) localStorage.removeItem(k);
    } catch {
      /* unavailable storage uses memory */
    }
  }
  async function claim(target: Puzzle): Promise<boolean> {
    if (ownsLease(target.puzzle_id)) return true;
    if (leasePuzzle.current) stopLease();
    if (navigator.locks) {
      return new Promise((resolve) => {
        void navigator.locks
          .request(
            `onebox:${target.puzzle_id}`,
            { ifAvailable: true },
            async (lock) => {
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
          .catch(() => resolve(false));
      });
    }
    const k = `onebox:v1:lease:${target.puzzle_id}`;
    try {
      let prev;
      try {
        prev = JSON.parse(localStorage.getItem(k) ?? "null");
      } catch {
        prev = null;
      }
      if (prev && prev.owner !== leaseId.current && prev.until > Date.now())
        return false;
      localStorage.setItem(
        k,
        JSON.stringify({ owner: leaseId.current, until: Date.now() + 4000 }),
      );
      await new Promise((r) => setTimeout(r, 80));
      if (
        JSON.parse(localStorage.getItem(k) ?? "null")?.owner !== leaseId.current
      )
        return false;
      leasePuzzle.current = target.puzzle_id;
      leaseKind.current = "local";
      leaseTimer.current = setInterval(() => {
        try {
          if (!ownsLease(target.puzzle_id)) {
            loseLease();
          } else if (leaseKind.current === "local")
            localStorage.setItem(
              k,
              JSON.stringify({
                owner: leaseId.current,
                until: Date.now() + 4000,
              }),
            );
        } catch {
          store.useMemoryOnly();
          leaseKind.current = "memory";
        }
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
      .then((h) => {
        if (cancelled) return;
        setHash(h);
        if (live.current?.puzzle_id === p.puzzle_id) {
          setLoading(false);
          return;
        }
        const saved = store.read(p, h);
        if (saved) {
          if (saved.state === "playing" || saved.state === "paused")
            update({
              ...saved,
              state: "paused",
              interrupted: true,
              clock_status:
                saved.clock_status === "uncertain" ? "uncertain" : "resumed",
            });
          else update(saved);
          setTimerVisible(saved.timer_visible);
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
    function leaving() {
      pause();
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
        leaseKind.current === "local" &&
        e.key === `onebox:v1:lease:${p.puzzle_id}` &&
        !ownsLease(p.puzzle_id)
      ) {
        loseLease();
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
      worker.current?.terminate();
      stopLease();
    },
    [],
  );
  async function start(
    target = p,
    mode?: Attempt["mode"],
    initial: Placement[] = [],
  ) {
    if (loading) return;
    invalidateHint();
    const startGeneration = generation.current;
    if (leasePuzzle.current !== target.puzzle_id) stopLease();
    const claimed = await claim(target);
    if (startGeneration !== generation.current) {
      if (!live.current) stopLease();
      return;
    }
    if (!claimed) {
      setBlocked(true);
      setMessage(t.conflict);
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
    const saved = store.read(target, h);
    if (
      !mode &&
      saved &&
      (saved.state === "playing" || saved.state === "paused")
    ) {
      const next = {
        ...saved,
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
      save(next);
    } else {
      const next: Attempt = {
        record_version: 1,
        run_id: crypto.randomUUID(),
        puzzle_id: target.puzzle_id,
        puzzle_hash: h,
        rules_version: target.rules_version,
        mode: mode ?? (playtest && !reviewer ? "practice" : store.mode(target)),
        state: "playing",
        placements: initial,
        active_elapsed_ms: 0,
        interrupted: false,
        clock_status: "continuous",
        hint_count: 0,
        timer_visible: timerVisible,
        started_at_client: new Date().toISOString(),
        finished_at_client: null,
      };
      base.current = 0;
      segment.current = performance.now();
      wall.current = Date.now();
      save(next);
      requestAnimationFrame(() => {
        if (
          live.current?.run_id === next.run_id &&
          live.current.state === "playing"
        ) {
          const painted = snapshot()!;
          base.current = painted.active_elapsed_ms;
          segment.current = performance.now();
          wall.current = Date.now();
          save(painted);
        }
      });
    }
    setSelection(null);
    setHistory([]);
    setMessage("");
  }
  function pause() {
    const current = snapshot();
    if (current?.state === "playing") {
      invalidateHint();
      save({ ...current, state: "paused", interrupted: true });
      setSelection(null);
      setDragView(null);
      drag.current = null;
    }
  }
  function changePlacement(q: Placement) {
    const current = snapshot();
    if (current?.state !== "playing" || blocked) return;
    const err = placementError(p, current.placements, q);
    if (err) {
      setMessage(t[err]);
      return;
    }
    const placements = commit(p, current.placements, q);
    setHistory((h) => [...h, current.placements]);
    invalidateHint();
    const done = complete(p, placements);
    save({
      ...current,
      placements,
      state: done ? "completed" : "playing",
      finished_at_client: done ? new Date().toISOString() : null,
    });
    setSelection(null);
    setMessage(done ? t.done : t.placed);
    if (done) stopLease();
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
      setHistory((h) => [...h, current.placements]);
      invalidateHint();
      save({ ...current, placements });
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
      save({ ...current, placements: history[history.length - 1] });
      setHistory(history.slice(0, -1));
      invalidateHint();
      setMessage(t.undone);
    }
  }
  async function practice() {
    if (a?.state === "playing" || a?.state === "paused") {
      if (!confirm(t.restartConfirm)) return;
      const old = snapshot()!;
      save({
        ...old,
        state: "abandoned",
        finished_at_client: new Date().toISOString(),
      });
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
    w.onmessage = (e) => {
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
        save({
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
    if (!playing || blocked || e.button !== 0) return;
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
    if (!d) return;
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
            : playtest
              ? t.playtestEdition
              : t.edition}
        </div>
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
              disabled={loading || hintBusy}
              onClick={() => void start()}
            >
              {loading ? t.wait : t.start}
              <span>↗</span>
            </button>
            {!reviewer && (
              <button
                className="text-button"
                disabled={loading || hintBusy}
                onClick={tutorial}
              >
                {t.tutorial} →
              </button>
            )}
            <label className="timer-option">
              <input
                type="checkbox"
                checked={timerVisible}
                onChange={(e) => setTimerVisible(e.target.checked)}
              />
              {t.timer}
            </label>
            <p className="local-note">
              {playtest ? t.playtestNote : t.localOnly}
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
                <button className="primary" onClick={() => void start()}>
                  {t.resume} →
                </button>
              </div>
            ) : (
              <>
                <div className="board-wrap">
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
                  {message ||
                    (selection
                      ? `${t.selected}: ${selection.piece_id} · ${t.origin}`
                      : a.mode === "tutorial"
                        ? t.tutorialText
                        : t.ready)}
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
                {!reviewer && sixtyTag(a) && <p className="badge">{t.sixty}</p>}
                <p className="local-note">{t.noOfficial}</p>
              </div>
            )}
            <div className="bottom-actions">
              {playtest &&
                !reviewer &&
                a.state === "completed" &&
                a.mode === "practice" &&
                p.puzzle_id === publicPracticeId && (
                  <ShareResult attempt={a} locale={locale} />
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
                        !save({
                          ...current,
                          state: "abandoned",
                          interrupted: true,
                          finished_at_client: new Date().toISOString(),
                        })
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
                disabled={blocked}
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
        {blocked && (
          <div className="notice" role="alert">
            <p>{t.conflict}</p>
            <button onClick={() => void start()}>{t.resume}</button>
          </div>
        )}
        {store.warning && (
          <p className="notice" role="status">
            {t.noSave}
          </p>
        )}
        {playtest &&
          !reviewer &&
          initialPuzzle.puzzle_id === publicPracticeId && (
            <RecentAttempts
              puzzle={initialPuzzle}
              locale={locale}
              timerVisible={timerVisible}
              onOpen={pause}
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
              const cur = snapshot();
              if (cur) {
                if (["playing", "paused"].includes(cur.state))
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
            onChange={(e) => setReduce(e.target.checked)}
          />
          {t.motion}
        </label>
        <p>{t.sound}</p>
        {!reviewer && (
          <button
            className="danger"
            onClick={() => {
              if (confirm(t.clearConfirm)) {
                invalidateHint();
                stopLease();
                store.clear();
                update(null);
                setSelection(null);
                setHistory([]);
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
