<img src="https://raw.githubusercontent.com/czlonkowski/n8n-nodes-librus/main/nodes/Librus/librus.png" alt="Logo integracji Librus" width="112" height="112">

# Librus dla n8n

Pobieraj wiadomości z Librus Synergia i uruchamiaj automatyzacje po otrzymaniu nowych wiadomości. Paczka zawiera dwa węzły: **Librus** i **Librus Trigger**.

To nieoficjalna, eksperymentalna integracja do **samodzielnie hostowanego n8n**. Nie jest dostępna w n8n Cloud. Instancja n8n musi korzystać z Node.js 24 lub nowszego.

## Instalacja

1. W n8n przejdź do **Settings → Community nodes → Install**.
2. Wklej pełną nazwę paczki, razem ze znakiem `@`:

   ```text
   @czlonkowski/n8n-nodes-librus
   ```

3. Zatwierdź instalację. W edytorze workflow wyszukaj **Librus** lub **Librus Trigger**.

Jeśli widzisz błąd `Failed to check package version existence`, sprawdź nazwę: `czlonkowski/n8n-nodes-librus` bez początkowego `@` jest niepoprawne. [Paczka w npm](https://www.npmjs.com/package/@czlonkowski/n8n-nodes-librus).

## Połączenie z Librusem

W wybranym węźle utwórz dane uwierzytelniające **Librus Session API** i wpisz login oraz hasło używane do logowania w Synergii. Login może różnić się od adresu e-mail konta LIBRUS.

Zapisz dane i sprawdź połączenie. Jeśli pojawi się `ACTION_REQUIRED`, zaloguj się w [serwisie Librus](https://portal.librus.pl/rodzina/synergia/loguj), uzupełnij wymagane potwierdzenia i ponów próbę w n8n.

Dane logowania są przechowywane jako credentials w n8n. Węzeł nie zwraca hasła ani ciasteczek sesji w wynikach.

## Pobieranie wiadomości

W węźle **Librus** wybierz **Message → Get Many**.

| Ustawienie | Działanie |
| --- | --- |
| **Read Status → All** | Wszystkie wiadomości. |
| **Read Status → Unread** | Tylko nieprzeczytane. |
| **Read Status → Read** | Tylko przeczytane. |
| **Limit** | Maksymalna liczba wiadomości pasujących do filtra. |
| **Return All** | Wszystkie pasujące wiadomości, w granicach limitu stron. |
| **Include Content** | Dołączenie treści wiadomości. |
| **Content Source → Preview** | Skrócony podgląd z listy; może urwać się w środku zdania. |
| **Content Source → Full Message** | Pełna treść ze szczegółów wiadomości. |

Każda wiadomość jest osobnym elementem danych z polami m.in. `messageId`, `senderName`, `topic`, `sendDate`, `readDate` i `isAnyFileAttached`. Po włączeniu treści wynik zawiera także `content` oraz `contentSource` (`preview` lub `full`).

**Aby pobrać pełną treść, włącz Include Content i wybierz Full Message.** Pobranie szczegółów może oznaczyć wiadomość jako przeczytaną w Librusie. W jednym wykonaniu można pobrać pełną treść maksymalnie 50 wiadomości.

Jeśli znasz ID wiadomości, wybierz **Message → Get Content** i podaj **Message ID**. Ta operacja zwraca `messageId`, `content` i `contentSource: "full"`.

## Automatyzacja po nowej wiadomości

1. Dodaj **Librus Trigger** i wybierz zapisane dane logowania.
2. Wybierz **Event → New Message**.
3. Ustaw **Poll Times**, np. **Every X → 5 → Minutes**. Węzeł sprawdza skrzynkę cyklicznie; powiadomienie pojawi się po kolejnym sprawdzeniu.
4. Ręcznie przetestuj węzeł. Zwróci jedną obecną wiadomość jako próbkę; pusta skrzynka nie zwróci danych.
5. Dodaj dalsze kroki i opublikuj/aktywuj workflow.

**Pierwsze automatyczne sprawdzenie zapamiętuje obecną skrzynkę bez uruchamiania workflow dla starych wiadomości.** Kolejne sprawdzenia wykrywają nowe ID, również gdy wiadomość została już przeczytana w aplikacji Librusa. Zmiana statusu starej wiadomości nie uruchamia triggera ponownie. Ręczne testy nie zmieniają tej historii.

Trigger domyślnie zwraca metadane i skrócony podgląd. Aby dołączyć pełną treść, dodaj po nim **Librus → Get Content** i ustaw **Message ID** na:

```text
{{ $json.messageId }}
```

Przykładowy workflow: **Librus Trigger → Librus (Get Content) → wybrany kanał powiadomień**. Jeśli wystarczy temat i podgląd, pomiń Get Content.

## Ograniczenia i rozwiązywanie problemów

- **Mark as Unread / Mark as Read**, wysyłanie, usuwanie i pobieranie załączników nie są obsługiwane. Odczyt pełnej treści może sam zmienić status wiadomości w Librusie.
- **`SCAN_INCOMPLETE`**: zwiększ **Maximum Pages** (domyślnie 20, maksymalnie 50). Przy Get Many możesz też ograniczyć liczbę wyników. Trigger musi sprawdzić całą skrzynkę; niepełny skan nie aktualizuje jego historii.
- **`FULL_CONTENT_LIMIT`**: wyłącz Return All i ustaw Limit na 50 lub mniej.
- **Błąd dalszego kroku workflow**: ponów nieudane wykonanie w n8n. Kolejne sprawdzenie triggera nie wyemituje tej samej wiadomości ponownie. Przy równoległych wykonaniach lub wielu instancjach możliwe są duplikaty.
- Historia triggera obejmuje do **10 000 ID**. Po osiągnięciu limitu utwórz nowy trigger, który zapamięta aktualną skrzynkę jako stan początkowy. Zmiana konta lub utrata zapisanej historii również ustala nowy stan początkowy.
- Wiadomość usunięta lub przeniesiona poza skrzynkę pomiędzy sprawdzeniami może nie zostać wykryta.

Integracja korzysta z nieoficjalnych tras Librusa. Długotrwałe działanie harmonogramu i wpływ pobierania listy na status odczytania wymagają jeszcze weryfikacji. Treść wiadomości trafia do danych wykonania workflow — jej przechowywaniem zarządzają ustawienia historii n8n.

## Pomoc

Błędy i propozycje zgłaszaj w [GitHub Issues](https://github.com/czlonkowski/n8n-nodes-librus/issues). Nie umieszczaj w zgłoszeniach loginów, haseł, ciasteczek ani treści prawdziwych wiadomości.

Instrukcje pracy nad kodem: [dokumentacja deweloperska](docs/development.md).

## Licencja

[MIT](LICENSE). Projekt nie jest powiązany z firmą LIBRUS ani przez nią zatwierdzony. [Informacje o autorstwie i źródłach](NOTICE.md).
