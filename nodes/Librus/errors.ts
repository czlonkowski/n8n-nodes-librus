const messages: Record<string, string> = {
	UNSAFE_URL: 'Librus wskazał niedozwolony adres. Nie wysłano do niego zapytania.',
	TRANSPORT_ERROR:
		'Nie udało się połączyć z Librusem. Sprawdź połączenie i spróbuj ponownie później.',
	PROTOCOL_ERROR:
		'Librus zwrócił odpowiedź w nieoczekiwanym formacie. Integracja może wymagać aktualizacji.',
	AUTH_FAILED: 'Librus odrzucił logowanie. Sprawdź login i hasło na stronie Librusa.',
	ACTION_REQUIRED: 'Zaloguj się na stronie Librusa i uzupełnij wymagane potwierdzenia konta.',
	SESSION_EXPIRED: 'Sesja Librusa wygasła podczas zapytania.',
	RATE_LIMITED: 'Librus ogranicza liczbę zapytań. Odczekaj przed kolejną próbą.',
	ACCESS_DENIED: 'Librus odmówił dostępu. Sprawdź uprawnienia konta na stronie Librusa.',
	SERVICE_ERROR: 'Librus jest niedostępny lub zwrócił nieoczekiwany status HTTP.',
	SCAN_INCOMPLETE:
		'Nie udało się sprawdzić całej skrzynki w wyznaczonych granicach. Zwiększ Maksymalną liczbę stron lub ogranicz liczbę pobieranych wiadomości.',
	// The calendar path has no page limit to raise; its only lever is the month window.
	CALENDAR_SCAN_INCOMPLETE:
		'Nie udało się sprawdzić całego terminarza w wyznaczonych granicach. Zmniejsz Liczbę miesięcy do przodu i spróbuj ponownie.',
	FULL_CONTENT_LIMIT:
		'W jednym wykonaniu można pobrać pełną treść maksymalnie 50 wiadomości. Wyłącz Pobierz wszystkie i ustaw Limit na 50 lub mniej.',
	INVALID_OPTIONS: 'Nieprawidłowe dane logowania do Librusa lub ustawienia pobierania wiadomości.',
	// The calendar events have no message settings; their only numeric setting is the window.
	CALENDAR_INVALID_OPTIONS:
		'Nieprawidłowe dane logowania do Librusa lub ustawienia sprawdzania terminarza. Sprawdź Liczbę miesięcy do przodu.',
	TRIGGER_STATE_INVALID:
		'Zapisana historia wykrytych wiadomości jest nieprawidłowa. Utwórz ponownie węzeł Nowa wiadomość, aby zapamiętać aktualną skrzynkę.',
	TRIGGER_STATE_LIMIT:
		'Osiągnięto limit historii 10 000 wiadomości. Utwórz ponownie węzeł Nowa wiadomość, aby zapamiętać aktualną skrzynkę.',
	CALENDAR_STATE_INVALID:
		'Zapisana historia terminarza jest nieprawidłowa. Utwórz ponownie węzeł z wydarzeniem terminarza, aby zapamiętać aktualny kalendarz.',
	CALENDAR_STATE_LIMIT:
		'Osiągnięto limit historii 2000 wydarzeń terminarza. Zmniejsz Liczbę miesięcy do przodu lub utwórz węzeł ponownie, aby zapamiętać aktualny kalendarz.',
};
export type AuthStage =
	| 'rozpoczęcie logowania'
	| 'przesłanie danych logowania'
	| 'kontynuacja autoryzacji'
	| 'otwarcie skrzynki';
export type AuthDestination =
	| 'autoryzacja OAuth'
	| 'powrót OAuth do Synergii'
	| 'logowanie do Synergii'
	| 'strona Synergii'
	| 'serwis wiadomości'
	| 'inna dozwolona strona';

export class LibrusError extends Error {
	/** HTTP status when the failure came from a response. Never shown to users. */
	status?: number;
	constructor(
		public readonly code: string,
		stage?: AuthStage,
		destination?: AuthDestination,
		rejection?:
			| 'adres bez HTTPS'
			| 'dane logowania w adresie URL'
			| 'niestandardowy port'
			| 'nierozpoznana domena',
	) {
		super(
			(messages[code] ?? messages.PROTOCOL_ERROR) +
				(stage ? ` [Etap: ${stage}; strona: ${destination}]` : '') +
				(rejection ? ` [Odrzucone przekierowanie: ${rejection}]` : ''),
		);
	}
}
export function safeError(error: unknown): LibrusError {
	return error instanceof LibrusError ? error : new LibrusError('PROTOCOL_ERROR');
}
// Diagnostics contain only code-owned labels and primitive type names, never values.
// Callers pass their own literal-union type, so each module keeps an exhaustive label list.
export function protocolError(check: string, value?: unknown): LibrusError {
	const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
	const error = new LibrusError('PROTOCOL_ERROR');
	error.message += ` [Walidacja: ${check}; otrzymany typ: ${type}]`;
	return error;
}
