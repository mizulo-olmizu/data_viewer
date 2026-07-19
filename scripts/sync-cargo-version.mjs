// Runs as npm's `version` lifecycle script (see package.json).
// Keeps src-tauri/Cargo.toml's package version in sync with package.json,
// since Tauri's app version defaults to the Cargo.toml version when
// tauri.conf.json omits its own `version` field.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkgVersion = JSON.parse(
  readFileSync(path.join(rootDir, "package.json"), "utf8"),
).version;

const cargoTomlPath = path.join(rootDir, "src-tauri", "Cargo.toml");
const cargoToml = readFileSync(cargoTomlPath, "utf8");
const updated = cargoToml.replace(
  /^version = "[^"]*"/m,
  `version = "${pkgVersion}"`,
);

if (updated === cargoToml) {
  throw new Error(`Could not find a version field to update in ${cargoTomlPath}`);
}

writeFileSync(cargoTomlPath, updated);
console.log(`Synced src-tauri/Cargo.toml version to ${pkgVersion}`);
