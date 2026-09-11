const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { SendBeamApi } = require('../dist/credentials/SendBeamApi.credentials.js');
const { sendBeamApiRequest } = require('../dist/nodes/SendBeam/GenericFunctions.js');

describe('Credential', () => {
	test('asks only for the API key, like other hosted services', () => {
		assert.deepEqual(
			new SendBeamApi().properties.map((p) => p.name),
			['apiKey'],
		);
	});

	test('tests the key against sendbeam.io', () => {
		assert.equal(new SendBeamApi().test.request.baseURL, 'https://sendbeam.io');
	});

	test('sends every request to sendbeam.io, even from a credential saved with an older base URL', async () => {
		let sent;
		const ctx = {
			getCredentials: async () => ({ apiKey: 'test-key', baseUrl: 'https://elsewhere.example' }),
			getNode: () => ({ name: 'SendBeam', type: 'n8n-nodes-sendbeam.sendBeam', typeVersion: 1 }),
			helpers: {
				async httpRequestWithAuthentication(credentialType, request) {
					sent = { credentialType, ...request };
					return {};
				},
			},
		};
		await sendBeamApiRequest.call(ctx, 'GET', '/contacts', {}, { per_page: 1 });
		assert.equal(sent.url, 'https://sendbeam.io/api/v1/contacts');
		assert.equal(sent.credentialType, 'sendBeamApi');
	});
});
