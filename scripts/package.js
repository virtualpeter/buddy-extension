#!/usr/bin/env node
/**
 * Package the buddy VS Code/Cursor extension as a VSIX.
 *
 *   PUBLISHER=virtualpete npm run package
 *   VERSION=0.2.0 npm run package          # override git tag
 *   CLI_REPO=other/buddy npm run package   # default buddy.cli.repo in the VSIX
 *   CLI_REPO=https://git.example.com/org/buddy CLI_PROVIDER=gitlab
 *
 * Version comes from VERSION, then `git describe --tags` (GitHub tag, `v` stripped),
 * then package.json. Default publisher: virtualpete (extension id virtualpete.buddy).
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const pkgPath = path.join(root, "package.json");

const publisher = (process.env.PUBLISHER || "virtualpete").trim();
if (!publisher) {
  console.error("PUBLISHER must be a non-empty string");
  process.exit(1);
}

function normalizeCliRepo(raw) {
  const s = String(raw || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  if (!s) {
    return "";
  }
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const project = u.pathname
        .replace(/^\//, "")
        .replace(/\/+$/, "")
        .replace(/\.git$/i, "")
        .replace(/\/(releases|tags|tree|blob)(\/.*)?$/i, "");
      if (!u.hostname || !project) {
        return "";
      }
      return `${u.origin}/${project}`.replace(/([^:]\/)\/+/g, "$1");
    } catch {
      return "";
    }
  }
  return /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.test(s) ? s : "";
}

function normalizeProvider(raw) {
  const p = String(raw || "").trim().toLowerCase();
  return p === "github" || p === "gitlab" || p === "auto" ? p : "";
}

function gitDescribe() {
  const r = spawnSync("git", ["describe", "--tags", "--always", "--dirty"], {
    cwd: root,
    encoding: "utf8",
  });
  if (r.status !== 0) {
    return "";
  }
  return (r.stdout || "").trim();
}

/** VS Code / vsce need semver without a leading `v`. */
function versionFromGitTag(describe, fallback) {
  const raw = (process.env.VERSION || "").trim() || describe;
  if (!raw) {
    return fallback;
  }
  const stripped = raw.replace(/^v/i, "");
  if (/^\d+\.\d+\.\d+/.test(stripped)) {
    return stripped;
  }
  return `0.0.0-${stripped.replace(/[^A-Za-z0-9.-]/g, "-")}`;
}

const originalText = fs.readFileSync(pkgPath, "utf8");
const pkg = JSON.parse(originalText);
const describe = gitDescribe();
const repoProp = pkg.contributes?.configuration?.properties?.["buddy.cli.repo"];
const providerProp = pkg.contributes?.configuration?.properties?.["buddy.cli.provider"];
const cliRepo = normalizeCliRepo(process.env.CLI_REPO) || normalizeCliRepo(repoProp?.default) || "virtualpeter/buddy";
if (process.env.CLI_REPO && !normalizeCliRepo(process.env.CLI_REPO)) {
  console.error("CLI_REPO must be owner/name or a GitHub/GitLab URL (e.g. virtualpeter/buddy or https://git.example.com/org/buddy)");
  process.exit(1);
}
if (process.env.CLI_PROVIDER && !normalizeProvider(process.env.CLI_PROVIDER)) {
  console.error("CLI_PROVIDER must be auto, github, or gitlab");
  process.exit(1);
}
const cliProvider = normalizeProvider(process.env.CLI_PROVIDER) || normalizeProvider(providerProp?.default) || "auto";
pkg.publisher = publisher;
pkg.version = versionFromGitTag(describe, pkg.version);
if (repoProp) {
  repoProp.default = cliRepo;
}
if (providerProp) {
  providerProp.default = cliProvider;
}
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

console.log(
  `Packaging extension as ${publisher}.${pkg.name} ${pkg.version}${describe ? ` (git ${describe})` : ""} (cli.repo ${cliRepo}, cli.provider ${cliProvider})`
);

let exitCode = 0;
try {
  // vscode:prepublish runs the minified esbuild bundle.
  const vsce = spawnSync(
    "npx",
    [
      "vsce",
      "package",
      "--allow-missing-repository",
      "--baseContentUrl",
      "https://github.com/virtualpeter/buddy-extension/blob/main/",
      "--baseImagesUrl",
      "https://github.com/virtualpeter/buddy-extension/raw/main/",
    ],
    { cwd: root, stdio: "inherit", shell: true }
  );
  if (vsce.status !== 0) {
    exitCode = vsce.status || 1;
  } else {
    const vsixName = `${pkg.name}-${pkg.version}.vsix`;
    const vsixPath = path.join(root, vsixName);
    console.log(`Created ${vsixPath} (extension id ${publisher}.${pkg.name})`);
  }
} finally {
  fs.writeFileSync(pkgPath, originalText);
}

process.exit(exitCode);
