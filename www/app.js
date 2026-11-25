(function () {
  "use strict";

  const CURRENT_APP_VERSION = "0.2.0";
  const CURRENT_BUILD_CODE = 4;
  const REMOTE_MANIFEST_URL =
    "https://raw.githubusercontent.com/spiekarek/kerabot-android/main/www/updates_manifest.json";
  const REMOTE_REGISTRY_URL =
    "https://raw.githubusercontent.com/spiekarek/kerabot-android/main/www/REJESTR_AKTUALIZACJI.json";
  const OUTBOX_KEY = "kerabot_offline_outbox_v1";

  const MODULE_TEMPLATE = {
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
        data: "2026-11-25",
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

  // 1. Zakladki
  function switchTab(tabId) {
    document.querySelectorAll(".tab-panel").forEach((p) => {
      p.classList.toggle("active", p.id === "tab-" + tabId);
    });
    document.querySelectorAll(".nav-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === tabId);
    });
  }

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // 2. Przelacznik paneli KeraBota W SRODKU APLIKACJI (zero wyrzucania do Chrome!)
  const kbIframe = $("kerabot-iframe");
  document.querySelectorAll("[data-kb-url]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-kb-url]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if (kbIframe) kbIframe.src = btn.dataset.kbUrl;
    });
  });

  $("btn-go-offline-queue")?.addEventListener("click", () => switchTab("offline"));

  // 3. Status Online / Offline + automatyczna synchronizacja Kolejki Outbox
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
    const notice = $("kb-offline-notice");
    const frameWrap = $("kb-frame-wrap");
    if (notice && frameWrap) {
      notice.style.display = online ? "none" : "block";
      frameWrap.style.display = online ? "block" : "none";
    }
  }

  window.addEventListener("online", () => {
    updateNetworkUi();
    setStatus("outbox-status", "🟢 Internet wrócił! Możesz wysłać kolejkę offline 1 kliknięciem.");
  });
  window.addEventListener("offline", () => {
    updateNetworkUi();
    setStatus("outbox-status", "🟠 Tryb Offline — nowe wiadomości i zdjęcia zapiszą się lokalnie na telefonie.");
  });

  // 4. Kolejka Offline (Outbox Pattern)
  let pendingPhotoDataUrl = null;

  function loadOutbox() {
    try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]"); } catch (e) { return []; }
  }
  function saveOutbox(items) {
    try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(items.slice(0, 50))); } catch (e) {}
  }

  function renderOutbox() {
    const items = loadOutbox();
    const cnt = $("outbox-count");
    if (cnt) cnt.textContent = String(items.length);
    const list = $("outbox-list");
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<div style="font-size:13px;color:var(--muted);">Brak zapisanych pozycji w kolejce offline.</div>';
      return;
    }
    list.innerHTML = items
      .map((it) => {
        const badge = it.sent ? "✅ Wysłane / Skopiowane" : "⏳ Czeka na internet";
        const imgHtml = it.photo ? '<img class="outbox-img" src="' + it.photo + '" alt="Zdjęcie offline" />' : "";
        return (
          '<div class="outbox-item ' + (it.sent ? "sent" : "") + '">' +
          '  <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px;">' +
          '    <strong>' + badge + "</strong>" +
          '    <span style="font-size:11px;color:var(--muted);">' + esc(it.createdAt) + "</span>" +
          "  </div>" +
          "  <div>" + esc(it.text || "(Tylko zdjęcie)") + "</div>" +
          imgHtml +
          "</div>"
        );
      })
      .join("");
  }

  $("outbox-photo")?.addEventListener("change", (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      pendingPhotoDataUrl = String(reader.result || "");
      setStatus("outbox-status", "📷 Zdjęcie załączone do kolejki offline — kliknij „Zapisz do Kolejki”.");
    };
    reader.readAsDataURL(file);
  });

  $("btn-outbox-save")?.addEventListener("click", () => {
    const text = ($("outbox-text")?.value || "").trim();
    if (!text && !pendingPhotoDataUrl) {
      setStatus("outbox-status", "Wpisz/podyktuj wiadomość lub wybierz zdjęcie.");
      return;
    }
    const items = loadOutbox();
    items.unshift({
      id: Date.now(),
      text,
      photo: pendingPhotoDataUrl,
      createdAt: new Date().toLocaleString("pl-PL"),
      sent: false
    });
    saveOutbox(items);
    if ($("outbox-text")) $("outbox-text").value = "";
    pendingPhotoDataUrl = null;
    renderOutbox();
    setStatus("outbox-status", "✅ Zapisano bezpiecznie w pamięci telefonu (Kolejka Offline).");
  });

  $("btn-outbox-sync")?.addEventListener("click", async () => {
    if (!checkIsOnline()) {
      setStatus("outbox-status", "🟠 Nadal brak internetu — pozycje są bezpieczne w kolejce.");
      return;
    }
    const items = loadOutbox();
    const pending = items.filter((x) => !x.sent);
    if (!pending.length) {
      setStatus("outbox-status", "✅ Wszystkie pozycje z kolejki są już zsynchronizowane.");
      return;
    }
    const joined = pending.map((p) => `[${p.createdAt}] ${p.text}`).join("\n\n");
    try { await navigator.clipboard.writeText(joined); } catch (e) {}
    items.forEach((x) => { x.sent = true; });
    saveOutbox(items);
    renderOutbox();
    setStatus("outbox-status", "✅ Skopiowano " + pending.length + " zaległych wpisów do schowka i otwieram Pokój KeraBota — wklej i wyślij!");
    switchTab("kerabot");
  });

  // Ciagle dyktowanie PL do kolejki offline
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
        "<strong>Wersja:</strong> v" + esc(CURRENT_APP_VERSION) + " (build " + CURRENT_BUILD_CODE + ")<br>" +
        "<strong>Data wydania:</strong> " + esc(p.data_wydania || "2026-11-25") + "<br>" +
        "<strong>Architektura:</strong> " + esc(p.architektura || "Offline-Online") + "<br>" +
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
        $("update-banner-desc").textContent = "Masz: v" + CURRENT_APP_VERSION + " → Nowa: v" + apk.version;
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
            '  <button type="button" class="btn" data-open-in-app="' + esc(m.url) + '">Otwórz w środku aplikacji</button>' +
            "</div>"
          );
        })
        .join("");

      modWrap.querySelectorAll("[data-open-in-app]").forEach((b) => {
        b.addEventListener("click", () => {
          if (kbIframe) kbIframe.src = b.dataset.openInApp;
          switchTab("kerabot");
        });
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
    const isDualPane = w >= 720;
    const hasBridge = typeof window.SebaAndroidBridge !== "undefined";
    let nativeModel = "Przeglądarka / WebView";
    if (hasBridge && window.SebaAndroidBridge.getDeviceInfo) {
      try { nativeModel = window.SebaAndroidBridge.getDeviceInfo(); } catch (e) {}
    }
    const label = $("device-mode-label");
    if (label) label.textContent = isDualPane ? "Tryb Fold/Tablet (" + w + "×" + h + ")" : "Offline+Online (" + w + "×" + h + ")";
    const infoEl = $("device-info-text");
    if (infoEl) {
      infoEl.innerHTML =
        "<strong>Urządzenie:</strong> " + esc(nativeModel) + "<br>" +
        "<strong>Ekran:</strong> " + w + " × " + h + " px<br>" +
        "<strong>Mostek Android + Trwałe logowanie:</strong> " + (hasBridge ? "✅ AKTYWNY" : "ℹ️ Podgląd WWW");
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

  // 7. Motywy kolorystyczne + Szablon Modulow
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
  loadUpdatesAndRegistry(true);
})();
