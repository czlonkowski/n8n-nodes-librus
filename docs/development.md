# Rozwój i wydawanie paczki

Instrukcja dla osób pracujących nad kodem. Instalację gotowej paczki opisuje [README](../README.md).

## Uruchomienie lokalne


Wymagane są **Node.js 24 LTS** i npm. Testowano na Node.js 24.20.0.

```sh
git clone https://github.com/czlonkowski/n8n-nodes-librus.git
cd n8n-nodes-librus
npm ci
npm run check
N8N_LISTEN_ADDRESS=127.0.0.1 N8N_PORT=5689 npm run dev
```

Edytor n8n będzie dostępny pod adresem **http://localhost:5689**.

Przed uruchomieniem sprawdź `node --version`: potrzebna jest wersja 24 lub nowsza. Plik `.nvmrc` nie przełącza wersji Node.js automatycznie. Jeśli używasz nvm, wykonaj najpierw `nvm use`.

Projekt korzysta z oficjalnego narzędzia `@n8n/node-cli` do budowania paczki, sprawdzania kodu i uruchamiania środowiska deweloperskiego. Skrypt `dev` przechowuje osobny profil n8n w katalogu **`../.n8n-librus-dev`**, poza repozytorium. Nie przenoś profilu do środka projektu: narzędzie tworzy w nim dowiązanie do repozytorium, co prowadziłoby do zapętlenia skanowania katalogów i błędu `ENAMETOOLONG`.

Nie dodawaj do repozytorium profilu n8n ani danych konta. Testy automatyczne korzystają wyłącznie z fikcyjnych odpowiedzi HTTP — nie łączą się z Librusem i nie wymagają prawdziwych danych logowania.

Szczegóły techniczne opisano w dokumentach: [architektura](architecture.md), [testy na rzeczywistym koncie](live-verification.md), [wyniki weryfikacji](verification.md) i [bezpieczeństwo](../SECURITY.md). Te dokumenty techniczne są obecnie po angielsku.

## Ręczna publikacja w npm


Paczka używa nazwy **`@czlonkowski/n8n-nodes-librus`**. Niescopowana nazwa `n8n-nodes-librus` była wcześniej używana przez innego autora. Repozytorium GitHub zachowuje dotychczasową nazwę.

Przy Node.js 24 lub nowszym najpierw wykonaj próbę bez publikacji:

```sh
npm run release -- --dry-run
```

Skrypt instaluje zależności zgodnie z lockfile, uruchamia lint, kompilację i testy, przygotowuje archiwum oraz sprawdza jego zawartość. Tryb próbny nie wymaga zalogowania do npm. Oba tryby wymagają połączenia z rejestrem npm.

Publikacja przygotowanej, jeszcze niewydanej wersji:

```sh
npm login --registry=https://registry.npmjs.org
npm whoami
npm run release
```

Użyj konta **czlonkowski**. Przed właściwą publikacją wszystkie zmiany muszą być zapisane w commicie. npm może poprosić o potwierdzenie logowania/publikacji w przeglądarce lub kod 2FA — wykonaj ten krok bezpośrednio w npm. Nie zapisuj kodów ani tokenów w repozytorium.

Skrypt publikuje dokładnie sprawdzone archiwum jako paczkę publiczną. Wersje stabilne otrzymują tag `latest`, a wersje z sufiksem (np. `0.2.0-beta.1`) — `next`. Nie tworzy tagów Git ani GitHub Release i nie korzysta z GitHub Actions do publikacji. Jeżeli npm zgłosi błąd po wysłaniu paczki, sprawdź rejestr przed ponowieniem; opublikowanej wersji nie można nadpisać:

```sh
npm view @czlonkowski/n8n-nodes-librus version
```

Przy każdym pushu nowej wersji na GitHub podbij numer w `package.json` i `package-lock.json` oraz uzupełnij `CHANGELOG.md`. Zapisz i wypchnij commit, a potem uruchom skrypt:

```sh
npm version patch --no-git-tag-version
# Uzupełnij CHANGELOG.md, następnie zapisz zmiany w Git.
npm run release
```

Zmiana README na GitHub nie aktualizuje opisu już opublikowanej wersji w npm; nowy README trafi do npm wraz z kolejnym wydaniem.

## Testy na rzeczywistym koncie

Procedura i ograniczenia: [testy integracji](live-verification.md), [wyniki](verification.md), [architektura](architecture.md). Nie dodawaj prawdziwych danych konta ani wiadomości do testów, logów lub zgłoszeń.
