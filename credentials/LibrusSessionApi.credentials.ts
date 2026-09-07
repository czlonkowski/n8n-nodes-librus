import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class LibrusSessionApi implements ICredentialType {
	name = 'librusSessionApi';
	displayName = 'Librus Session API';
	documentationUrl = 'https://portal.librus.pl/rodzina/synergia/loguj';
	icon = 'file:../nodes/Librus/librus.png' as const;
	properties: INodeProperties[] = [
		{
			displayName: 'Synergia Login',
			name: 'username',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'The login accepted by the Synergia login form, which may differ from your LIBRUS account email',
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
		},
	];
}
