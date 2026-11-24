const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
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
const manifestPath = path.join(root, "android", "app", "src", "main", "AndroidManifest.xml");

if (!fs.existsSync(javaSrc)) {
  console.error("Brak pliku native_android/MainActivity.java");
  process.exit(1);
}

fs.mkdirSync(path.dirname(javaTarget), { recursive: true });
fs.copyFileSync(javaSrc, javaTarget);
console.log("Wstrzyknieto MainActivity.java z SebaAndroidBridge.");

if (fs.existsSync(manifestPath)) {
  let xml = fs.readFileSync(manifestPath, "utf8");
  const perms = [
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
  console.log("Zaktualizowano uprawnienia w AndroidManifest.xml (Mikrofon, Powiadomienia, Wibracje).");
}
