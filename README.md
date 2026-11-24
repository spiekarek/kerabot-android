# KeraBot AI HUB — Uniwersalna Aplikacja Android (`.apk`) + Centrum Aktualizacji

Uniwersalna aplikacja na **wszystkie urządzenia z Androidem** (przystosowana m.in. do **Samsung Galaxy Z Fold7** z układem dwupanelowym oraz **Samsung Galaxy S24 Ultra** i **Vivo X300 Ultra**).

## Co zawiera wersja `v0.1.0`
- **Adaptacyjny interfejs (Fold / Telefon):** automatycznie przełącza widok na dwupanelowy przy ekranie `>= 720 px` (rozłożony Fold7) oraz jednokolumnowy z dolnym paskiem na klasycznych smartfonach.
- **Centrum Aktualizacji (`www/updates_manifest.json`):** jedno miejsce dla wersji aplikacji `.apk`, gier **SebaGry** (Gotyx Classic Turbo, AntyGot, Nowa Huta 3D) oraz narzędzi (Seba Rozliczenia, Mapa Radnego D18, Radar Okazji).
- **Natywny Mostek Androida (`native_android/MainActivity.java` — `SebaAndroidBridge`):**
  - Tworzy priorytetowy kanał powiadomień **`AI_HUB_PILNE`** (głośny dźwięk + wibracja).
  - Otwiera natywne ustawienia dźwięku kanału (`openNotificationChannelSettings`), ogólne dźwięki (`openSoundSettings`) i Ułatwienia dostępu (`openAccessibilitySettings`).
  - Obsługuje uprawnienia **Mikrofon** (`RECORD_AUDIO`) i **Powiadomienia** (`POST_NOTIFICATIONS`).
- **Gotowe Szablony Wydań (`templates/`):** `release_entry_template.json`, `update_announcement_template.md`, `new_module_template.html`.

## Jak zbudować i pobrać gotowy plik `.apk` (w 2 minuty przez GitHub Actions)
1. Utwórz na GitHubie puste repozytorium `spiekarek/kerabot-android` (może być prywatne lub publiczne).
2. W folderze `D:\AI HUB LOCAL PC\kerabot-android` uruchom:
   ```bash
   git remote add origin https://github.com/spiekarek/kerabot-android.git
   git push -u origin main
   ```
3. GitHub Actions automatycznie uruchomi workflow **„Buduj KeraBot Android APK”** i w ~2 minuty opublikuje gotowy plik:
   - `KeraBot-Seba-latest.apk` w zakładce **Releases → latest** (stały link do pobrania na wszystkie 3 telefony!).
