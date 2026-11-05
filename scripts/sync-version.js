import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const version = (process.argv[2] || "").replace(/^v/, "");
if (!version) {
  console.error("Uso: node scripts/sync-version.js <versao>");
  process.exit(1);
}

// package.json
const pkgPath = join(__dirname, "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log("package.json →", version);

const lockPath = join(__dirname, "..", "package-lock.json");
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
lock.version = version;
lock.packages[""].version = version;
writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");

// tauri.conf.json
const confPath = join(__dirname, "..", "src-tauri", "tauri.conf.json");
const conf = JSON.parse(readFileSync(confPath, "utf8"));
conf.version = version;
writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n");
console.log("tauri.conf.json →", version);

// Android's Gradle project reads its package version from this generated file.
// Keep versionCode monotonic across pre-releases and the final release:
// 0.3.0-3 => 300003, 0.3.0 => 300099, 0.3.1-1 => 300101.
const androidPropertiesPath = join(
  __dirname,
  "..",
  "src-tauri",
  "gen",
  "android",
  "app",
  "tauri.properties",
);
let androidProperties = readFileSync(androidPropertiesPath, "utf8");
const versionMatch = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(\d+))?/);
if (!versionMatch) {
  throw new Error(`Versão Android inválida: ${version}`);
}
const [, major, minor, patch, prerelease] = versionMatch;
const androidVersionCode =
  Number(major) * 100_000_000 +
  Number(minor) * 100_000 +
  Number(patch) * 100 +
  (prerelease === undefined ? 99 : Number(prerelease));
if (!Number.isSafeInteger(androidVersionCode) || androidVersionCode > 2_100_000_000) {
  throw new Error(`versionCode Android fora do limite: ${androidVersionCode}`);
}
androidProperties = androidProperties
  .replace(/^tauri\.android\.versionName=.*$/m, `tauri.android.versionName=${version}`)
  .replace(/^tauri\.android\.versionCode=.*$/m, `tauri.android.versionCode=${androidVersionCode}`);
writeFileSync(androidPropertiesPath, androidProperties);
console.log(`Android → ${version} (versionCode ${androidVersionCode})`);

// Cargo.toml — atualiza apenas a primeira linha `version = "..."`
const cargoPath = join(__dirname, "..", "src-tauri", "Cargo.toml");
let cargo = readFileSync(cargoPath, "utf8");
cargo = cargo.replace(/^version = "[^"]+"/m, `version = "${version}"`);
writeFileSync(cargoPath, cargo);
console.log("Cargo.toml →", version);

const cargoLockPath = join(__dirname, "..", "src-tauri", "Cargo.lock");
let cargoLock = readFileSync(cargoLockPath, "utf8");
cargoLock = cargoLock.replace(
  /(name = "password-keeper"\nversion = ")[^"]+"/,
  `$1${version}"`,
);
writeFileSync(cargoLockPath, cargoLock);
