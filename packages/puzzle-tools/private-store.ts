import {
  mkdir,
  readFile,
  realpath,
  lstat,
  open,
  rename,
  rm,
  writeFile,
  readdir,
} from "node:fs/promises";
import { resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { type Catalog, emptyCatalog, validateCatalog } from "./curation.ts";
import { digest } from "./generator.ts";

const project = fileURLToPath(new URL("../../", import.meta.url));
export const privateRoot = resolve(project, "content/private");
export function safeName(name: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(name))
    throw Error("Expected safe private workspace or batch name");
  return name;
}
async function directory(path: string) {
  const parent = resolve(path, "..");
  if ((await realpath(parent)) !== parent)
    throw Error("Private parent directory must not use symlinks");
  await mkdir(path, { recursive: true, mode: 0o700 });
  if ((await realpath(path)) !== path)
    throw Error("Private directory must not use symlinks");
}
export async function readJson(file: string, limit: number) {
  const info = await lstat(file);
  if (!info.isFile() || info.size > limit)
    throw Error("Expected bounded regular JSON file");
  return JSON.parse(await readFile(file, "utf8"));
}
export async function readBatch(name: string) {
  const file = resolve(
    privateRoot,
    "candidates",
    safeName(name),
    "batch.PRIVATE.json",
  );
  if (
    !(await realpath(file)).startsWith(privateRoot + sep) ||
    (await realpath(file)) !== file
  )
    throw Error("Candidate path must not use symlinks");
  return readJson(file, 200000);
}
export class PrivateStore {
  readonly dir: string;
  constructor(workspace = "main") {
    this.dir = resolve(privateRoot, "curation", safeName(workspace));
  }
  async read(): Promise<Catalog> {
    const file = resolve(this.dir, "state.PRIVATE.json");
    try {
      if ((await realpath(this.dir)) !== this.dir)
        throw Error("Catalog directory must not use symlinks");
      if ((await realpath(file)) !== file)
        throw Error("Catalog path must not use symlinks");
      const raw = await readJson(file, 5000000);
      if (
        !raw ||
        raw.format_version !== 1 ||
        Object.keys(raw).length !== 3 ||
        raw.integrity !== digest(raw.catalog)
      )
        throw Error("Catalog integrity mismatch");
      return validateCatalog(raw.catalog);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        try {
          if ((await readdir(resolve(this.dir, "revisions"))).length)
            throw Error(
              "Catalog state missing; restore a verified revision before writing",
            );
        } catch (archiveError) {
          if ((archiveError as NodeJS.ErrnoException).code !== "ENOENT")
            throw archiveError;
        }
        return emptyCatalog();
      }
      throw error;
    }
  }
  async mutate<T>(operation: (catalog: Catalog) => Promise<T> | T): Promise<T> {
    await directory(privateRoot);
    await directory(resolve(privateRoot, "curation"));
    await directory(this.dir);
    const lock = resolve(this.dir, "write.lock");
    try {
      await mkdir(lock, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw Error(
          "Curation is locked; inspect the writer before recovering a stale lock",
        );
      throw error;
    }
    const temp = resolve(this.dir, `next-${randomUUID()}.PRIVATE.json`);
    try {
      await writeFile(
        resolve(lock, "owner.json"),
        JSON.stringify({
          pid: process.pid,
          started_at: new Date().toISOString(),
        }),
        { flag: "wx", mode: 0o600 },
      );
      const c = await this.read(),
        result = await operation(c);
      c.revision++;
      validateCatalog(c);
      const integrity = digest(c),
        data =
          JSON.stringify(
            { format_version: 1, integrity, catalog: c },
            null,
            2,
          ) + "\n";
      if (Buffer.byteLength(data, "utf8") > 5000000)
        throw Error("Catalog size limit reached");
      const archive = resolve(this.dir, "revisions");
      await directory(archive);
      await writeFile(
        resolve(
          archive,
          `rev-${String(c.revision).padStart(6, "0")}-${integrity.slice(0, 12)}.PRIVATE.json`,
        ),
        data,
        { flag: "wx", mode: 0o600 },
      );
      const handle = await open(temp, "wx", 0o600);
      try {
        await handle.writeFile(data);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temp, resolve(this.dir, "state.PRIVATE.json"));
      return result;
    } finally {
      await rm(temp, { force: true });
      await rm(lock, { recursive: true, force: true });
    }
  }
}
