import { mkdir, writeFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { PrivateStore, privateRoot, safeName } from "./private-store.ts";
import { inventory } from "./inventory.ts";
import { prepareDaily } from "./daily.ts";
const [command, ...args] = process.argv.slice(2);
try {
  const o: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    if (
      !["--workspace", "--id", "--edition", "--name"].includes(args[i]) ||
      !args[i + 1] ||
      args[i] in o
    )
      throw Error("Invalid daily option");
    o[args[i]] = args[i + 1];
  }
  const c = await new PrivateStore(safeName(o["--workspace"] ?? "main")).read();
  if (command === "status") {
    if (Object.keys(o).some((k) => k !== "--workspace"))
      throw Error("Status accepts only workspace");
    const result = inventory(c);
    console.log(
      JSON.stringify({
        status:
          result.ready >= 30
            ? "quality_stock_ready"
            : "blocked_by_quality_stock",
        ready: result.ready,
        required: 30,
        source_revision: c.revision,
        publication_implemented: false,
      }),
    );
  } else if (command === "prepare") {
    if (!o["--id"] || !o["--edition"] || !o["--name"])
      throw Error("Prepare requires id, edition and safe output name");
    const plan = prepareDaily(
      c,
      o["--id"],
      o["--edition"],
      new Date().toISOString(),
    );
    const parent = resolve(privateRoot, "daily");
    await mkdir(parent, { recursive: true, mode: 0o700 });
    if ((await realpath(parent)) !== parent)
      throw Error("Private output must not use symlinks");
    const target = resolve(parent, safeName(o["--name"]));
    await mkdir(target, { mode: 0o700 });
    await writeFile(
      resolve(target, "plan.PRIVATE.json"),
      JSON.stringify(plan, null, 2),
      { flag: "wx", mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        status: "private_prepared_only",
        source_revision: c.revision,
      }),
    );
  } else throw Error("Use daily status or prepare");
} catch (error) {
  console.error("Daily preparation blocked:", (error as Error).message);
  process.exitCode = 2;
}
