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
				'Create one in SendBeam under Settings → API Keys — workspace admins only. Grant the scopes the workflow needs: contacts:read at minimum (the credential test uses it), plus contacts:write, lists:write, tags:write or campaigns:write for the matching operations, and webhooks:write for the trigger node.',
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

	/**
	 * Reads are unmetered on every plan, so testing a credential never spends
	 * the workspace's hourly write allowance.
	 *
	 * It tests /contacts specifically. Every endpoint is scope-gated — there is
	 * no universally readable one — so the test has to pick a scope, and this is
	 * the right one: every operation this node offers touches a contact, so a
	 * key without contacts:read cannot do anything useful here anyway. Testing
	 * /lists instead told anyone with a least-privilege contacts-only key that
	 * their perfectly good key had failed.
	 */
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/api/v1/contacts',
			method: 'GET',
			qs: { per_page: 1 },
		},
	};
}
