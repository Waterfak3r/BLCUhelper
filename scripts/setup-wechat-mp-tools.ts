// Private mp-only experiment. Node.js 24; no package installation or website .env access.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checkout = resolve(root, ".data/wechat-mp-tools");
const patch = resolve(root, "deploy/wechat-mp-tools.patch");
const repository = "https://github.com/x554960766/wechat-mp-tools.git";
const commit = "0313de2a17838557e53b630af245654cc03ab2d5";

function git(args: string[], required = true) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (required && result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result;
}

function seed(name: string, value: Record<string, unknown>) {
  const path = resolve(checkout, "data", name);
  if (!existsSync(path)) {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    console.log("Usage: node scripts/setup-wechat-mp-tools.ts\nClones the pinned upstream only if absent, applies the experiment patch, and seeds absent safe settings.\nDoes not install dependencies, start services, create tokens, or read website .env.");
    return;
  }
  if (args.length) throw new Error("Unknown arguments. Use --help.");
  if (!existsSync(patch)) throw new Error(`Missing patch: ${patch}`);
  if (!existsSync(checkout)) {
    mkdirSync(dirname(checkout), { recursive: true });
    git(["clone", "--no-checkout", repository, checkout]);
    git(["-C", checkout, "checkout", "--detach", commit]);
  }
  // Never reset, clean, stash, pull, or switch an existing checkout.
  const head = git(["-C", checkout, "rev-parse", "HEAD"]).stdout.trim();
  if (head !== commit) throw new Error(`Upstream HEAD mismatch: expected ${commit}, found ${head}. No files changed.`);
  const forward = git(["-C", checkout, "apply", "--check", patch], false);
  if (forward.status === 0) {
    git(["-C", checkout, "apply", patch]);
  } else {
    const reverse = git(["-C", checkout, "apply", "--reverse", "--check", patch], false);
    if (reverse.status !== 0) {
      throw new Error("Upstream patch mismatch or partial application. Refusing to update the checkout.\n" + forward.stderr.trim());
    }
  }
  mkdirSync(resolve(checkout, "data"), { recursive: true });
  seed("app_settings.json", {
    auto_save_images: false,
    auto_save_videos: false,
    save_pdf: false,
    save_markdown: false,
    rss_upload_enabled: false,
    rss_local_avatar: false,
    rss_avatar_from_article: false,
    max_retries: 1,
    concurrent_downloads: 1,
    request_delay: 3.0,
  });
  seed("content_filter.json", { enabled: false });
  console.log(`Pinned mp-only experiment ready (${commit}). Existing operator settings preserved. No service started.`);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
