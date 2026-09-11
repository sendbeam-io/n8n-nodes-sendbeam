'use strict';

/**
 * Checks the node against SendBeam's published API description, so a renamed
 * field or path on either side fails here instead of in someone's workflow.
 *
 * Every action runs once against a stand-in that answers anything; each request
 * it makes must be a documented method and path, with only documented body
 * fields and query parameters. Adding an action without a scenario here fails
 * too. Needs network access to https://sendbeam.io/openapi.json.
 */

const { before, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { SendBeam, SendBeamTrigger, runAction, rl } = require('./harness');

const SPEC_URL = process.env.SENDBEAM_OPENAPI_URL ?? 'https://sendbeam.io/openapi.json';
const byEmail = rl('email', 'jo@example.com');

const scenarios = [
	{ resource: 'automation', operation: 'getAll', automationFilters: { status: 'active' } },
	{ resource: 'automation', operation: 'start', automation: rl('list', 'a-1'), contact: byEmail },
	{ resource: 'automation', operation: 'start', automation: rl('list', 'a-1'), contact: rl('id', 'c-1') },
	{
		resource: 'campaign', operation: 'create', name: 'N', subject: 'S', fromEmail: 'news@example.com',
		htmlContent: '<p>x</p>', sendTo: 'list', sendToList: 'l-1', campaignFields: { from_name: 'A', text_content: 'x' },
	},
	{ resource: 'campaign', operation: 'delete', campaign: rl('id', 'cmp-1') },
	{ resource: 'campaign', operation: 'duplicate', campaign: rl('id', 'cmp-1'), duplicateOptions: { nonOpeners: true } },
	{ resource: 'campaign', operation: 'get', campaign: rl('id', 'cmp-1') },
	{ resource: 'campaign', operation: 'getAll', campaignFilters: { status: 'sent' } },
	{ resource: 'campaign', operation: 'getReport', campaign: rl('id', 'cmp-1') },
	{ resource: 'campaign', operation: 'send', campaign: rl('id', 'cmp-1'), sendOptions: { scheduled_at: '2030-01-01T09:00:00Z' } },
	{
		// Finds the existing contact: covers the update path.
		resource: 'contact', operation: 'upsert', email: 'jo@example.com',
		additionalFields: {
			first_name: 'Jo', last_name: 'B', resubscribe: true,
			customFieldsUi: { field: [{ key: 'k', value: 'v' }] }, lists: ['l-1'], tags: ['t-1'],
		},
	},
	{
		// No such contact: covers the create path.
		resource: 'contact', operation: 'upsert', email: 'new@example.com',
		additionalFields: { first_name: 'N', last_name: 'B', source: 'web', resubscribe: true, customFieldsUi: { field: [{ key: 'k', value: 'v' }] } },
	},
	{ resource: 'contact', operation: 'addTag', contact: byEmail, tag: rl('name', 'Brand new') },
	{ resource: 'contact', operation: 'addToList', contact: byEmail, list: rl('list', 'l-1') },
	{ resource: 'contact', operation: 'delete', contact: byEmail },
	{ resource: 'contact', operation: 'get', contact: byEmail },
	{ resource: 'contact', operation: 'getAll', filters: { q: 'jo', status: 'subscribed', tag: 't-1' } },
	{ resource: 'contact', operation: 'getAll', returnAll: true },
	{ resource: 'contact', operation: 'removeFromList', contact: byEmail, list: rl('list', 'l-1') },
	{ resource: 'contact', operation: 'removeTag', contact: byEmail, tag: rl('name', 'Customer') },
	{ resource: 'contact', operation: 'unsubscribe', contact: byEmail },
	{
		resource: 'contact', operation: 'update', contact: byEmail,
		updateFields: { email: 'jo2@example.com', first_name: 'J', last_name: 'B', resubscribe: true, customFieldsUi: { field: [{ key: 'k', value: 'v' }] } },
	},
	{ resource: 'email', operation: 'send', contact: byEmail, subject: 'S', htmlContent: '<p>x</p>', options: { text_content: 'x' } },
	{
		resource: 'email', operation: 'sendTransactional', to: 'a@example.com, b@example.com', subject: 'S', htmlContent: '<p>x</p>',
		transactionalOptions: { cc: 'c@example.com', bcc: 'd@example.com', from_email: 'o@example.com', from_name: 'O', reply_to: 'r@example.com', text: 'x' },
	},
	{ resource: 'list', operation: 'create', name: 'News', listFields: { description: 'd', double_optin: true } },
	{ resource: 'list', operation: 'getAll' },
	{ resource: 'tag', operation: 'create', name: 'VIP', tagFields: { color: '#000000' } },
	{ resource: 'tag', operation: 'getAll' },
];

/** Answers any request with something plausible enough for the node to carry on. */
function anything(req) {
	if (req.method === 'GET' && req.path === '/contacts') {
		return {
			contacts: [{ id: 'c-1', email: 'jo@example.com', status: 'unsubscribed', custom_fields: {} }],
			pagination: { page: 1, limit: 100, total: 1, total_pages: 1 },
		};
	}
	if (req.method === 'GET' && req.path === '/tags') return { tags: [{ id: 't-1', name: 'Customer' }] };
	if (req.method === 'GET' && /^\/(lists|campaigns|automations|segments)$/.test(req.path)) {
		return { [req.path.slice(1)]: [], pagination: { page: 1, limit: 100, total: 0, total_pages: 1 } };
	}
	return { id: 'x-1', contact: { id: 'c-1', email: 'jo@example.com', custom_fields: {} } };
}

let spec;

before(async () => {
	const response = await fetch(SPEC_URL);
	assert.equal(response.ok, true, `could not fetch ${SPEC_URL}`);
	spec = await response.json();
});

const resolve = (x) => (x && x.$ref ? x.$ref.split('/').slice(1).reduce((node, key) => node[key], spec) : x);

function documented(method, path) {
	const full = `/api/v1${path}`;
	for (const [template, operations] of Object.entries(spec.paths)) {
		const re = new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}$`);
		const operation = operations[method.toLowerCase()];
		if (operation && re.test(full)) return { template, operation };
	}
	return undefined;
}

describe('Against the published SendBeam API', () => {
	test('Every action has a scenario here', () => {
		const actions = new SendBeam().description.properties
			.filter((p) => p.name === 'operation')
			.flatMap((p) => p.options.map((o) => `${p.displayOptions.show.resource[0]}/${o.value}`));
		const covered = new Set(scenarios.map((s) => `${s.resource}/${s.operation}`));
		assert.deepEqual(actions.filter((a) => !covered.has(a)), []);
	});

	for (const scenario of scenarios) {
		test(`${scenario.resource} → ${scenario.operation} only uses documented requests`, async () => {
			const { calls } = await runAction({ params: scenario, respond: anything });
			assert.ok(calls.length > 0);

			for (const call of calls) {
				const match = documented(call.method, call.path);
				assert.ok(match, `${call.method} /api/v1${call.path} is not in the API description`);
				const label = `${call.method} ${match.template}`;

				const schema = resolve(match.operation.requestBody?.content?.['application/json']?.schema);
				for (const field of Object.keys(call.body ?? {})) {
					assert.ok(schema?.properties && field in schema.properties, `${label} does not document body field "${field}"`);
				}

				const query = (match.operation.parameters ?? []).map(resolve).filter((p) => p.in === 'query').map((p) => p.name);
				for (const name of Object.keys(call.qs)) {
					// page and limit are sent to every list endpoint; the ones without
					// paging ignore them and return everything.
					if (name === 'page' || name === 'limit') continue;
					assert.ok(query.includes(name), `${label} does not document query parameter "${name}"`);
				}
			}
		});
	}

	test('The trigger offers exactly the events SendBeam sends', () => {
		const offered = new SendBeamTrigger().description.properties.find((p) => p.name === 'events').options.map((o) => o.value);
		assert.deepEqual([...offered].sort(), [...spec.components.schemas.WebhookEvent.enum].sort());
	});

	test('The trigger\'s webhook requests are documented', () => {
		assert.ok(documented('GET', '/webhooks'));
		assert.ok(documented('POST', '/webhooks'));
		assert.ok(documented('DELETE', '/webhooks/w-1'));
		const create = resolve(documented('POST', '/webhooks').operation.requestBody.content['application/json'].schema);
		for (const field of ['url', 'event_types', 'description']) assert.ok(field in create.properties, field);
	});
});
