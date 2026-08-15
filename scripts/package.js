#!/usr/bin/env node
/**
 * Package the buddy VS Code/Cursor extension as a VSIX.
 *
 *   PUBLISHER=virtualpete npm run package
 *   VERSION=0.2.0 npm run package          # override git tag
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
pkg.publisher = publisher;
pkg.version = versionFromGitTag(describe, pkg.version);
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

console.log(`Packaging extension as ${publisher}.${pkg.name} ${pkg.version}${describe ? ` (git ${describe})` : ""}`);

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
