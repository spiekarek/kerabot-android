(function () {
  "use strict";

  const CURRENT_APP_VERSION = "0.4.0";
  const CURRENT_BUILD_CODE = 6;
  const REMOTE_MANIFEST_URL =
    "https://raw.githubusercontent.com/spiekarek/kerabot-android/main/www/updates_manifest.json";
  const REMOTE_REGISTRY_URL =
    "https://raw.githubusercontent.com/spiekarek/kerabot-android/main/www/REJESTR_AKTUALIZACJI.json";
  const OUTBOX_KEY = "kerabot_offline_outbox_v1";

  const CATEGORY_LABELS = {
    zrzut: "🐛 Zrzut / Błąd",
    gra: "🎮 Pomysł / Gra",
    grafika: "🎨 Grafika / Styl",
    firma: "📄 Firma / US",
    inne: "📌 Inne"
  };

  const MODULE_TEMPLATE = {
    schema_standard: "AI_HUB_MODULE_TEMPLATE_V2",
    informacja_o_programie: {
      id: "nowy-modul-id",
      nazwa: "Nazwa modułu / gry / narzędzia",
      kategoria: "gry | narzedzia | system",
      aktualna_wersja: "1.0.0",
      build_code: 1,
      autor: "Sebastian & Flota AI HUB",
      tryb_offline: true,
      url: "https://kordian.s-piekarek.workers.dev/next"
    },
    rejestr_aktualizacji: [
      {
        wersja: "1.0.0",
        build_code: 1,
        data: "2026-11-26",
        status_qa: "PASS",
        zmiany_pl: [
          "Pierwsze wydanie modułu zgodne ze standardem AI HUB.",
          "Obsługa trybu Offline-Online oraz panelu Informacja o programie."
        ]
      }
    ]
  };

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(id, msg) {
    const el = $(id);
    if (el) el.textContent = msg;
  }

  function esc(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // 1. Zakladki lokalnego panelu
  function switchTab(tabId) {
    const target = ["updates", "offline", "phone", "templates"].includes(tabId) ? tabId : "updates";
    document.querySelectorAll(".tab-panel").forEach((p) => {
      p.classList.toggle("active", p.id === "tab-" + target);
    });
    document.querySelectorAll(".nav-btn, .subtab-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === target);
    });
  }
  window.SebaSwitchLocalTab = switchTab;

  document.querySelectorAll(".nav-btn, .subtab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // 2. Otwieranie pelnych paneli KeraBota w natywnym oknie top-level WebView
  function openKeraBotNative(url) {
    if (typeof window.SebaAndroidBridge !== "undefined" && window.SebaAndroidBridge.openKeraBotUrl) {
      window.SebaAndroidBridge.openKeraBotUrl(url);
      return;
    }
    window.open(url, "_blank", "noopener");
  }

  document.querySelectorAll("[data-native-kb]").forEach((btn) => {
    btn.addEventListener("click", () => openKeraBotNative(btn.dataset.nativeKb));
  });

  $("btn-force-cf-login")?.addEventListener("click", () => {
    if (typeof window.SebaAndroidBridge !== "undefined" && window.SebaAndroidBridge.forceReloadKeraBot) {
      window.SebaAndroidBridge.forceReloadKeraBot("https://kordian.s-piekarek.workers.dev/next#pokoj");
      return;
    }
    openKeraBotNative("https://kordian.s-piekarek.workers.dev/next#pokoj");
  });

  function hookApkDownloadButton(el) {
    if (!el) return;
    el.addEventListener("click", (ev) => {
      const href = el.getAttribute("href");
      if (href && href !== "#" && typeof window.SebaAndroidBridge !== "undefined" && window.SebaAndroidBridge.openExternalUrl) {
        ev.preventDefault();
        window.SebaAndroidBridge.openExternalUrl(href);
      }
    });
  }
  hookApkDownloadButton($("btn-download-latest-apk"));
  hookApkDownloadButton($("update-banner-btn"));

  // 3. Status Online / Offline
  function checkIsOnline() {
    if (typeof window.SebaAndroidBridge !== "undefined" && window.SebaAndroidBridge.isOnline) {
      try { return !!window.SebaAndroidBridge.isOnline(); } catch (e) {}
    }
    return navigator.onLine !== false;
  }

  function updateNetworkUi() {
    const online = checkIsOnline();
    const badge = $("net-status-badge");
    if (badge) {
      badge.textContent = online ? "🟢 Online" : "🟠 Offline";
      badge.className = "badge " + (online ? "ok" : "warn");
    }
  }

  window.addEventListener("online", () => {
    updateNetworkUi();
    setStatus("outbox-status", "🟢 Internet wrócił. Możesz otworzyć Pokój.");
  });
  window.addEventListener("offline", () => {
    updateNetworkUi();
    setStatus("outbox-status", "🟠 Tryb Offline — nowe zrzuty i wiadomości zapiszą się lokalnie na telefonie.");
  });

  // 4. Inbox Zrzutow & Kolejka Offline + Android Share Target
  const OUTBOX_BACKUP_FORMAT = "kerabot-outbox";
  const MAX_BACKUP_BYTES = 16 * 1024 * 1024;
  const PHOTO_DATA_URL = /^data:(?:image\/[a-z0-9.+-]+|application\/octet-stream);base64,[a-z0-9+/]+={0,2}$/i;
  let copyingOutbox = false;
  let exportingOutbox = false;
  let importingOutbox = false;
  let pendingPhotos = [];
  let pendingPhotoRead = 0;
  let selectedCategory = "zrzut";
  let activeFilter = "all";

  document.querySelectorAll("#outbox-cat-picker [data-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedCategory = btn.dataset.cat || "zrzut";
      document.querySelectorAll("#outbox-cat-picker [data-cat]").forEach((b) =>
        b.classList.toggle("active", b === btn)
      );
    });
  });

  document.querySelectorAll("#outbox-filter-bar [data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.filter || "all";
      document.querySelectorAll("#outbox-filter-bar [data-filter]").forEach((b) =>
        b.classList.toggle("active", b === btn)
      );
      renderOutbox();
    });
  });

  function loadOutbox() {
    const items = JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]");
    if (!Array.isArray(items)) throw new Error("Kolejka ma nieprawidłowy format.");
    return items;
  }

  function saveOutbox(items) {
    try {
      localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
    } catch {
      throw new Error("Telefon nie zapisał kolejki. Sprawdź wolne miejsce. Poprzednie wpisy zostały zachowane.");
    }
  }

  function backupItem(item) {
    if (!item || !["string", "number"].includes(typeof item.id)
        || typeof item.text !== "string" || typeof item.createdAt !== "string"
        || (item.photo != null && (typeof item.photo !== "string" || !PHOTO_DATA_URL.test(item.photo)))
        || (!item.text.trim() && !item.photo)) {
      throw new Error("W kopii jest uszkodzony wpis lub zdjęcie w nieobsługiwanym formacie.");
    }
    return {
      id: item.id,
      text: item.text,
      createdAt: item.createdAt,
      photo: item.photo || null,
      sent: item.sent === true,
      category: typeof item.category === "string" ? item.category : "inne",
      source: typeof item.source === "string" ? item.source : null,
      copiedAt: typeof item.copiedAt === "string" ? item.copiedAt : null,
    };
  }

  function outboxItemKey({ id, text, createdAt, photo }) {
    return JSON.stringify([id, text, createdAt, photo || null]);
  }

  function openLightbox(src, caption) {
    const lb = $("img-lightbox");
    if (!lb) return;
    $("lightbox-img").src = src;
    $("lightbox-caption").textContent = caption || "";
    lb.classList.add("open");
  }
  $("btn-close-lightbox")?.addEventListener("click", () => $("img-lightbox")?.classList.remove("open"));
  $("img-lightbox")?.addEventListener("click", (ev) => {
    if (ev.target === $("img-lightbox")) $("img-lightbox").classList.remove("open");
  });

  function renderOutbox() {
    let allItems;
    try {
      allItems = loadOutbox();
    } catch (error) {
      setStatus("outbox-status", error.message);
      return;
    }
    const filtered = activeFilter === "all" ? allItems : allItems.filter((it) => (it.category || "inne") === activeFilter);
    const cnt = $("outbox-count");
    if (cnt) cnt.textContent = String(allItems.length);
    const list = $("outbox-list");
    if (!list) return;
    if (!filtered.length) {
      list.innerHTML = '<div style="font-size:13px;color:var(--muted);">Brak pozycji w tym widoku Inboxa.</div>';
      return;
    }
    list.innerHTML = filtered
      .map((it) => {
        const badge = it.copiedAt ? "Tekst skopiowany do schowka" : "Na telefonie";
        const catLabel = CATEGORY_LABELS[it.category] || CATEGORY_LABELS.inne;
        const id = esc(String(it.id));
        const srcLabel = it.source ? " · " + esc(it.source) : "";
        const imgHtml = it.photo && /^data:image\//i.test(it.photo) && PHOTO_DATA_URL.test(it.photo)
          ? '<img class="outbox-img" data-zoom-id="' + id + '" src="' + it.photo + '" alt="Zrzut w Inboxie" />'
          : "";
        const fallback = it.photo && !imgHtml
          ? '<small>Załącznik zostanie zachowany w kopii. Brak podglądu obrazu.</small>'
          : "";
        const legacy = it.sent && !it.copiedAt
          ? '<small>Starsza wersja oznaczyła wpis jako skopiowany. Sprawdź go w Pokoju przed ponownym wysłaniem.</small>'
          : "";
        return (
          '<div class="outbox-item ' + (it.sent ? "sent" : "") + '">' +
          '  <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px;flex-wrap:wrap;">' +
          '    <strong>' + badge + ' · ' + esc(catLabel) + "</strong>" +
          '    <span style="font-size:11px;color:var(--muted);">' + esc(it.createdAt) + srcLabel + "</span>" +
          "  </div>" +
          "  <div>" + esc(it.text || "(Zrzut bez opisu)") + "</div>" +
          imgHtml + fallback + legacy +
          '  <div class="outbox-actions">' +
          (imgHtml ? '<button type="button" class="mini-btn" data-zoom-id="' + id + '">🔍 Powiększ</button>' : "") +
          '    <button type="button" class="mini-btn" data-del-id="' + id + '">🗑️ Usuń</button>' +
          "  </div>" +
          "</div>"
        );
      })
      .join("");

    list.querySelectorAll("[data-zoom-id]").forEach((el) => {
      el.addEventListener("click", () => {
        const found = loadOutbox().find((x) => String(x.id) === String(el.dataset.zoomId));
        if (found && found.photo) openLightbox(found.photo, found.text || found.createdAt);
      });
    });

    list.querySelectorAll("[data-del-id]").forEach((el) => {
      el.addEventListener("click", () => {
        try {
          saveOutbox(loadOutbox().filter(item => String(item.id) !== String(el.dataset.delId)));
        } catch (error) {
          setStatus("outbox-status", error.message);
          return;
        }
        renderOutbox();
        consumePendingAndroidShare();
      });
    });
  }

  // Odbior zrzutow/tekstow udostepnionych z Androida ("Udostepnij -> KeraBot AI HUB")
  let pendingShareRequestId = 0;
  let consumingPendingShare = false;

  function requestPendingShare(bridge, operation) {
    const prefix = String(++pendingShareRequestId) + "\n";
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        bridge.onmessage = null;
        reject(new Error("Brak odpowiedzi z Androida"));
      }, 5000);
      bridge.onmessage = ({ data }) => {
        if (typeof data !== "string" || !data.startsWith(prefix)) return;
        clearTimeout(timeout);
        bridge.onmessage = null;
        resolve(data.slice(prefix.length));
      };
      try {
        bridge.postMessage(prefix + operation);
      } catch (error) {
        clearTimeout(timeout);
        bridge.onmessage = null;
        reject(error);
      }
    });
  }

  async function consumePendingAndroidShare() {
    const bridge = window.SebaPendingShare;
    if (!bridge || consumingPendingShare) return 0;
    consumingPendingShare = true;
    let saved = 0;
    let status = "";
    try {
      let raw = await requestPendingShare(bridge, "peek");
      while (raw) {
        const items = loadOutbox();
        const ids = new Set(items.map((item) => String(item.id)));
        const batch = JSON.parse(raw);
        if (typeof batch.id !== "string" || !Array.isArray(batch.items) || !batch.items.length) {
          throw new Error("Nieprawidłowa paczka Androida");
        }
        const createdAt = new Date().toLocaleString("pl-PL");
        const added = batch.items.map((item, index) => ({
          id: "android-" + batch.id + "-" + index,
          text: String(item.text || "Zrzut z Androida"),
          photo: item.photo || null,
          category: item.category || "zrzut",
          source: item.source || "Udostępnij (Android)",
          createdAt,
          sent: false
        })).filter((item) => !ids.has(item.id));
        if (added.length && items.length + added.length > 60) {
          status = "Inbox jest pełny lub nie ma miejsca na zapis. Paczka czeka w KeraBocie. Zwolnij miejsce w Inboxie.";
          break;
        }
        if (added.length) saveOutbox([...added, ...items]);
        saved += added.length;
        if (await requestPendingShare(bridge, "ack:" + batch.id) !== "true") {
          status = "Zapisano paczkę, ale potwierdzenie odbioru czeka na ponowne otwarcie Inboxa.";
          break;
        }
        raw = await requestPendingShare(bridge, "peek");
      }
      if (!status && saved) {
        status = "📥 Zapisano w Inboxie " + saved + " pozycji z Androida.";
      }
    } catch (e) {
      status = "Nie udało się odczytać Inboxa lub zapisać paczki. Paczka czeka w KeraBocie.";
    } finally {
      consumingPendingShare = false;
    }
    if (status) {
      switchTab("offline");
      if (saved) renderOutbox();
      setStatus("outbox-status", status);
    }
    return saved;
  }
  window.SebaConsumePendingShare = consumePendingAndroidShare;

  $("outbox-photo")?.addEventListener("change", async (ev) => {
    const read = ++pendingPhotoRead;
    const files = Array.from(ev.target.files || []).slice(0, 10);
    const save = $("btn-outbox-save");
    pendingPhotos = [];
    save.disabled = files.length > 0;
    if (!files.length) return;
    const results = await Promise.allSettled(files.map((file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => PHOTO_DATA_URL.test(reader.result) ? resolve(reader.result) : reject();
      reader.onerror = reject;
      reader.onabort = reject;
      reader.readAsDataURL(file);
    })));
    if (read !== pendingPhotoRead) return;
    pendingPhotos = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
    save.disabled = false;
    const loaded = pendingPhotos.length;
    const status = loaded === 0 ? "Nie udało się odczytać zdjęć."
      : loaded === 1 ? "Zdjęcie załączone. Zapisz je do Inboxa."
        : "Załączono " + loaded + " zdjęć. Zapisz je do Inboxa.";
    setStatus("outbox-status", status + (loaded && loaded < files.length ? " Część plików nie została odczytana." : ""));
  });

  $("btn-outbox-save")?.addEventListener("click", () => {
    const text = ($("outbox-text")?.value || "").trim();
    if (!text && !pendingPhotos.length) {
      setStatus("outbox-status", "Wpisz/podyktuj opis lub wybierz zrzut ekranu.");
      return;
    }
    let items;
    try {
      items = loadOutbox();
    } catch (error) {
      setStatus("outbox-status", error.message);
      return;
    }
    const now = new Date().toLocaleString("pl-PL");
    if (pendingPhotos.length) {
      pendingPhotos.forEach((photo, idx) => {
        items.unshift({
          id: Date.now() + idx,
          text,
          photo,
          category: selectedCategory,
          source: "Dodane ręcznie",
          createdAt: now,
          sent: false
        });
      });
    } else {
      items.unshift({
        id: Date.now(),
        text,
        photo: null,
        category: selectedCategory,
        source: "Notatka",
        createdAt: now,
        sent: false
      });
    }
    try {
      if (items.length > 60) throw new Error("Inbox jest pełny.");
      saveOutbox(items);
    } catch (error) {
      setStatus("outbox-status", error.message + " Zachowano wpis i zdjęcia w formularzu.");
      return;
    }
    if ($("outbox-text")) $("outbox-text").value = "";
    $("outbox-photo").value = "";
    pendingPhotos = [];
    renderOutbox();
    setStatus("outbox-status", "Wpis zapisany na telefonie.");
  });

  $("btn-outbox-sync")?.addEventListener("click", async (event) => {
    if (copyingOutbox) return;
    const button = event.currentTarget;
    copyingOutbox = true;
    button.disabled = true;
    try {
      const pending = loadOutbox().filter(item => item.text?.trim() && !item.copiedAt);
      if (!pending.length) {
        setStatus("outbox-status", "Brak nowych tekstów do skopiowania. Zdjęcia możesz zachować w kopii kolejki.");
        return;
      }
      try {
        await navigator.clipboard.writeText(pending.map(item => "[" + item.createdAt + "] " + item.text).join("\n\n"));
      } catch {
        setStatus("outbox-status", "Schowek odmówił zapisu. Wpisy nadal są w kolejce.");
        return;
      }
      const copied = new Set(pending.map(outboxItemKey));
      const copiedAt = new Date().toISOString();
      try {
        saveOutbox(loadOutbox().map(item => copied.has(outboxItemKey(item)) ? { ...item, copiedAt } : item));
        renderOutbox();
        setStatus("outbox-status", "Tekst jest w schowku. Otwórz Pokój i wklej go. Zdjęcia dołącz osobno.");
      } catch {
        setStatus("outbox-status", "Tekst jest w schowku, ale nie udało się zapisać oznaczeń kolejki.");
      }
    } catch (error) {
      setStatus("outbox-status", error.message);
    } finally {
      copyingOutbox = false;
      button.disabled = false;
    }
  });

  $("btn-outbox-export")?.addEventListener("click", (event) => {
    if (exportingOutbox || importingOutbox) return;
    const button = event.currentTarget;
    try {
      const items = loadOutbox().map(backupItem);
      if (!items.length) {
        setStatus("outbox-status", "Kolejka jest pusta.");
        return;
      }
      const time = new Date().toISOString();
      const fileName = "kerabot-kolejka-" + time.slice(0, 10) + ".json";
      const backup = JSON.stringify({ format: OUTBOX_BACKUP_FORMAT, version: 1, exportedAt: time, items });
      const blob = new Blob([backup], { type: "application/json" });
      if (blob.size > MAX_BACKUP_BYTES) throw new Error("Kopia jest za duża do zapisania.");
      const native = window.SebaOfflineBackup;
      if (native?.postMessage) {
        native.onmessage = (result) => {
          exportingOutbox = false;
          button.disabled = false;
          const message = {
            ok: "Kopia zapisana. Zawiera teksty i zdjęcia z kolejki.",
            cancelled: "Anulowano zapis kopii.",
            error: "Android nie zapisał kopii. Spróbuj w innym folderze.",
          }[result.data];
          setStatus("outbox-status", message || "Android nie potwierdził zapisu kopii.");
        };
        exportingOutbox = true;
        button.disabled = true;
        native.postMessage(backup);
        return;
      }
      if (window.SebaAndroidBridge) throw new Error("Systemowy zapis kopii jest niedostępny w tym WebView.");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      setStatus("outbox-status", "Rozpoczęto pobieranie kopii. Sprawdź plik w Pobranych.");
    } catch (error) {
      exportingOutbox = false;
      button.disabled = false;
      setStatus("outbox-status", error.message);
    }
  });

  $("btn-outbox-import")?.addEventListener("click", (event) => {
    if (exportingOutbox || importingOutbox) return;
    const native = window.SebaOfflineBackup;
    if (!native?.postMessage) {
      $("outbox-import").click();
      return;
    }
    const button = event.currentTarget;
    importingOutbox = true;
    button.disabled = true;
    native.onmessage = ({ data }) => {
      importingOutbox = false;
      button.disabled = false;
      if (typeof data === "string" && data.startsWith("import:")) {
        restoreOutbox(data.slice(7));
      } else {
        setStatus("outbox-status", data === "cancelled"
          ? "Anulowano odtwarzanie kolejki." : "Android nie odczytał pliku kopii.");
      }
    };
    try {
      native.postMessage("open");
    } catch {
      importingOutbox = false;
      button.disabled = false;
      setStatus("outbox-status", "Nie udało się otworzyć wyboru pliku.");
    }
  });

  $("outbox-import")?.addEventListener("change", async (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error("Plik kopii jest za duży.");
      restoreOutbox(await file.text());
    } catch (error) {
      setStatus("outbox-status", error.name === "NotReadableError" ? "Nie udało się odczytać pliku kopii." : error.message);
    } finally {
      input.value = "";
    }
  });

  function restoreOutbox(text) {
    try {
      let backup;
      try { backup = JSON.parse(text); } catch {
        throw new Error("Ten plik nie jest poprawnym JSON.");
      }
      const records = Array.isArray(backup) ? backup : backup?.items;
      if (!Array.isArray(records) || (!Array.isArray(backup) && (backup.format !== OUTBOX_BACKUP_FORMAT || backup.version !== 1))) {
        throw new Error("Nie rozpoznano wersji kopii kolejki KeraBota.");
      }
      const previous = loadOutbox();
      const keys = new Set(previous.map(outboxItemKey));
      const added = [];
      for (const item of records.map(backupItem)) {
        const key = outboxItemKey(item);
        if (keys.has(key)) continue;
        keys.add(key);
        added.push(item);
      }
      if (added.length) saveOutbox([...previous, ...added]);
      renderOutbox();
      setStatus("outbox-status", "Przywrócono: " + added.length + ". Pominięte duplikaty: " + (records.length - added.length) + ".");
    } catch (error) {
      setStatus("outbox-status", error.message);
    }
  }

  $("btn-export-inbox-json")?.addEventListener("click", async () => {
    const items = loadOutbox().map(({ id, text, category, source, createdAt, sent, photo }) => ({
      id, text, category, source, createdAt, sent, ma_zdjecie: !!photo
    }));
    try {
      await navigator.clipboard.writeText(JSON.stringify({ schema: "INBOX_OD_SZEFA_ANDROID_V1", count: items.length, items }, null, 2));
      setStatus("outbox-status", "📤 Skopiowano indeks JSON Inboxa (" + items.length + " poz.) do schowka!");
    } catch (e) {}
  });

  // Ciagle dyktowanie PL do Inboxa
  let outboxRec = null;
  let outboxListening = false;
  $("btn-outbox-dictate")?.addEventListener("click", () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setStatus("outbox-status", "ℹ️ Użyj mikrofonu na klawiaturze Androida (Gboard/Samsung), aby podyktować.");
      return;
    }
    if (outboxListening && outboxRec) {
      outboxListening = false;
      try { outboxRec.stop(); } catch (e) {}
      outboxRec = null;
      $("btn-outbox-dictate").textContent = "🎤 Dyktuj po polsku (Ciągle)";
      setStatus("outbox-status", "⏹ Zatrzymano dyktowanie.");
      return;
    }
    outboxRec = new SR();
    outboxRec.lang = "pl-PL";
    outboxRec.continuous = true;
    outboxRec.interimResults = true;
    let base = ($("outbox-text")?.value || "").trim();
    if (base) base += " ";
    outboxListening = true;
    $("btn-outbox-dictate").textContent = "🔴 Słucham… (Kliknij Stop)";
    setStatus("outbox-status", "🗣️ Słucham ciągle po polsku…");
    outboxRec.onresult = (ev) => {
      let txt = "";
      for (let i = 0; i < ev.results.length; i++) txt += ev.results[i][0].transcript + " ";
      const el = $("outbox-text");
      if (el) {
        el.value = (base + txt).trim();
        el.scrollTop = el.scrollHeight;
      }
    };
    outboxRec.onerror = (ev) => {
      if (ev.error === "no-speech" && outboxListening) return;
      outboxListening = false;
      $("btn-outbox-dictate").textContent = "🎤 Dyktuj po polsku (Ciągle)";
    };
    outboxRec.onend = () => {
      if (outboxListening && outboxRec) {
        base = ($("outbox-text")?.value || "").trim();
        if (base) base += " ";
        try { outboxRec.start(); return; } catch (e) {}
      }
      outboxListening = false;
      $("btn-outbox-dictate").textContent = "🎤 Dyktuj po polsku (Ciągle)";
    };
    outboxRec.start();
  });

  // 5. Rejestr Aktualizacji + Informacja o programie + Manifest
  function renderRegistry(reg) {
    const p = reg?.program || {};
    const infoBody = $("program-info-body");
    if (infoBody) {
      infoBody.innerHTML =
        "<strong>Nazwa:</strong> " + esc(p.nazwa || "KeraBot AI HUB") + "<br>" +
        "<strong>Wersja:</strong> v" + esc(CURRENT_APP_VERSION) + " (build " + CURRENT_BUILD_CODE + " · stały klucz PKCS12)<br>" +
        "<strong>Data wydania:</strong> " + esc(p.data_wydania || "2026-11-26") + "<br>" +
        "<strong>Architektura:</strong> " + esc(p.architektura || "Dual-WebView + Android Share Target") + "<br>" +
        "<strong>Autor:</strong> " + esc(p.autor || "Sebastian & Flota AI HUB");
    }
    const histEl = $("release-history-list");
    if (histEl && Array.isArray(reg?.historia_wydan)) {
      histEl.innerHTML = reg.historia_wydan
        .map((h) => {
          const items = (h.zmiany_pl || []).map((z) => "<li>" + esc(z) + "</li>").join("");
          return (
            '<div class="release-card">' +
            '  <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px;">' +
            '    <strong>v' + esc(h.wersja) + " (build " + esc(h.build_code) + ")</strong>" +
            '    <span class="badge ok">' + esc(h.status_qa || "PASS") + " · " + esc(h.data) + "</span>" +
            "  </div>" +
            '  <ul style="margin:0;padding-left:18px;font-size:13px;color:#cbd5e1;line-height:1.5;">' + items + "</ul>" +
            "</div>"
          );
        })
        .join("");
    }
  }

  function renderManifest(manifest, sourceLabel) {
    const apk = manifest.apk_latest || {};
    const dlBtn = $("btn-download-latest-apk");
    if (dlBtn && apk.download_url) dlBtn.href = apk.download_url;

    const hasNewerApk = Number(apk.build_code || 0) > CURRENT_BUILD_CODE;
    const banner = $("update-banner");
    if (banner) {
      if (hasNewerApk) {
        banner.classList.add("visible");
        $("update-banner-title").textContent = "🚀 Dostępna nowa wersja APK: v" + apk.version;
        $("update-banner-desc").textContent = "Masz: v" + CURRENT_APP_VERSION + " → Nowa: v" + apk.version + " (podmienia bez usuwania!)";
        $("update-banner-btn").href = apk.download_url || "#";
      } else {
        banner.classList.remove("visible");
      }
    }

    const modWrap = $("modules-list");
    if (modWrap && Array.isArray(manifest.modules)) {
      modWrap.innerHTML = manifest.modules
        .map((m) => {
          const catIcon = m.category === "gry" ? "🎮" : m.category === "system" ? "🤖" : "🛠️";
          return (
            '<div class="module-item">' +
            '  <div class="module-head">' +
            '    <span class="module-name">' + catIcon + " " + esc(m.name) + "</span>" +
            '    <span class="badge ok">v' + esc(m.version) + " · " + esc(m.status) + "</span>" +
            "  </div>" +
            '  <div class="module-notes">' + esc(m.notes) + "</div>" +
            '  <button type="button" class="btn primary" data-open-in-app="' + esc(m.url) + '">Otwórz w aplikacji</button>' +
            "</div>"
          );
        })
        .join("");

      modWrap.querySelectorAll("[data-open-in-app]").forEach((b) => {
        b.addEventListener("click", () => openKeraBotNative(b.dataset.openInApp));
      });
    }

    setStatus(
      "updates-status",
      "Źródło: " + sourceLabel + " | Zainstalowane: v" + CURRENT_APP_VERSION +
      " | Najnowsze: v" + (apk.version || CURRENT_APP_VERSION) +
      (hasNewerApk ? " (DOSTĘPNA AKTUALIZACJA!)" : " (Masz najnowszą wersję ✅)")
    );
  }

  async function loadUpdatesAndRegistry(tryRemote) {
    setStatus("updates-status", "Sprawdzanie manifestu i rejestru aktualizacji…");
    if (tryRemote && checkIsOnline()) {
      try {
        const [mRes, rRes] = await Promise.all([
          fetch(REMOTE_MANIFEST_URL + "?t=" + Date.now(), { cache: "no-store" }),
          fetch(REMOTE_REGISTRY_URL + "?t=" + Date.now(), { cache: "no-store" })
        ]);
        if (mRes.ok) renderManifest(await mRes.json(), "Chmura GitHub (Live)");
        if (rRes.ok) renderRegistry(await rRes.json());
        if (mRes.ok) return;
      } catch (e) {}
    }
    try {
      const mLocal = await (await fetch("updates_manifest.json")).json();
      renderManifest(mLocal, "Pakiet lokalny (Offline)");
    } catch (e) {}
    try {
      const rLocal = await (await fetch("REJESTR_AKTUALIZACJI.json")).json();
      renderRegistry(rLocal);
    } catch (e) {}
  }

  // 6. Telefon, Dzwieki, Mikrofon i Urzadzenie
  function updateDeviceInfo() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const hasBridge = typeof window.SebaAndroidBridge !== "undefined";
    if (hasBridge) document.body.classList.add("has-native-bar");
    let nativeModel = "Przeglądarka / WebView";
    if (hasBridge && window.SebaAndroidBridge.getDeviceInfo) {
      try { nativeModel = window.SebaAndroidBridge.getDeviceInfo(); } catch (e) {}
    }
    const label = $("device-mode-label");
    if (label) label.textContent = "Inbox + Cloudflare (" + w + "×" + h + ")";
    const infoEl = $("device-info-text");
    if (infoEl) {
      infoEl.innerHTML =
        "<strong>Urządzenie:</strong> " + esc(nativeModel) + "<br>" +
        "<strong>Ekran:</strong> " + w + " × " + h + " px<br>" +
        "<strong>Share Target (Udostępnij → KeraBot) + Stały podpis:</strong> " + (hasBridge ? "✅ AKTYWNY" : "ℹ️ Podgląd WWW");
    }
  }
  window.addEventListener("resize", updateDeviceInfo);

  function openNativeSettings(kind) {
    if (typeof window.SebaAndroidBridge !== "undefined") {
      try {
        if (kind === "channel" && window.SebaAndroidBridge.openNotificationChannelSettings) {
          window.SebaAndroidBridge.openNotificationChannelSettings(); return;
        }
        if (kind === "sound" && window.SebaAndroidBridge.openSoundSettings) {
          window.SebaAndroidBridge.openSoundSettings(); return;
        }
        if (kind === "accessibility" && window.SebaAndroidBridge.openAccessibilitySettings) {
          window.SebaAndroidBridge.openAccessibilitySettings(); return;
        }
      } catch (e) {}
    }
    setStatus("sounds-status", "ℹ️ Otwiera natywne Ustawienia Androida po instalacji pliku .apk.");
  }

  function triggerLoudAlarm() {
    if (typeof window.SebaAndroidBridge !== "undefined" && window.SebaAndroidBridge.sendUrgentNotification) {
      try {
        window.SebaAndroidBridge.sendUrgentNotification("🚨 AI HUB PILNE — Test Alarmu", "Głośny kanał powiadomień AI HUB działa!");
        setStatus("sounds-status", "🔔 Wysłano głośne powiadomienie AI HUB PILNE!");
        return;
      } catch (e) {}
    }
    setStatus("sounds-status", "🔊 Alarm testowy gotowy (na telefonie wyśle głośny baner Androida).");
  }

  let micStream = null;
  let micRaf = null;
  $("btn-mic-test")?.addEventListener("click", async () => {
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
      if (micRaf) cancelAnimationFrame(micRaf);
      $("mic-meter-bar").style.width = "0%";
      $("btn-mic-test").textContent = "🎙️ Uruchom test mikrofonu";
      setStatus("voice-status", "Test mikrofonu zatrzymany.");
      return;
    }
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(micStream);
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      src.connect(an);
      const data = new Uint8Array(an.frequencyBinCount);
      $("btn-mic-test").textContent = "⏹️ Zatrzymaj test mikrofonu";
      setStatus("voice-status", "✅ Mikrofon aktywny!");
      function tick() {
        if (!micStream) return;
        an.getByteFrequencyData(data);
        let s = 0;
        for (let i = 0; i < data.length; i++) s += data[i];
        $("mic-meter-bar").style.width = Math.min(100, Math.round((s / data.length / 90) * 100)) + "%";
        micRaf = requestAnimationFrame(tick);
      }
      tick();
    } catch (e) {
      setStatus("voice-status", "❌ Brak dostępu do mikrofonu: " + e.message);
    }
  });

  // 7. Motywy + Szablon
  function applyTheme(name) {
    const valid = ["fusionote", "snapo", "granat"].includes(name) ? name : "fusionote";
    document.documentElement.setAttribute("data-theme", valid);
    try { localStorage.setItem("kerabot_theme", valid); } catch (e) {}
    document.querySelectorAll("[data-theme-pick]").forEach((b) => b.classList.toggle("active", b.dataset.themePick === valid));
  }
  document.querySelectorAll("[data-theme-pick]").forEach((b) => b.addEventListener("click", () => applyTheme(b.dataset.themePick)));

  if ($("template-json-box")) $("template-json-box").textContent = JSON.stringify(MODULE_TEMPLATE, null, 2);
  $("btn-copy-template")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(MODULE_TEMPLATE, null, 2));
      setStatus("template-status", "✅ Skopiowano szablon modułu z Rejestrem Aktualizacji!");
    } catch (e) {}
  });

  $("btn-refresh-manifest")?.addEventListener("click", () => loadUpdatesAndRegistry(true));
  $("btn-send-alarm")?.addEventListener("click", triggerLoudAlarm);
  $("btn-open-channel-settings")?.addEventListener("click", () => openNativeSettings("channel"));
  $("btn-open-system-sounds")?.addEventListener("click", () => openNativeSettings("sound"));
  $("btn-open-accessibility")?.addEventListener("click", () => openNativeSettings("accessibility"));

  // Start
  try { applyTheme(localStorage.getItem("kerabot_theme") || "fusionote"); } catch (e) { applyTheme("fusionote"); }
  $("app-version-badge").textContent = "v" + CURRENT_APP_VERSION;
  updateDeviceInfo();
  updateNetworkUi();
  renderOutbox();
  consumePendingAndroidShare();
  loadUpdatesAndRegistry(true);

  const startHash = (window.location.hash || "").replace(/^#/, "").trim();
  if (startHash) switchTab(startHash);
})();
