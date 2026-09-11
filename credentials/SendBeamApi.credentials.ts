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

	icon: Icon = 'file:../nodes/SendBeam/sendbeam-logo.svg';

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
				'Create one in SendBeam under Settings → API Keys and give it the permissions the workflow needs: contacts:read for the credential test, the read and write permissions for the contacts, lists, tags, campaigns or automations it uses, and webhooks:read plus webhooks:write for the trigger node.',
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
	 * Tests against /contacts: every operation this node offers touches a
	 * contact, so a key that cannot read contacts cannot do anything useful here.
	 */
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://sendbeam.io',
			url: '/api/v1/contacts',
			method: 'GET',
			qs: { per_page: 1 },
		},
	};
}
