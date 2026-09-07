<img src="nodes/Librus/librus.png" alt="Logo integracji Librus: otwarta książka, koperta i kropka oznaczająca nową wiadomość" width="112" height="112">

# n8n-nodes-librus

Nieoficjalna paczka węzłów społecznościowych n8n do odczytywania wiadomości z dziennika Librus Synergia. Otwarty kod źródłowy, licencja MIT.

**Projekt jest na etapie eksperymentalnym.** Na rzeczywistym koncie sprawdzono logowanie, pobranie danych jednej wiadomości oraz jej treści z modułu szczegółów. Do zweryfikowania pozostają: zachowanie statusu nieprzeczytanych wiadomości, kompletność treści w różnych typach wiadomości, pobieranie kolejnych stron skrzynki oraz działanie przy cyklicznym uruchamianiu.

## Dostępne funkcje

Operacja **Librus → Message → Get Many** loguje się do Librusa, otwiera sesję modułu wiadomości i zwraca każdą wiadomość jako osobny element danych n8n.

Można pobrać określoną liczbę wiadomości albo całą skrzynkę, strona po stronie. **Read Status** pozwala wybrać wszystkie (**All**), tylko nieprzeczytane (**Unread**) lub przeczytane (**Read**). Filtr działa na dacie odczytania z listy: brak daty albo pusty tekst oznacza wiadomość nieprzeczytaną. **Limit dotyczy pasujących wiadomości**. Węzeł przegląda metadane kolejnych stron lokalnie, więc znalezienie starszych nieprzeczytanych może wymagać zwiększenia Maximum Pages. Pełną treść pobiera dopiero dla wiadomości wybranych przez filtr i limit. Wynik zawiera identyfikator wiadomości zapisany jako tekst, dane nadawcy, temat, daty w oryginalnym formacie, datę odczytania, informację o załącznikach i tagi. Opcja **Include Content** dołącza treść, a **Content Source** określa jej źródło:

| Content Source | Zawartość pola `content` |
| --- | --- |
| **Preview** — domyślnie | Skrót z listy wiadomości. Może urwać się w środku zdania. |
| **Full Message** | Treść pobrana osobno ze szczegółów każdej wiadomości. |

W obu trybach treść jest dekodowana z base64 do UTF-8, z zachowaniem HTML. Pole `contentSource` w wyniku ma wartość `preview` albo `full`. Przy wyłączonym **Include Content** oba pola są pomijane.

**Aby otrzymać pełną treść, włącz Include Content i wybierz Content Source → Full Message.** Samo włączenie Include Content zachowuje dotychczasowe działanie — podgląd z listy. W próbie na rzeczywistym koncie podgląd miał 95 znaków, a odpowiedź ze szczegółów tej samej wiadomości zawierała 463 znaki i zaczynała się od całego podglądu.

Pobranie szczegółów **może oznaczyć wiadomość jako przeczytaną w Librusie**. Nie sprawdzono jeszcze tego efektu na nieprzeczytanej wiadomości; próbę wykonano na wiadomości już przeczytanej. Wybierz Full Message świadomie, szczególnie w przepływach uruchamianych automatycznie.

**Librus → Message → Get Content** pobiera pełną treść pojedynczej wiadomości po **Message ID** i zwraca `messageId`, `content` oraz `contentSource: "full"`. Można przekazać ID z triggera wyrażeniem `{{ $json.messageId }}`. Metadane pozostają dostępne w danych poprzedniego węzła. Także ta operacja może oznaczyć wiadomość jako przeczytaną.

Paczka nie udostępnia wysyłania, usuwania, pobierania załączników ani osobnych operacji **Mark as Read / Mark as Unread**. W zbadanym interfejsie nowego modułu wiadomości Librusa nie znaleziono operacji przywracania statusu nieprzeczytanej; dlatego nie deklarujemy jej obsługi. Nadal trzeba sprawdzić, czy samo pobranie listy przez Librusa zmienia status odczytania.

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
5. Włącz **Include Content**, wybierz **Content Source → Full Message** i porównaj treść wiadomości wcześniej przeczytanej w dzienniku. Sprawdź także polskie znaki i formatowanie. Na pierwszą próbę ustaw **Limit: 1**.

Parametr **Maximum Pages** domyślnie wynosi 20, a jego maksymalna wartość to 50. Jedno żądanie pobiera do 50 wpisów. Po osiągnięciu limitu stron, żądań lub czasu węzeł zgłasza błąd zamiast zwracać niepełny wynik. Daty pozostają w formacie źródłowym, ponieważ interpretacja strefy czasowej nie została jeszcze zweryfikowana.

Tryb **Full Message** obsługuje do **50 wiadomości na wykonanie**. Szczegóły są pobierane kolejno, w tej samej sesji, dopiero po zakończeniu pobierania listy, zastosowaniu limitu i usunięciu duplikatów identyfikatorów. Jeśli wynik zawiera więcej niż 50 wiadomości, węzeł zgłosi `FULL_CONTENT_LIMIT` przed pobraniem szczegółów. Wyłącz wtedy Return All i ustaw Limit na 50 lub mniej.

Błąd pobrania szczegółów zatrzymuje wykonanie — węzeł nie zastępuje brakującej pełnej treści skrótem. Nie zwraca też częściowego wyniku, choć wcześniejsze żądania szczegółów mogły już wpłynąć na status odczytania w Librusie. Pole `readDate` pochodzi z listy pobranej przed odczytem szczegółów. Przy filtrze Unread i odnowieniu wygasłej sesji zachowywany jest już wybrany zestaw identyfikatorów, aby wcześniejszy odczyt szczegółów nie usunął ich z bieżącego wyniku.

Po włączeniu **Include Content** treść wiadomości trafia do zwykłych danych wykonania n8n. Jej przechowywanie zależy od ustawień zapisywania i usuwania historii wykonań. Podgląd dołączany przez trigger i treść z Get Content również trafiają do danych wykonania. Jeśli wyświetlasz zwrócony HTML w innej aplikacji, potraktuj go jako niezaufaną treść.

## Librus Trigger — nowa wiadomość

Osobny węzeł **Librus Trigger** cyklicznie sprawdza skrzynkę i uruchamia przepływ dla nowych identyfikatorów `messageId`. Jest to odpytywanie Librusa według harmonogramu; opóźnienie zależy od **Poll Times**.

1. Dodaj **Librus Trigger**, wybierz zapisane dane **Librus Session API** i zdarzenie **New Message**.
2. Ustaw **Poll Times** na **Every X → 5 → Minutes** lub rzadziej. n8n domyślnie ustawia minutę, więc zmień ten parametr. Bezpieczna częstotliwość dla Librusa nadal wymaga sprawdzenia.
3. Użyj ręcznego testu triggera: zwróci jedną bieżącą wiadomość jako próbkę, niezależnie od jej wieku i statusu. Pusta skrzynka nie zwróci próbki. Test nie zmienia historii wykrytych wiadomości.
4. Połącz kolejne kroki i zapisz przepływ. Przykład: **Librus Trigger → Librus (Get Content, Message ID: `{{ $json.messageId }}`) → wybrany kanał powiadomień**. Do powiadomienia z samym tematem i podglądem wystarczy bezpośrednie wyjście triggera.
5. Po opublikowaniu/aktywacji przepływu pierwsze automatyczne sprawdzenie zapamięta całą obecną skrzynkę i nie uruchomi dalszych kroków. Dopiero kolejne sprawdzenia zwrócą nowe wiadomości. Zwykłe zapisanie nieaktywnego workflow nie uruchamia harmonogramu.

Trigger sprawdza zarówno przeczytane, jak i nieprzeczytane wiadomości. Wiadomość odczytana w aplikacji przed kolejnym sprawdzeniem nadal zostanie wykryta. Zmiana statusu starej wiadomości nie jest nowym zdarzeniem. **Include Preview** domyślnie dołącza skróconą treść; trigger nie pobiera szczegółów wiadomości. Możesz wyłączyć podgląd i otrzymywać same metadane.

Stan triggera jest przechowywany przez n8n osobno dla węzła: wersja formatu, skrót identyfikujący konto i identyfikatory wykrytych wiadomości. Nie zawiera hasła, ciasteczek ani treści. Przy zachowaniu tego stanu restart nie odtwarza historii. Zmiana konta lub utworzenie nowego triggera ustala nowy stan początkowy. Utrata bazy n8n oznacza utratę tej historii.

Każde automatyczne sprawdzenie musi ukończyć przegląd całej skrzynki w granicach **Maximum Pages** (domyślnie 20, maksymalnie 50), 100 żądań i 120 sekund. Niepełny skan kończy się błędem i nie zmienia historii. Historia mieści do **10 000 identyfikatorów**; po przekroczeniu limitu pojawi się błąd. Utworzenie nowego triggera rozpocznie historię od aktualnej skrzynki bez odtwarzania starych zdarzeń. Wiadomość usunięta lub przeniesiona poza skrzynkę pomiędzy sprawdzeniami może pozostać niewykryta.

**Błąd dalszego kroku nie cofa historii triggera.** Jeżeli np. wysyłka powiadomienia się nie powiedzie, ponów nieudane wykonanie w n8n. Samo następne sprawdzenie nie wyśle tej wiadomości ponownie. Przy równoległych wykonaniach lub wielu instancjach możliwe są duplikaty. Gdy potrzebujesz gwarancji dostarczenia i deduplikacji także przy awariach, zapisuj zdarzenia w trwałej kolejce z kluczem konto + `messageId` i osobno potwierdzaj udaną wysyłkę.

Testy automatyczne obejmują stan początkowy, restart, zmianę statusu, błędy skanowania i równoległe sprawdzenia. Działanie harmonogramu na rzeczywistym koncie, skutki ponownego logowania i zachowanie statusu odczytania wymagają jeszcze próby. Paczka nie aktywuje workflow automatycznie.

## Zgłaszanie błędów i rozwój

Błędy i propozycje zmian zgłaszaj w [GitHub Issues](https://github.com/czlonkowski/n8n-nodes-librus/issues). Przed przesłaniem zmian uruchom `npm run check` oraz `npm pack --dry-run`. Do testów dodawaj wyłącznie fikcyjne dane. Opisz sposób odtworzenia problemu, usuwając dane osobowe; nie publikuj loginów, haseł, ciasteczek ani treści prawdziwych wiadomości.

Przy wydawaniu nowej wersji zaktualizuj `CHANGELOG.md`. Repozytorium nie ma automatycznego procesu publikowania paczki w npm.

## Licencja i autorstwo

Kod udostępniono na [licencji MIT](LICENSE). Projekt nie jest powiązany z firmą LIBRUS ani przez nią zatwierdzony. Informacje o źródłach wykorzystanych do poznania sposobu działania integracji znajdują się w [NOTICE.md](NOTICE.md).
