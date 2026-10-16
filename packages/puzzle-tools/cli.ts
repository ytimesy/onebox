import { readFile, mkdir, writeFile, realpath, lstat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { generate, verify, integer } from "./generator.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const [command, ...args] = process.argv.slice(2);
function options(allowed: string[]) {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const k = args[i];
    if (!allowed.includes(k) || !args[i + 1] || k in result)
      throw Error("Unknown, missing or repeated option");
    result[k] = args[i + 1];
  }
  return result;
}
function number(v: string | undefined, fallback: number) {
  if (v === undefined) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(v))
    throw Error("Expected unsigned decimal integer");
  return Number(v);
}
try {
  if (command === "generate") {
    const o = options([
      "--seed",
      "--batch",
      "--count",
      "--candidate-limit",
      "--time-limit",
      "--node-limit",
      "--solver-time",
    ]);
    if (!o["--seed"] || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(o["--batch"] ?? ""))
      throw Error("generate requires --seed UINT32 --batch SAFE-NAME");
    const params = {
      seed: integer(number(o["--seed"], 0), "seed", 0, 4294967295),
      count: integer(number(o["--count"], 5), "count", 1, 10),
      candidateLimit: integer(
        number(o["--candidate-limit"], 20000),
        "candidate limit",
        1,
        20000,
      ),
      totalTimeMs: integer(
        number(o["--time-limit"], 15000),
        "total time",
        1,
        15000,
      ),
      nodeLimit: integer(
        number(o["--node-limit"], 100000),
        "node limit",
        1,
        1000000,
      ),
      solverTimeMs: integer(
        number(o["--solver-time"], 1500),
        "solver time",
        1,
        5000,
      ),
    };
    const privateRoot = resolve(root, "content/private");
    await mkdir(privateRoot, { recursive: true, mode: 0o700 });
    if ((await realpath(privateRoot)) !== privateRoot)
      throw Error("Private root must not be a symlink");
    const parent = resolve(privateRoot, "candidates");
    await mkdir(parent, { recursive: true, mode: 0o700 });
    if ((await realpath(parent)) !== parent)
      throw Error("Candidate root must not be a symlink");
    const dir = resolve(parent, o["--batch"]);
    if (!dir.startsWith(parent + sep)) throw Error("Invalid batch path");
    await mkdir(dir, { mode: 0o700 }); // EEXIST is deliberate: no overwrites.
    const report = generate(params);
    await writeFile(
      resolve(dir, "batch.PRIVATE.json"),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        status: report.status,
        complete: report.complete,
        accepted: report.candidates.length,
        draws: report.draws,
        rejected: report.rejected,
        elapsed_ms: report.elapsed_ms,
        file: `content/private/candidates/${o["--batch"]}/batch.PRIVATE.json`,
      }),
    );
    process.exitCode = report.complete ? 0 : 1;
  } else if (command === "verify") {
    const file = args.shift();
    if (!file) throw Error("verify requires a puzzle JSON path");
    const o = options(["--node-limit", "--time-limit"]);
    const info = await lstat(file);
    if (!info.isFile() || info.size > 10000)
      throw Error("Expected puzzle file <=10000 bytes");
    const value = JSON.parse(await readFile(file, "utf8"));
    const result = verify(
      value,
      integer(number(o["--node-limit"], 100000), "node limit", 1, 1000000),
      integer(number(o["--time-limit"], 1500), "time limit", 1, 5000),
    );
    const { solution: _private, ...summary } = result;
    console.log(JSON.stringify(summary));
    process.exitCode =
      result.status === "unique" ? 0 : result.status === "invalid" ? 2 : 1;
  } else {
    throw Error(
      "Use generate --seed UINT32 --batch SAFE-NAME [--count 1..10], or verify PUZZLE.json [--node-limit N]",
    );
  }
} catch (error) {
  // Do not echo supplied JSON, seeds, solutions or arbitrary file contents.
  console.error(
    error instanceof SyntaxError
      ? "Invalid JSON input"
      : error instanceof Error && !("code" in error)
        ? error.message
        : "CLI input or filesystem operation failed",
  );
  process.exitCode = 2;
}
