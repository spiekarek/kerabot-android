# Kopia kolejki KeraBot Android

W zakładce **Kolejka offline** wybierz **Zapisz kopię**, wskaż plik i po zapisie sprawdź, czy możesz go otworzyć. **Przywróć z pliku** dopisuje brakujące wpisy, także zdjęcia bez tekstu. Można ponownie wczytać tę samą kopię. Plik zawiera treść wiadomości i zdjęcia, więc przechowuj go tam, gdzie przechowujesz prywatne dokumenty.

**Kopiuj tekst** wpisuje tylko tekst do schowka. **Otwórz Pokój** pozwala go wkleić. Zdjęcia dołącz osobno. Wpisy, które starsza wersja oznaczyła jako skopiowane, sprawdź w Pokoju wraz ze zdjęciami.

Kopie z wersji 0.4 zachowują kategorie i źródła zapisane przez polecenie **Udostępnij → KeraBot AI HUB**. Gdy telefon odmówi zapisu z powodu braku miejsca, istniejąca kolejka pozostaje w pamięci, a aplikacja nie potwierdza zapisu nowego udostępnienia.

## Odtworzenie kolejki z wersji 0.3.0

Wersja 0.3.0 nie ma przycisku eksportu. Oddzielna kompilacja testowa ma własną pamięć Androida. Przed usunięciem poprzedniej instalacji trzeba pozyskać jej kolejkę. Jeżeli właściciel ma już plik zawierający tablicę danych z klucza `kerabot_offline_outbox_v1` lokalnego ekranu aplikacji, **Przywróć z pliku** może go wczytać. Zachowaj działającą instalację, dopóki nie potwierdzisz pełnego odtworzenia. Przytoczona ścieżka została sprawdzona w Chrome na danych z kodu 0.3.0.

## Próba na PC i osobna kompilacja Androida

- `npm run verify` sprawdza składnię i manifesty.
- `node --test tests/android-preview.cjs` sprawdza konfigurację kompilacji bez klucza wydania.
- `node --test tests/offline-backup.cjs` wymaga `playwright-core` na ścieżce modułów Node i Chrome wskazanego przez `CHROME_PATH`. Do porównania dodaj `BEFORE_ROOT` (katalog `www` bazowej wersji) i `PROOF_DIR` (katalog zrzutów).

W świeżym katalogu roboczym z Android SDK i Javą uruchom `npm install`, `npx cap add android`, `npm run cap:sync` i `node scripts/apply_native_bridge.js --preview`. W wygenerowanym projekcie zbuduj `assembleDebug`. Identyfikator `pl.seba.kerabot.kolejkaqa` i standardowy podpis debug pozwalają badać tę kompilację obok obecnej instalacji. Próbę przeprowadź na fikcyjnych danych. Sprawdź zapis do pliku, anulowanie wyboru lokalizacji, odtworzenie tekstu i zdjęcia po świeżej instalacji oraz zachowanie kolejki po powtórnym odtworzeniu.

Po zaliczeniu próby w GitHub Actions przebieg zawiera artefakt **KeraBot-kolejka-qa** z testowym APK.
