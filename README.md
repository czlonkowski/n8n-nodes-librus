<img src="nodes/Librus/librus.png" alt="Logo integracji Librus: otwarta książka, koperta i kropka oznaczająca nową wiadomość" width="112" height="112">

# n8n-nodes-librus

Nieoficjalny węzeł społecznościowy n8n do odczytywania wiadomości z dziennika Librus Synergia. Otwarty kod źródłowy, licencja MIT.

**Projekt jest na etapie eksperymentalnym.** Logowanie i pobranie danych jednej wiadomości sprawdzono na rzeczywistym koncie. Do zweryfikowania pozostają: kompletność treści, zachowanie statusu nieprzeczytanych wiadomości, pobieranie kolejnych stron skrzynki oraz działanie przy cyklicznym uruchamianiu.

## Dostępne funkcje

Operacja **Librus → Message → Get Many** loguje się do Librusa, otwiera sesję modułu wiadomości i zwraca każdą wiadomość jako osobny element danych n8n.

Można pobrać określoną liczbę wiadomości albo całą skrzynkę, strona po stronie. Wynik zawiera identyfikator wiadomości zapisany jako tekst, dane nadawcy, temat, daty w oryginalnym formacie, datę odczytania, informację o załącznikach i tagi. Opcja **Include Content** dołącza treść udostępnioną przez listę wiadomości: dekoduje ją z base64 do UTF-8, zachowując HTML. Jej kompletność wymaga jeszcze porównania z dziennikiem.

Węzeł nie udostępnia operacji wysyłania, usuwania, pobierania załączników ani oznaczania wiadomości jako przeczytane. Nadal trzeba sprawdzić, czy samo pobranie listy przez Librusa zmienia status odczytania.

Dla każdego elementu wejściowego powstaje nowa sesja oparta na ciasteczkach. Nie ma jeszcze trwałego przechowywania sesji ani obsługi tokena odświeżającego. Jeśli podczas pobierania wiadomości zostanie rozpoznane wygaśnięcie sesji, węzeł może zalogować się ponownie jeden raz. Błędne dane logowania, brak dostępu, ograniczenie liczby żądań i błędy serwera nie uruchamiają pętli logowania.

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

Szczegóły techniczne opisano w dokumentach: [architektura](docs/architecture.md), [testy na rzeczywistym koncie](docs/live-verification.md), [wyniki weryfikacji](docs/verification.md) i [bezpieczeństwo](SECURITY.md). Te dokumenty techniczne są obecnie po angielsku.

## Instalacja we własnej instancji n8n

**Paczka nie została jeszcze opublikowana w npm.** Aby przygotować archiwum do instalacji, wykonaj w katalogu projektu:

```sh
npm ci
npm run check
npm pack
```

Zainstaluj powstały plik `.tgz` w katalogu węzłów społecznościowych swojej **testowej instancji n8n**, a następnie uruchom ją ponownie. Przy standardowym profilu jest to katalog `~/.n8n/nodes`. Jeśli korzystasz z kontenera, skopiuj archiwum do kontenera i zadbaj o trwały wolumen z danymi użytkownika n8n. Pomocna jest [instrukcja ręcznej instalacji n8n](https://docs.n8n.io/integrations/community-nodes/installation-and-management/manual-installation/).

Do czasu publikacji paczki nie używaj polecenia `npm install n8n-nodes-librus`.

Projekt jest przeznaczony do **samodzielnie hostowanego n8n jako niezweryfikowany węzeł społecznościowy**. Biblioteka `tough-cookie` zapewnia obsługę ciasteczek z uwzględnieniem ich domen i ścieżek. Ta zależność wyklucza obecną wersję z weryfikacji n8n Cloud według wymogu braku zależności uruchomieniowych, dlatego `n8n.strict` ma wartość `false`.

Zgodnie z konwencją paczek n8n pole `peerDependencies` zawiera `n8n-workflow: "*"`. Nie oznacza to zgodności ze wszystkimi wersjami n8n. Typy używane podczas budowania pochodzą z `n8n-workflow` 2.38.1; próbę na rzeczywistym koncie przeprowadzono w n8n 2.37.10.

## Konfiguracja i pierwszy test

1. W interfejsie n8n utwórz dane uwierzytelniające typu **Librus Session API**. Podaj login i hasło akceptowane przez formularz Synergii — login może różnić się od adresu e-mail konta LIBRUS. n8n szyfruje te dane swoim kluczem instancji.
2. W dzienniku zanotuj, które z ostatnich wiadomości są nieprzeczytane, bez otwierania ich. Zrób to przed testem połączenia: test danych logowania również pobiera jeden wpis z listy wiadomości, choć nie zwraca jego zawartości.
3. Utwórz przepływ **Manual Trigger → Librus**. Wybierz **Message → Get Many**, wyłącz **Return All**, ustaw **Limit: 10** i pozostaw **Include Content** wyłączone.
4. Uruchom węzeł i porównaj wyniki z dziennikiem. Odśwież listę w Librusie i sprawdź, czy status nieprzeczytanych wiadomości się nie zmienił.
5. Włącz **Include Content** i porównaj treść wiadomości wcześniej przeczytanej w dzienniku. Sprawdź także polskie znaki i formatowanie.

Parametr **Maximum Pages** domyślnie wynosi 20, a jego maksymalna wartość to 50. Jedno żądanie pobiera do 50 wpisów. Po osiągnięciu limitu stron, żądań lub czasu węzeł zgłasza błąd zamiast zwracać niepełny wynik. Daty pozostają w formacie źródłowym, ponieważ interpretacja strefy czasowej nie została jeszcze zweryfikowana.

Po włączeniu **Include Content** treść wiadomości trafia do zwykłych danych wykonania n8n. Jej przechowywanie zależy od ustawień zapisywania i usuwania historii wykonań. Jeśli wyświetlasz zwrócony HTML w innej aplikacji, potraktuj go jako niezaufaną treść.

## Powiadomienia — kolejny etap

Po zakończeniu testów na rzeczywistym koncie można zbudować przepływ:

`Schedule Trigger → Librus → sprawdzenie zapisanych identyfikatorów → wysłanie powiadomienia`

Zapamiętuj identyfikatory `messageId` osobno dla każdego konta. Pierwsze pobranie powinno ustalić stan początkowy, żeby nie wysłać powiadomień o całej dotychczasowej skrzynce. Zapisuj udane dostarczenie po wysłaniu powiadomienia. Jeśli zależy Ci na unikaniu duplikatów także przy ponowieniach po błędzie, dodaj trwałą kolejkę wysyłki i mechanizm rozpoznawania wcześniej dostarczonych powiadomień.

Nie wykrywaj nowych wiadomości wyłącznie na podstawie liczby nieprzeczytanych. Przekazany dalej e-mail z Librusa może uruchomić dodatkowe sprawdzenie skrzynki, ale ogólne powiadomienie o nieprzeczytanej wiadomości nie gwarantuje osobnego sygnału dla każdej nowej wiadomości.

Paczka nie zawiera jeszcze wyzwalacza cyklicznego i sama nie uruchamia automatycznych przepływów. Przed pracą bez nadzoru trzeba sprawdzić częstotliwość odpytywania, ponowne używanie sesji, obsługę wielu kont, kompletność treści i zachowanie statusu odczytania.

## Zgłaszanie błędów i rozwój

Błędy i propozycje zmian zgłaszaj w [GitHub Issues](https://github.com/czlonkowski/n8n-nodes-librus/issues). Przed przesłaniem zmian uruchom `npm run check` oraz `npm pack --dry-run`. Do testów dodawaj wyłącznie fikcyjne dane. Opisz sposób odtworzenia problemu, usuwając dane osobowe; nie publikuj loginów, haseł, ciasteczek ani treści prawdziwych wiadomości.

Przy wydawaniu nowej wersji zaktualizuj `CHANGELOG.md`. Repozytorium nie ma automatycznego procesu publikowania paczki w npm.

## Licencja i autorstwo

Kod udostępniono na [licencji MIT](LICENSE). Projekt nie jest powiązany z firmą LIBRUS ani przez nią zatwierdzony. Informacje o źródłach wykorzystanych do poznania sposobu działania integracji znajdują się w [NOTICE.md](NOTICE.md).
