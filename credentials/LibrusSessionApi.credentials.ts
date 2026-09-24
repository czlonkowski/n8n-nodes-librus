import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class LibrusSessionApi implements ICredentialType {
	name = 'librusSessionApi';
	displayName = 'Librus — dane logowania';
	documentationUrl = 'https://portal.librus.pl/rodzina/synergia/loguj';
	icon = 'file:../nodes/Librus/librus.png' as const;
	properties: INodeProperties[] = [
		{
			displayName: 'Login do Synergii',
			name: 'username',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Login używany w formularzu logowania do Synergii. Może różnić się od adresu e-mail konta LIBRUS',
		},
		{
			displayName: 'Hasło',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
		},
		{
			displayName: 'Proxy',
			name: 'proxyUrl',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			placeholder: 'http://użytkownik:hasło@proxy.example.pl:3128',
			description:
				'Opcjonalny serwer proxy HTTP lub HTTPS, przez który idzie cały ruch do Librusa, np. gdy Librus nie przyjmuje połączeń z adresu serwera n8n. Zostaw puste, aby łączyć się bezpośrednio.',
		},
	];
}
