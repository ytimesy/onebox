import { execFileSync } from "node:child_process";
import {
  readFile,
  mkdir,
  readdir,
  cp,
  rename,
  symlink,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { artifactDigest } from "./artifact.mjs";
const expected = process.argv[2];
const actual = await artifactDigest("dist-playtest");
if (!expected || expected !== actual)
  throw Error(
    "Pass the exact digest of the browser-checked dist-playtest build",
  );
execFileSync(process.execPath, ["scripts/check-dist.mjs", "dist-playtest"], {
  stdio: "inherit",
});
const dir = resolve("releases", `m1-${actual.slice(0, 12)}`);
await mkdir("releases", { recursive: true });
await mkdir("var/assets", { recursive: true });
try {
  await cp("dist-playtest", dir, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
} catch (error) {
  if (
    error.code !== "ERR_FS_CP_EEXIST" ||
    (await artifactDigest(dir)) !== actual
  )
    throw error;
}
// Keep prior hashed assets available to already-open tabs after switching HTML.
for (const name of await readdir(`${dir}/assets`)) {
  const data = await readFile(`${dir}/assets/${name}`),
    target = `var/assets/${name}`;
  try {
    await writeFile(target, data, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST" || !(await readFile(target)).equals(data))
      throw error;
  }
}
try {
  const previous = await readlink("var/current");
  if (previous !== dir) {
    await rm("var/previous", { force: true });
    await symlink(previous, "var/previous");
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await rm("var/next", { force: true });
await symlink(dir, "var/next");
await rename("var/next", "var/current");
console.log(`Promoted checked playtest build: ${actual}`);
