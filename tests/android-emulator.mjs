import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const pkg = "pl.seba.kerabot.kolejkaqa";
const key = "kerabot_offline_outbox_v1";
const photo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==";
const records = [
  { id: "t1", text: "Próba Androida", photo: null, createdAt: "25.11.2026 21:10", sent: false },
  { id: "p1", text: "", photo, createdAt: "25.11.2026 21:11", sent: true },
];
const adb = async (...args) => (await exec("adb", args, { timeout: 20000 })).stdout.trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function retry(op, accepts, label, seconds = 45) {
  const deadline = Date.now() + seconds * 1000;
  let error;
  do {
    try {
      const value = await op();
      if (accepts(value)) return value;
    } catch (e) {
      error = e;
    }
    await delay(650);
  } while (Date.now() < deadline);
  throw new Error("Emulator: " + label + (error ? " (" + error.message + ")" : ""));
}

function openSocket(url) {
  const socket = new WebSocket(url);
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", () => reject(new Error("Nie można połączyć się z lokalnym WebView")), { once: true });
  });
}

async function webview() {
  const pid = await retry(() => adb("shell", "pidof", "-s", pkg), x => /^\d+$/.test(x), "brak procesu aplikacji");
  const port = await adb("forward", "tcp:0", "localabstract:webview_devtools_remote_" + pid);
  try {
    const tabs = await retry(async () => {
      const r = await fetch("http://127.0.0.1:" + port + "/json/list", { signal: AbortSignal.timeout(2500) });
      return await r.json();
    }, result => result.some(tab => tab.url.startsWith("https://localhost") && tab.webSocketDebuggerUrl), "brak lokalnego ekranu WebView");
    const tab = tabs.find(entry => entry.url.startsWith("https://localhost"));
    const socket = await openSocket(tab.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, "ws://127.0.0.1:" + port));
    let id = 0;
    return {
      async run(expression) {
        const currentId = ++id;
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            socket.removeEventListener("message", onMessage);
            reject(new Error("WebView nie odpowiedział na polecenie"));
          }, 8000);
          function onMessage(event) {
            const response = JSON.parse(event.data);
            if (response.id !== currentId) return;
            clearTimeout(timeout);
            socket.removeEventListener("message", onMessage);
            if (response.error || response.result.exceptionDetails) reject(new Error("Błąd skryptu próbnego w WebView"));
            else resolve(response.result.result.value);
          }
          socket.addEventListener("message", onMessage);
          socket.send(JSON.stringify({
            id: currentId, method: "Runtime.evaluate",
            params: { expression, returnByValue: true, awaitPromise: true, userGesture: true },
          }));
        });
      },
      async close() {
        socket.close();
        await adb("forward", "--remove", "tcp:" + port);
      },
    };
  } catch (error) {
    await adb("forward", "--remove", "tcp:" + port);
    throw error;
  }
}

async function uiNodes() {
  await adb("shell", "uiautomator", "dump", "/sdcard/kerabot-qa-ui.xml");
  const xml = await adb("shell", "cat", "/sdcard/kerabot-qa-ui.xml");
  const nodes = [];
  const parents = [];
  for (const match of xml.matchAll(/<node (.*?)>|<\/node>/g)) {
    if (!match[1]) {
      parents.pop();
      continue;
    }
    const node = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
    node.parent = parents.at(-1);
    nodes.push(node);
    if (!match[1].endsWith("/")) parents.push(node);
  }
  return nodes;
}

function saveButton(nodes) {
  return nodes.find(node => node.enabled === "true" && node.clickable === "true" &&
    (/(:id\/(action_menu_save|button_save|save_button))$/.test(node["resource-id"]) ||
      /^(save|zapisz)$/i.test(node.text || node["content-desc"])));
}

async function tap(node) {
  const coords = node.bounds.match(/\d+/g).map(Number);
  assert.equal(coords.length, 4);
  await adb("shell", "input", "tap", String((coords[0] + coords[2]) >> 1), String((coords[1] + coords[3]) >> 1));
}

function fileRow(nodes, name) {
  let node = nodes.find(item => item.text === name && item.enabled === "true");
  while (node && node.clickable !== "true") node = node.parent;
  return node?.enabled === "true" ? node : null;
}

const component = pkg + "/pl.seba.kerabot.MainActivity";
await adb("shell", "svc", "wifi", "disable");
await adb("shell", "svc", "data", "disable");
await adb("shell", "am", "start", "-n", component);
let view = await webview();
const status = () => view.run('document.querySelector("#outbox-status")?.textContent || ""');
const requireStatus = (pattern, label) => retry(status, value => pattern.test(value), label);

try {
  await retry(() => view.run('typeof window.SebaOfflineBackup?.postMessage'), value => value === "function", "brak natywnego kanału zapisu");
  await view.run("localStorage.setItem(" + JSON.stringify(key) + ", " + JSON.stringify(JSON.stringify(records)) + "); location.reload();");
  await retry(() => view.run('typeof window.SebaSwitchLocalTab'), value => value === "function", "brak kolejki po przeładowaniu");
  await view.run('window.SebaSwitchLocalTab("offline"); Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async()=>{throw new Error("odmowa")}}}); document.querySelector("#btn-outbox-sync").click();');
  await requireStatus(/Schowek odmówił/, "brak stanu po odmowie schowka");
  assert.deepEqual(await view.run("JSON.parse(localStorage.getItem(" + JSON.stringify(key) + "))"), records);
  console.log("Android: odmowa schowka zachowała próbne wpisy.");

  await view.run('document.querySelector("#btn-outbox-export").click()');
  await retry(uiNodes, nodes => Boolean(saveButton(nodes)), "systemowe okno zapisu się nie otworzyło");
  await adb("shell", "input", "keyevent", "4");
  await requireStatus(/Anulowano zapis/, "brak potwierdzenia anulowania");
  console.log("Android: systemowy wybór pliku i anulowanie działają.");

  await view.run('document.querySelector("#btn-outbox-export").click()');
  const choices = await retry(uiNodes, nodes => Boolean(saveButton(nodes)), "brak przycisku Zapisz w oknie Androida");
  await tap(saveButton(choices));
  await requireStatus(/Kopia zapisana/, "brak potwierdzenia zapisu kopii");
  const destination = await retry(
    () => adb("shell", "find /sdcard/Download /sdcard/Documents -name 'kerabot-kolejka*.json' -type f 2>/dev/null || true"),
    value => /\/sdcard\/(?:Download|Documents)\/kerabot-kolejka.*\.json/.test(value),
    "brak pliku kopii w pamięci emulatora",
  );
  const file = destination.split("\n")[0];
  const backup = JSON.parse(await adb("shell", "cat " + "'" + file.replaceAll("'", "'\\''") + "'"));
  assert.equal(backup.format, "kerabot-outbox");
  assert.deepEqual(backup.items.map(({ copiedAt, ...item }) => item), records);
  console.log("Android: plik w pamięci urządzenia zawiera tekst i zdjęcie.");

  await view.run("localStorage.removeItem(" + JSON.stringify(key) + "); location.reload();");
  await retry(() => view.run('typeof window.SebaSwitchLocalTab'), value => value === "function", "brak ekranu przed odtworzeniem");
  await view.run('window.SebaSwitchLocalTab("offline"); document.querySelector("#btn-outbox-import").click();');
  const pick = nodes => fileRow(nodes, file.split("/").at(-1));
  const files = await retry(uiNodes, nodes => Boolean(pick(nodes)), "systemowy wybór nie pokazuje zapisanej kopii");
  await tap(pick(files));
  try {
    await requireStatus(/Przywrócono: 2/, "plik nie został przywrócony przez aplikację");
  } catch (error) {
    console.log("Stan po wyborze pliku:", await status());
    console.log("Pola okna systemowego:", (await uiNodes()).filter(node => node.text || node["content-desc"]).map(node => [node.text, node["content-desc"], node["resource-id"]]).slice(0, 16));
    throw error;
  }
  const imported = await view.run("JSON.parse(localStorage.getItem(" + JSON.stringify(key) + "))");
  assert.deepEqual(imported.map(({ copiedAt, ...item }) => item), records);
  await retry(() => view.run('document.querySelector(".outbox-img")?.naturalWidth'), n => n === 1, "nie wyświetlono przywróconego zdjęcia");
  console.log("Android: aplikacja odtworzyła tekst i wyświetliła zdjęcie z pliku systemowego.");

  const syntheticShare = "Udostepnienie-probne-do-Inboxa";
  await adb("shell", "am", "start", "-n", component, "-a", "android.intent.action.SEND",
    "-t", "text/plain", "--es", "android.intent.extra.TEXT", syntheticShare);
  const withShare = await retry(
    () => view.run("JSON.parse(localStorage.getItem(" + JSON.stringify(key) + "))"),
    state => state?.some(item => item.text === syntheticShare),
    "brak testowego wpisu udostępnionego przez Androida",
  );
  assert.equal(withShare.filter(item => item.text === syntheticShare && item.category === "inne").length, 1);
  assert.equal((await view.run('window.SebaAndroidBridge.peekPendingShareJson()')), "");
  console.log("Android: udostępnienie systemowe zapisano w Inboxie i potwierdzono po zapisie.");
} finally {
  await view.close();
}
