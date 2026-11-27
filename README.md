# KeraBot AI HUB na Androida

Aplikacja otwiera Pokój AI HUB, SebaGry i SebaProgramy. Układ dostosowuje się do szerokości okna na telefonie i na rozłożonym ekranie.

## Pobierz APK

Otwórz [najnowsze wydanie](https://github.com/spiekarek/kerabot-android/releases/latest) po zalogowaniu się na konto GitHub z dostępem do repozytorium. W sekcji **Assets** wybierz [KeraBot-Seba-latest.apk](https://github.com/spiekarek/kerabot-android/releases/latest/download/KeraBot-Seba-latest.apk) i otwórz pobrany plik na telefonie.

[Manifest w repozytorium](www/updates_manifest.json) wskazuje wersję **0.4.0** (kod kompilacji **6**). Wersję udostępnioną do pobrania sprawdź w opisie wydania.

Jeśli masz wersję 0.3.0 podpisaną tym samym kluczem, zainstaluj aktualizację bez odinstalowywania aplikacji, żeby zachować dane i logowanie.

## Zrzuty ekranu i linki

W Galerii zaznacz od 1 do 10 zrzutów i wybierz **Udostępnij → KeraBot AI HUB**. Możesz też udostępnić tekst lub link z innej aplikacji. Materiały znajdziesz w **Inboxie Zrzutów**, gdzie możesz ustawić kategorię i otworzyć podgląd pełnoekranowy.

## Budowanie i weryfikacja

`npm run verify` sprawdza składnię skryptów i poprawność plików JSON. Workflow [Buduj KeraBot Android APK](.github/workflows/build-apk.yml) uruchamia się po zmianie na `main` lub ręcznym wywołaniu. Buduje APK, weryfikuje podpis, wersję i obecność obsługi udostępniania, zapisuje artefakt w Actions i aktualizuje wydanie `latest`.

Natywny mostek powiadomień i mikrofonu znajduje się w [native_android/MainActivity.java](native_android/MainActivity.java). Szablony wydań i modułów są w [templates/](templates/).
