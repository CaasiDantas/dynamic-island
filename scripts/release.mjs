/**
 * Publica uma versão nova: instalador assinado + latest.json numa Release do GitHub.
 * O app instalado lê o latest.json e oferece a atualização sozinho.
 *
 * Uso:  npm run release            (gera o build e publica)
 *       npm run release -- --skip-build   (só publica o build que já existe)
 *
 * Antes: subir a versão em package.json, src-tauri/tauri.conf.json e
 * src-tauri/Cargo.toml, e escrever as notas em CHANGELOG.md (## x.y.z).
 *
 * Precisa da chave privada em ~/.tauri/dynamic-island.key (ou na variável
 * TAURI_SIGNING_PRIVATE_KEY) e do GitHub CLI (`gh`) autenticado.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const REPO = "CaasiDantas/dynamic-island";
const root = resolve(import.meta.dirname, "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const tag = `v${version}`;
const skipBuild = process.argv.includes("--skip-build");

const fail = (msg) => {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
};

// Versões precisam bater nos três arquivos.
const conf = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
const cargo = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8").match(/^version = "(.+)"/m)?.[1];
if (conf.version !== version || cargo !== version) fail(`versões diferentes: package ${version}, tauri ${conf.version}, cargo ${cargo}`);

// Notas da versão vêm do CHANGELOG.
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
const section = changelog.split(/^## /m).find((s) => s.startsWith(version));
if (!section) fail(`CHANGELOG.md não tem a seção "## ${version}"`);
const notes = section.split("\n").slice(1).join("\n").trim();

if (!skipBuild) {
  const keyPath = join(homedir(), ".tauri", "dynamic-island.key");
  const env = { ...process.env };
  if (!env.TAURI_SIGNING_PRIVATE_KEY) {
    if (!existsSync(keyPath)) fail(`chave de assinatura não encontrada em ${keyPath}`);
    env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(keyPath, "utf8");
  }
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= "";
  console.log(`▶ build ${tag}…`);
  const r = spawnSync("npm", ["run", "tauri", "build"], { cwd: root, env, stdio: "inherit", shell: true });
  if (r.status !== 0) fail("build falhou");
}

const nsis = join(root, "src-tauri/target/release/bundle/nsis");
const setup = join(nsis, `Dynamic Island_${version}_x64-setup.exe`);
if (!existsSync(setup) || !existsSync(`${setup}.sig`)) fail(`instalador ou assinatura não encontrados em ${nsis}`);

// Nome sem espaço: o GitHub troca espaço por ponto nos anexos e quebraria o link.
const out = join(root, "release");
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
const asset = `DynamicIsland_${version}_x64-setup.exe`;
copyFileSync(setup, join(out, asset));
copyFileSync(`${setup}.sig`, join(out, `${asset}.sig`));

writeFileSync(
  join(out, "latest.json"),
  JSON.stringify(
    {
      version,
      notes,
      pub_date: new Date().toISOString(),
      platforms: {
        "windows-x86_64": {
          signature: readFileSync(`${setup}.sig`, "utf8").trim(),
          url: `https://github.com/${REPO}/releases/download/${tag}/${asset}`,
        },
      },
    },
    null,
    2,
  ),
);
writeFileSync(join(out, "notes.md"), notes);

console.log(`▶ publicando ${tag} em ${REPO}…`);
execFileSync(
  "gh",
  ["release", "create", tag, "--repo", REPO, "--title", `Dynamic Island ${version}`, "--notes-file", join(out, "notes.md"), join(out, asset), join(out, `${asset}.sig`), join(out, "latest.json")],
  { stdio: "inherit" },
);
console.log(`\n✔ ${tag} publicada. Quem tem o app instalado recebe o aviso de atualização.`);
