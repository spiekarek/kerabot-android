const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { existsSync, copyFileSync, readFileSync, mkdirSync, mkdtempSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

test("konfiguracja Android QA nadaje osobny identyfikator i działa bez klucza wydania", () => {
  const root = mkdtempSync(path.join(tmpdir(), "kerabot-kolejka-qa-"));
  const script = path.join(root, "scripts", "apply_native_bridge.js");
  const gradle = path.join(root, "android", "app", "build.gradle");
  for (const folder of ["scripts", "android/app", "native_android", "www"]) {
    mkdirSync(path.join(root, folder), { recursive: true });
  }
  copyFileSync(path.join(__dirname, "..", "scripts", "apply_native_bridge.js"), script);
  writeFileSync(path.join(root, "native_android", "MainActivity.java"), "// Fikcyjny plik testowy\n");
  writeFileSync(path.join(root, "www", "updates_manifest.json"), '{"apk_latest":{"build_code":5,"version":"0.3.0"}}');
  writeFileSync(gradle, 'android {\n    defaultConfig {\n        applicationId "pl.seba.kerabot"\n        versionCode 1\n        versionName "1.0"\n    }\n    buildTypes {\n        release {}\n    }\n}\ndependencies {\n}\n');
  for (let i = 0; i < 2; i++) execFileSync(process.execPath, [script, "--preview"]);
  const generated = readFileSync(gradle, "utf8");
  assert.equal(generated.match(/applicationIdSuffix "\.kolejkaqa"/g).length, 1);
  assert.equal(generated.match(/implementation "androidx\.webkit:webkit:/g).length, 1);
  assert.doesNotMatch(generated, /signingConfigs|kerabot-fixed/);
  assert.equal(existsSync(path.join(root, "android", "app", "kerabot-fixed.p12")), false);
  assert.ok(existsSync(path.join(root, "android", "app", "src", "main", "java", "pl", "seba", "kerabot", "MainActivity.java")));
});
