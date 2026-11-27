const assert = require("node:assert/strict");
const { readFile, mkdir } = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { test } = require("node:test");
const { chromium } = require("playwright-core");

const KEY = "kerabot_offline_outbox_v1";
const PHOTO = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==", "base64");
const PHOTO_URL = "data:image/png;base64," + PHOTO.toString("base64");
const legacy = { id: 7, text: "Szkic z poprzedniej wersji", photo: null, createdAt: "25.11.2026 21:10", sent: true };
const localAssets = path.join(__dirname, "..", "www");
const types = { ".js": "text/javascript", ".html": "text/html; charset=utf-8", ".css": "text/css", ".json": "application/json" };

async function serve(root) {
  const server = http.createServer(async (request, response) => {
    const name = new URL(request.url, "http://localhost").pathname;
    const file = name === "/" ? "index.html" : name.slice(1);
    if (!/^[a-zA-Z0-9_.-]+$/.test(file)) return response.writeHead(404).end();
    try {
      const data = await readFile(path.join(root, file));
      response.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
      response.end(data);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { url: "http://127.0.0.1:" + server.address().port, close: () => server.close() };
}

async function view(browser, url, { items, width = 390 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 600, hasTouch: width < 600, acceptDownloads: true });
  await context.route("**/*", route => route.request().url().startsWith(url) ? route.continue() : route.abort());
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  if (items) await page.addInitScript(({ key, value }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(value));
  }, { key: KEY, value: items });
  await page.goto(url + "/#offline");
  await page.locator("#outbox-status").waitFor();
  return { page, pageErrors, close: () => context.close() };
}

function queue(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || "[]"), KEY);
}

async function status(page, excerpt) {
  await page.locator("#outbox-status").filter({ hasText: excerpt }).waitFor();
}

async function importCopy(page, data) {
  await page.locator("#outbox-import").setInputFiles({
    name: "kopia-kerabot.json", mimeType: "application/json",
    buffer: Buffer.from(typeof data === "string" ? data : JSON.stringify(data)),
  });
}

test("kopia przywraca zdjęcie bez tekstu i wiadomości, także ze starym znacznikiem", async (t) => {
  const app = await serve(localAssets);
  t.after(app.close);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  t.after(() => browser.close());
  const source = await view(browser, app.url, { items: [legacy] });
  const page = source.page;
  await page.locator("#outbox-text").fill("Plan z telefonu · Żółw 🐢");
  await page.locator("#btn-outbox-save").click();
  await page.locator("#outbox-photo").setInputFiles({ name: "proba.png", mimeType: "image/png", buffer: PHOTO });
  await status(page, "Zdjęcie załączone");
  await page.locator("#btn-outbox-save").click();
  assert.equal((await queue(page)).length, 3);

  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", {
    configurable: true, value: { writeText: async () => { throw new DOMException("odmowa", "NotAllowedError"); } },
  }));
  const stateBefore = await queue(page);
  await page.locator("#btn-outbox-sync").click();
  await status(page, "Schowek odmówił");
  assert.deepEqual(await queue(page), stateBefore);

  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", {
    configurable: true, value: { writeText: async (text) => { window.testClipboard = text; } },
  }));
  await page.locator("#btn-outbox-sync").click();
  await status(page, "Tekst jest w schowku");
  assert.match(await page.evaluate(() => window.testClipboard), /Plan z telefonu/);
  const items = await queue(page);
  assert.equal(items.filter(item => item.copiedAt).length, 2);
  assert.equal(items[0].photo, PHOTO_URL);
  assert.equal(items[0].copiedAt, undefined);
  assert.equal(items.find(item => item.id === legacy.id).sent, true);

  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#btn-outbox-export").click()]);
  const bytes = await readFile(await download.path());
  const backup = JSON.parse(bytes);
  assert.equal(backup.format, "kerabot-outbox");
  assert.equal(backup.version, 1);
  assert.equal(backup.items.length, 3);
  assert.equal(backup.items[0].photo, PHOTO_URL);
  assert.equal(backup.items[0].text, "");
  assert.equal(backup.items[0].category, "zrzut");
  assert.equal(backup.items[0].source, "Dodane ręcznie");
  assert.equal(backup.items[2].text, legacy.text);

  const target = await view(browser, app.url);
  await importCopy(target.page, backup);
  await status(target.page, "Przywrócono: 3");
  await target.page.reload();
  assert.deepEqual(await queue(target.page), backup.items);
  assert.equal(await target.page.locator(".outbox-img").getAttribute("src"), PHOTO_URL);
  assert.equal(await target.page.locator(".outbox-img").evaluate(img => img.decode().then(() => img.naturalWidth)), 1);
  await importCopy(target.page, backup);
  await status(target.page, "Pominięte duplikaty: 3");
  assert.equal((await queue(target.page)).length, 3);

  await importCopy(target.page, '{"format":');
  await status(target.page, "Ten plik nie jest poprawnym JSON");
  await importCopy(target.page, { ...backup, items: [...backup.items, { ...legacy, photo: "https://bad.invalid/test.jpg" }] });
  await status(target.page, "uszkodzony wpis");
  assert.deepEqual(await queue(target.page), backup.items);
  assert.deepEqual([...source.pageErrors, ...target.pageErrors], []);
});

test("kolejka zachowuje wpisy przy braku miejsca i przy 51. zapisie", async (t) => {
  const app = await serve(localAssets);
  t.after(app.close);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  t.after(() => browser.close());
  const oldItems = Array.from({ length: 50 }, (_, i) => ({ ...legacy, id: i, sent: false }));
  const { page } = await view(browser, app.url, { items: oldItems });
  await page.locator("#outbox-text").fill("51. wiadomość");
  await page.locator("#btn-outbox-save").click();
  await status(page, "Wpis zapisany");
  assert.equal((await queue(page)).length, 51);
  assert.deepEqual((await queue(page)).slice(1), oldItems);
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (itemKey, value) {
      if (itemKey === key) throw new DOMException("limit", "QuotaExceededError");
      return original.call(this, itemKey, value);
    };
  }, KEY);
  const before = await queue(page);
  await page.locator("#outbox-text").fill("Nie zapisano");
  await page.locator("#btn-outbox-save").click();
  await status(page, "Telefon nie zapisał kolejki");
  assert.equal(await page.locator("#outbox-text").inputValue(), "Nie zapisano");
  assert.deepEqual(await queue(page), before);
});

test("aplikacja czeka na wynik Androida i pokazuje anulowanie oraz gotowy zapis", async (t) => {
  const app = await serve(localAssets);
  t.after(app.close);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  t.after(() => browser.close());
  const { page } = await view(browser, app.url, { items: [legacy] });
  await page.evaluate(() => {
    window.SebaOfflineBackup = {
      postMessage(data) { window.testBackup = data === "open" ? data : JSON.parse(data); },
    };
  });
  await page.locator("#btn-outbox-export").click();
  assert.equal(await page.locator("#btn-outbox-export").isDisabled(), true);
  assert.equal((await page.evaluate(() => window.testBackup)).items[0].id, legacy.id);
  await page.evaluate(() => window.SebaOfflineBackup.onmessage({ data: "cancelled" }));
  await status(page, "Anulowano zapis kopii");
  assert.equal(await page.locator("#btn-outbox-export").isEnabled(), true);
  await page.locator("#btn-outbox-export").click();
  await page.evaluate(() => window.SebaOfflineBackup.onmessage({ data: "ok" }));
  await status(page, "Kopia zapisana");
  assert.deepEqual(await queue(page), [legacy]);
  await page.locator("#btn-outbox-import").click();
  assert.equal(await page.locator("#btn-outbox-import").isDisabled(), true);
  await page.evaluate(() => window.SebaOfflineBackup.onmessage({ data: "import:" + JSON.stringify([{
    id: 8, text: "Wpis z Androida", createdAt: "25.11.2026 21:12", photo: null,
  }]) }));
  await status(page, "Przywrócono: 1");
  assert.deepEqual((await queue(page)).map(item => item.id), [7, 8]);
});

if (process.env.BEFORE_ROOT && process.env.PROOF_DIR) {
  test("zrzuty przed i po na tych samych danych i rozmiarach", async (t) => {
    const before = await serve(process.env.BEFORE_ROOT);
    const after = await serve(localAssets);
    t.after(before.close);
    t.after(after.close);
    const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
    t.after(() => browser.close());
    await mkdir(process.env.PROOF_DIR, { recursive: true });
    const items = [
      legacy,
      { id: 8, text: "Przypomnienie z próbnej kolejki", photo: null, createdAt: "25.11.2026 21:12", sent: false },
      { id: 9, text: "", photo: PHOTO_URL, createdAt: "25.11.2026 21:14", sent: true },
    ];
    const oldApp = await view(browser, before.url, { items });
    assert.deepEqual(await queue(oldApp.page), items);
    await oldApp.page.locator("#outbox-photo").setInputFiles({ name: "stare-zdjecie.png", mimeType: "application/octet-stream", buffer: PHOTO });
    await status(oldApp.page, "Zdjęcie załączone");
    await oldApp.page.locator("#btn-outbox-save").click();
    const oldPhoto = PHOTO_URL.replace("image/png", "application/octet-stream");
    const legacyBackup = await oldApp.page.evaluate(key => localStorage.getItem(key), KEY);
    assert.equal(JSON.parse(legacyBackup)[0].photo, oldPhoto);
    await oldApp.close();
    const restored = await view(browser, after.url);
    await importCopy(restored.page, legacyBackup);
    await status(restored.page, "Przywrócono: 4");
    assert.equal((await queue(restored.page))[0].photo, oldPhoto);
    assert.equal((await queue(restored.page))[3].photo, PHOTO_URL);
    assert.equal(await restored.page.getByText("Brak podglądu obrazu.", { exact: false }).count(), 1);
    const [download] = await Promise.all([
      restored.page.waitForEvent("download"),
      restored.page.locator("#btn-outbox-export").click(),
    ]);
    assert.equal(JSON.parse(await readFile(await download.path())).items[0].photo, oldPhoto);
    await restored.close();
    for (const width of [390, 1280]) {
      for (const [tag, app] of [["przed", before], ["po", after]]) {
        const handle = await view(browser, app.url, { items, width });
        await handle.page.locator("#outbox-count").filter({ hasText: "3" }).waitFor();
        const fits = await handle.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
        if (tag === "po") assert.equal(fits, true, "kolejka ma mieścić się w szerokości ekranu");
        await handle.page.screenshot({ path: path.join(process.env.PROOF_DIR, tag + "-" + width + ".png"), fullPage: true, animations: "disabled" });
        await handle.close();
      }
    }
  });
}
