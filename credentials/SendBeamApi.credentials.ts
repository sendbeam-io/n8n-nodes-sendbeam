import type {
	Icon,
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class SendBeamApi implements ICredentialType {
	name = 'sendBeamApi';

	displayName = 'SendBeam API';

	icon: Icon = 'file:../nodes/SendBeam/sendbeam.svg';

	documentationUrl = 'https://sendbeam.io/docs/api';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Create one in SendBeam under Settings → API Keys. A key belongs to one workspace and carries that workspace\'s permissions, so only workspace admins can create one.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://sendbeam.io',
			description: 'Change this only if you run SendBeam somewhere other than sendbeam.io',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'x-api-key': '={{$credentials.apiKey}}',
			},
		},
	};

	// A GET, deliberately. Reads are unmetered on every plan, so testing a
	// credential never eats into the workspace's hourly write allowance.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/api/v1/lists',
			method: 'GET',
		},
	};
}
