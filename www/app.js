(function () {
  "use strict";

  const CURRENT_APP_VERSION = "0.1.0";
  const CURRENT_BUILD_CODE = 1;
  const REMOTE_MANIFEST_URL =
    "https://raw.githubusercontent.com/spiekarek/kerabot-android/main/www/updates_manifest.json";

  const RELEASE_TEMPLATE = {
    id: "nazwa-modulu-lub-gry",
    category: "gry",
    name: "Nazwa nowej gry / narzędzia",
    version: "1.0.0",
    status: "QA_PASS",
    url: "https://kordian.s-piekarek.workers.dev/",
    notes: "Krótki opis zmian po polsku (co nowego, co naprawiono)."
  };

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(id, msg) {
    const el = $(id);
    if (el) el.textContent = msg;
  }

  // 1. Przelaczanie zakladek (wspolne dla dolnego paska i bocznego paska na Fold7)
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

  // 2. Detekcja urzadzenia i ekranu (Fold7 vs S24 Ultra / Vivo)
  function updateDeviceInfo() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const isDualPane = w >= 720;
    const hasNativeBridge = typeof window.SebaAndroidBridge !== "undefined";
    let nativeModel = "Przeglądarka / WebView";
    if (hasNativeBridge && typeof window.SebaAndroidBridge.getDeviceInfo === "function") {
      try {
        nativeModel = window.SebaAndroidBridge.getDeviceInfo();
      } catch (e) {}
    }

    const modeText = isDualPane
      ? "Widok dwupanelowy (Fold / Tablet " + w + "x" + h + ")"
      : "Widok telefonu (" + w + "x" + h + ")";

    const label = $("device-mode-label");
    if (label) label.textContent = modeText;

    const infoEl = $("device-info-text");
    if (infoEl) {
      infoEl.innerHTML =
        "<strong>Urządzenie:</strong> " + nativeModel + "<br>" +
        "<strong>Ekran:</strong> " + w + " × " + h + " px (" + (isDualPane ? "tryb dwupanelowy" : "tryb 1-kolumnowy") + ")<br>" +
        "<strong>Mostek natywny Androida:</strong> " + (hasNativeBridge ? "✅ AKTYWNY" : "ℹ️ Tryb podglądu WWW");
    }
  }

  window.addEventListener("resize", updateDeviceInfo);

  // 3. Centrum Aktualizacji (Lokalny manifest + zdalny check z GitHub)
  function renderManifest(manifest, sourceLabel) {
    const apk = manifest.apk_latest || {};
    const listEl = $("apk-changelog-list");
    if (listEl && Array.isArray(apk.changelog_pl)) {
      listEl.innerHTML = apk.changelog_pl.map((line) => "<li>" + line + "</li>").join("");
    }

    const dlBtn = $("btn-download-latest-apk");
    if (dlBtn && apk.download_url) {
      dlBtn.href = apk.download_url;
    }

    const hasNewerApk = Number(apk.build_code || 0) > CURRENT_BUILD_CODE;
    const banner = $("update-banner");
    if (banner) {
      if (hasNewerApk) {
        banner.classList.add("visible");
        $("update-banner-title").textContent = "🚀 Dostępna nowa wersja APK: v" + apk.version;
        $("update-banner-desc").textContent = "Twoja wersja: v" + CURRENT_APP_VERSION + " → Nowa: v" + apk.version;
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
            '    <span class="module-name">' + catIcon + " " + m.name + "</span>" +
            '    <span class="badge ok">v' + m.version + " · " + m.status + "</span>" +
            "  </div>" +
            '  <div class="module-notes">' + m.notes + "</div>" +
            '  <a class="btn" href="' + m.url + '" target="_blank" rel="noopener">Otwórz moduł</a>' +
            "</div>"
          );
        })
        .join("");
    }

    setStatus(
      "updates-status",
      "Źródło: " + sourceLabel + " | Zainstalowane APK: v" + CURRENT_APP_VERSION +
      " | Najnowsze w manifeście: v" + (apk.version || CURRENT_APP_VERSION) +
      (hasNewerApk ? " (DOSTĘPNA AKTUALIZACJA!)" : " (Masz najnowszą wersję ✅)")
    );
  }

  async function loadUpdates(tryRemote) {
    setStatus("updates-status", "Sprawdzanie manifestu aktualizacji...");
    if (tryRemote) {
      try {
        const res = await fetch(REMOTE_MANIFEST_URL + "?t=" + Date.now(), { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          renderManifest(data, "Chmura GitHub (Live)");
          setStatus("start-status", "✅ Sprawdzono aktualizacje w chmurze — manifest aktualny.");
          return;
        }
      } catch (e) {}
    }
    try {
      const localRes = await fetch("updates_manifest.json");
      const localData = await localRes.json();
      renderManifest(localData, "Pakiet lokalny aplikacji (Offline)");
    } catch (e) {
      setStatus("updates-status", "Nie udało się wczytać manifestu: " + e.message);
    }
  }

  // 4. Natywny mostek Androida: Dzwieki, Ustawienia, Testowy Alarm AI HUB
  function openNativeSettings(kind) {
    if (typeof window.SebaAndroidBridge !== "undefined") {
      try {
        if (kind === "channel" && window.SebaAndroidBridge.openNotificationChannelSettings) {
          window.SebaAndroidBridge.openNotificationChannelSettings();
          setStatus("sounds-status", "✅ Otwarto ustawienia dźwięku kanału AI HUB PILNE.");
          return;
        }
        if (kind === "sound" && window.SebaAndroidBridge.openSoundSettings) {
          window.SebaAndroidBridge.openSoundSettings();
          setStatus("sounds-status", "✅ Otwarto ogólne ustawienia dźwięków Androida.");
          return;
        }
        if (kind === "accessibility" && window.SebaAndroidBridge.openAccessibilitySettings) {
          window.SebaAndroidBridge.openAccessibilitySettings();
          setStatus("sounds-status", "✅ Otwarto Ułatwienia dostępu Androida.");
          return;
        }
      } catch (e) {
        setStatus("sounds-status", "Błąd otwierania ustawień: " + e.message);
        return;
      }
    }
    setStatus(
      "sounds-status",
      "ℹ️ Ta funkcja otwiera natywne Ustawienia po zainstalowaniu pliku .apk na telefonie (Fold7 / S24 Ultra / Vivo)."
    );
  }

  function triggerLoudAlarm() {
    if (typeof window.SebaAndroidBridge !== "undefined" && window.SebaAndroidBridge.sendUrgentNotification) {
      try {
        window.SebaAndroidBridge.sendUrgentNotification(
          "🚨 AI HUB PILNE — Test Alarmu",
          "To jest głośny kanał powiadomień AI HUB. Działa na Twoim telefonie!"
        );
        setStatus("sounds-status", "🔔 Wysłano głośne natywne powiadomienie AI HUB PILNE!");
        setStatus("start-status", "🔔 Wysłano testowy głośny alarm AI HUB!");
        return;
      } catch (e) {}
    }

    // Fallback w przegladarce (Web Notification + dzwiek WebAudio)
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [880, 1174, 880].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.value = freq;
        gain.gain.value = 0.18;
        osc.connect(gain);
        gain.connect(ctx.destination);
        const start = ctx.currentTime + idx * 0.22;
        osc.start(start);
        osc.stop(start + 0.16);
      });
    } catch (e) {}
    setStatus("sounds-status", "🔊 Odtworzono sygnał testowy (po instalacji .apk wyśle również natywny baner Androida).");
    setStatus("start-status", "🔊 Odtworzono testowy sygnał alarmu AI HUB.");
  }

  // 5. Mikrofon i dyktowanie po polsku
  let micStream = null;
  let micRaf = null;
  async function toggleMicTest() {
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
      const source = ctx.createMediaStreamSource(micStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      $("btn-mic-test").textContent = "⏹️ Zatrzymaj test mikrofonu";
      setStatus("voice-status", "✅ Mikrofon aktywny — powiedz coś, aby zobaczyć poziom głosu.");

      function tick() {
        if (!micStream) return;
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        const pct = Math.min(100, Math.round((avg / 90) * 100));
        $("mic-meter-bar").style.width = pct + "%";
        micRaf = requestAnimationFrame(tick);
      }
      tick();
    } catch (e) {
      setStatus("voice-status", "❌ Brak dostępu do mikrofonu: " + e.message);
    }
  }

  let recognition = null;
  let isListening = false;
  function toggleSpeechPL() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      setStatus("voice-status", "ℹ️ W tym WebView dyktowanie głosowe jest dostępne przez klawiaturę Google (ikona mikrofonu) lub Chrome.");
      return;
    }
    if (isListening && recognition) {
      recognition.stop();
      isListening = false;
      setStatus("voice-status", "Zatrzymano dyktowanie.");
      return;
    }
    recognition = new SpeechRec();
    recognition.lang = "pl-PL";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onstart = () => {
      isListening = true;
      setStatus("voice-status", "🗣️ Słucham po polsku... Mów teraz!");
    };
    recognition.onresult = (ev) => {
      let text = "";
      for (let i = 0; i < ev.results.length; i++) {
        text += ev.results[i][0].transcript + " ";
      }
      $("speech-output").textContent = text.trim();
    };
    recognition.onerror = (ev) => {
      isListening = false;
      setStatus("voice-status", "Błąd dyktowania: " + ev.error);
    };
    recognition.onend = () => {
      isListening = false;
    };
    recognition.start();
  }

  // 6. Szablony wydan
  const tplBox = $("template-json-box");
  if (tplBox) tplBox.textContent = JSON.stringify(RELEASE_TEMPLATE, null, 2);

  $("btn-copy-template").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(RELEASE_TEMPLATE, null, 2));
      setStatus("template-status", "✅ Skopiowano szablon wydania do schowka!");
    } catch (e) {
      setStatus("template-status", "Zaznacz tekst powyżej i skopiuj ręcznie.");
    }
  });

  // Podpiecie przyciskow
  $("btn-quick-check-updates").addEventListener("click", () => {
    switchTab("updates");
    loadUpdates(true);
  });
  $("btn-refresh-manifest").addEventListener("click", () => loadUpdates(true));
  $("btn-quick-test-alarm").addEventListener("click", triggerLoudAlarm);
  $("btn-send-alarm").addEventListener("click", triggerLoudAlarm);
  $("btn-quick-open-sounds").addEventListener("click", () => openNativeSettings("channel"));
  $("btn-open-channel-settings").addEventListener("click", () => openNativeSettings("channel"));
  $("btn-open-system-sounds").addEventListener("click", () => openNativeSettings("sound"));
  $("btn-open-accessibility").addEventListener("click", () => openNativeSettings("accessibility"));
  $("btn-mic-test").addEventListener("click", toggleMicTest);
  $("btn-speech-start").addEventListener("click", toggleSpeechPL);

  // Start aplikacji
  $("app-version-badge").textContent = "v" + CURRENT_APP_VERSION;
  updateDeviceInfo();
  loadUpdates(false);
})();
