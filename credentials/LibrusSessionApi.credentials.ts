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
	];
}
