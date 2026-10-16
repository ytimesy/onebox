import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
export async function artifactDigest(root) {
  const hash = createHash("sha256");
  async function walk(path) {
    for (const entry of (
      await readdir(`${root}/${path}`, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const next = path ? `${path}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(next);
      else if (entry.isFile()) {
        const data = await readFile(`${root}/${next}`);
        hash.update(JSON.stringify([next, data.length]));
        hash.update(data);
      } else throw Error("Artifact must contain regular files only");
    }
  }
  await walk("");
  return hash.digest("hex");
}
