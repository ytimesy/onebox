import { solve } from "../../../packages/game-core/solver";
self.postMessage({ ready: true });
self.onmessage = (e: MessageEvent) => {
  try {
    const result = solve(e.data);
    self.postMessage(
      result.unique ? { solution: result.solutions[0] } : { error: true },
    );
  } catch {
    self.postMessage({ error: true });
  }
};
