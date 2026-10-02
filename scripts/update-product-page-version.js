import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const version = (process.argv[2] || "").replace(/^v/, "");

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Uso: node scripts/update-product-page-version.js <vX.Y.Z>");
  process.exit(1);
}

const tag = `v${version}`;
const root = join(__dirname, "..");
const downloadPath = join(root, "docs", "download.html");
const indexPath = join(root, "docs", "index.html");

const urls = {
  "windows-exe": `https://github.com/mpblima/passwordKeeper/releases/download/${tag}/Password.Keeper_${version}_x64-setup.exe`,
  "windows-msi": `https://github.com/mpblima/passwordKeeper/releases/download/${tag}/Password.Keeper_${version}_x64_en-US.msi`,
  "mac-arm": `https://github.com/mpblima/passwordKeeper/releases/download/${tag}/Password.Keeper_${version}_aarch64.dmg`,
  "mac-intel": `https://github.com/mpblima/passwordKeeper/releases/download/${tag}/Password.Keeper_${version}_x64.dmg`,
  "linux-appimage": `https://github.com/mpblima/passwordKeeper/releases/download/${tag}/Password.Keeper_${version}_amd64.AppImage`,
  "linux-deb": `https://github.com/mpblima/passwordKeeper/releases/download/${tag}/Password.Keeper_${version}_amd64.deb`,
  "linux-rpm": `https://github.com/mpblima/passwordKeeper/releases/download/${tag}/Password.Keeper-${version}-1.x86_64.rpm`,
  "android-apk": `https://github.com/mpblima/passwordKeeper/releases/download/${tag}/PasswordKeeper-${version}-android.apk`,
};

let downloadHtml = readFileSync(downloadPath, "utf8");
for (const [key, url] of Object.entries(urls)) {
  const pattern = new RegExp(`("${key}":\\s*")[^"]+(")`);
  downloadHtml = downloadHtml.replace(pattern, `$1${url}$2`);
}
writeFileSync(downloadPath, downloadHtml);

let indexHtml = readFileSync(indexPath, "utf8");
indexHtml = indexHtml.replace(
  /(<strong data-current-version>)v[^<]+(<\/strong>)/,
  `$1${tag}$2`,
);
writeFileSync(indexPath, indexHtml);

console.log(`Product page updated to ${tag}`);
