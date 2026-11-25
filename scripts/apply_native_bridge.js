const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const preview = process.argv.includes("--preview");
const javaTarget = path.join(
  root,
  "android",
  "app",
  "src",
  "main",
  "java",
  "pl",
  "seba",
  "kerabot",
  "MainActivity.java"
);
const javaSrc = path.join(root, "native_android", "MainActivity.java");
const keystoreSrc = path.join(root, "signing", "kerabot-fixed.p12");
const keystoreTarget = path.join(root, "android", "app", "kerabot-fixed.p12");
const manifestPath = path.join(root, "android", "app", "src", "main", "AndroidManifest.xml");
const appGradlePath = path.join(root, "android", "app", "build.gradle");
const updatesManifestPath = path.join(root, "www", "updates_manifest.json");

if (preview && (!fs.existsSync(appGradlePath) || fs.readFileSync(appGradlePath, "utf8").includes("kerabot-fixed.p12"))) {
  throw new Error("Tryb --preview wymaga świeżego projektu Android bez konfiguracji klucza wydania.");
}

if (!fs.existsSync(javaSrc)) {
  console.error("BLAD: Brak pliku native_android/MainActivity.java");
  process.exit(1);
}
if (!preview && !fs.existsSync(keystoreSrc)) {
  console.error("BLAD: Brak stalego klucza podpisu signing/kerabot-fixed.p12");
  process.exit(1);
}

if (fs.existsSync(path.join(root, "android", "app"))) {
  fs.mkdirSync(path.dirname(javaTarget), { recursive: true });
  fs.copyFileSync(javaSrc, javaTarget);
  if (!preview) fs.copyFileSync(keystoreSrc, keystoreTarget);
  console.log("Podpięto MainActivity.java.");
}

if (fs.existsSync(manifestPath)) {
  let xml = fs.readFileSync(manifestPath, "utf8");
  const perms = [
    '<uses-permission android:name="android.permission.INTERNET" />',
    '<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
    '<uses-permission android:name="android.permission.RECORD_AUDIO" />',
    '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
    '<uses-permission android:name="android.permission.VIBRATE" />',
    '<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />'
  ];
  for (const p of perms) {
    if (!xml.includes(p)) {
      xml = xml.replace("<application", "    " + p + "\n    <application");
    }
  }
  fs.writeFileSync(manifestPath, xml, "utf8");
  console.log("Zaktualizowano uprawnienia w AndroidManifest.xml.");
}

// Staly podpis APK (kerabot-fixed.p12) + rosnacy versionCode i versionName -> AKTUALIZACJA BEZ USUWANIA STAREJ APKI!
if (fs.existsSync(appGradlePath) && fs.existsSync(updatesManifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(updatesManifestPath, "utf8"));
  const vCode = Number(manifest.apk_latest?.build_code || 5);
  const vName = String(manifest.apk_latest?.version || "0.3.0");

  let gradle = fs.readFileSync(appGradlePath, "utf8");
  gradle = gradle.replace(/versionCode\s+\d+/, "versionCode " + vCode);
  gradle = gradle.replace(/versionName\s+"[^"]*"/, 'versionName "' + vName + '"');

  const webkit = '    implementation "androidx.webkit:webkit:1.9.0"';
  if (!gradle.includes("androidx.webkit:webkit:")) {
    gradle = gradle.replace(/(^dependencies\s*\{)/m, "$1\n" + webkit);
  }
  if (preview) {
    const suffix = 'applicationIdSuffix ".kolejkaqa"';
    if (!gradle.includes(suffix)) {
      gradle = gradle.replace(/(^    buildTypes\s*\{)/m, "$1\n        debug { " + suffix + " }");
      if (!gradle.includes(suffix)) throw new Error("Nie ustawiono osobnego identyfikatora kompilacji testowej.");
    }
  } else if (!gradle.includes("kerabot-fixed.p12")) {
    const signingBlock = `
    signingConfigs {
        debug {
            storeFile file('kerabot-fixed.p12')
            storePassword 'android'
            keyAlias 'kerabotkey'
            keyPassword 'android'
            storeType 'PKCS12'
            v1SigningEnabled true
            v2SigningEnabled true
        }
    }
`;
    gradle = gradle.replace("defaultConfig {", signingBlock + "\n    defaultConfig {");
  }

  fs.writeFileSync(appGradlePath, gradle, "utf8");
  if (preview) {
    console.log("Kompilacja testowa: pl.seba.kerabot.kolejkaqa, standardowy podpis debug.");
  } else {
    console.log("Skonfigurowano versionCode=" + vCode + " (" + vName + ") i ustawienia podpisu wydania.");
  }
}
