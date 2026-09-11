'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { SendBeamTrigger, context, httpError } = require('./harness');

const URL_PUBLIC = 'https://n8n.example.com/webhook/abc/webhook';

function hooks(options) {
	const node = new SendBeamTrigger();
	const { ctx, calls } = context(node, options);
	const methods = node.webhookMethods.default;
	return {
		calls,
		ctx,
		create: () => methods.create.call(ctx),
		checkExists: () => methods.checkExists.call(ctx),
		delete: () => methods.delete.call(ctx),
		webhook: () => node.webhook.call(ctx),
	};
}

describe('Registering with SendBeam', () => {
	test('Activating registers the URL for the chosen events and keeps the endpoint ID', async () => {
		const staticData = {};
		const t = hooks({
			webhookUrl: URL_PUBLIC,
			staticData,
			params: { events: ['contact.created', 'form.submitted'] },
			routes: { 'POST /webhooks': { id: 'w-1', secret: 'shown-once' } },
		});
		assert.equal(await t.create(), true);
		assert.deepEqual(t.calls[0].body, {
			url: URL_PUBLIC,
			event_types: ['contact.created', 'form.submitted'],
			description: 'n8n: Test workflow',
		});
		assert.equal(staticData.webhookId, 'w-1');
	});

	for (const url of [
		'http://localhost:5678/webhook/abc/webhook',
		'https://localhost/webhook/abc/webhook',
		'https://127.0.0.1/webhook/abc/webhook',
		'http://n8n.example.com/webhook/abc/webhook',
	]) {
		test(`An address SendBeam cannot reach is explained, not sent: ${url}`, async () => {
			const t = hooks({ webhookUrl: url, params: { events: ['contact.created'] } });
			await assert.rejects(t.create(), (error) => {
				assert.equal(error.message, 'SendBeam cannot reach this n8n instance');
				assert.match(error.description, /WEBHOOK_URL/);
				return true;
			});
			assert.equal(t.calls.length, 0);
		});
	}

	test('An existing endpoint for this URL is found rather than duplicated', async () => {
		const staticData = {};
		const t = hooks({
			webhookUrl: URL_PUBLIC,
			staticData,
			routes: {
				'GET /webhooks': {
					webhooks: [
						{ id: 'w-other', url: 'https://n8n.example.com/webhook/other/webhook' },
						{ id: 'w-1', url: URL_PUBLIC },
					],
				},
			},
		});
		assert.equal(await t.checkExists(), true);
		assert.equal(staticData.webhookId, 'w-1');

		const none = hooks({ webhookUrl: URL_PUBLIC, routes: { 'GET /webhooks': { webhooks: [] } } });
		assert.equal(await none.checkExists(), false);
	});
});

describe('Unregistering', () => {
	test('Deactivating deletes the endpoint it created', async () => {
		const staticData = { webhookId: 'w-1' };
		const t = hooks({ webhookUrl: URL_PUBLIC, staticData, routes: { 'DELETE /webhooks/:id': '' } });
		assert.equal(await t.delete(), true);
		assert.deepEqual(t.calls.map((c) => `${c.method} ${c.path}`), ['DELETE /webhooks/w-1']);
		assert.equal('webhookId' in staticData, false);
	});

	test('Without a saved ID, the endpoint is found by URL and deleted (a test listener was once left behind)', async () => {
		const t = hooks({
			webhookUrl: URL_PUBLIC,
			staticData: {},
			routes: {
				'GET /webhooks': { webhooks: [{ id: 'w-1', url: URL_PUBLIC }] },
				'DELETE /webhooks/:id': '',
			},
		});
		assert.equal(await t.delete(), true);
		assert.deepEqual(t.calls.map((c) => `${c.method} ${c.path}`), ['GET /webhooks', 'DELETE /webhooks/w-1']);
	});

	test('Deactivating never gets stuck on an endpoint that is already gone', async () => {
		const t = hooks({
			webhookUrl: URL_PUBLIC,
			staticData: { webhookId: 'w-1' },
			routes: { 'DELETE /webhooks/:id': httpError(404, 'Webhook not found') },
		});
		assert.equal(await t.delete(), true);
		// Not silent: n8n's log says why the endpoint was left alone.
		assert.equal(t.ctx.logger.warnings.length, 1);
		assert.match(t.ctx.logger.warnings[0], /could not remove its webhook endpoint: Webhook not found/);
	});
});

describe('Receiving events', () => {
	test('The whole event is passed on, delivery ID included', async () => {
		const event = {
			id: '380515ab-296e-4800-9798-fac158358117',
			event: 'contact.created',
			created_at: '2026-09-11T08:12:16.602Z',
			data: { contact: { id: 'b790ee4c', email: 'jo@example.com', status: 'subscribed', tags: [] } },
		};
		const t = hooks({ body: event });
		const result = await t.webhook();
		assert.deepEqual(result.workflowData[0][0].json, event);
	});

	test('Every event has a readable name and a distinct value', () => {
		const events = new SendBeamTrigger().description.properties.find((p) => p.name === 'events').options;
		assert.equal(events.length, 21);
		assert.equal(new Set(events.map((e) => e.value)).size, 21);
		for (const e of events) assert.match(e.name, /^[A-Z][a-z]+( [A-Z][a-z]+)+$/, `${e.value} → "${e.name}"`);
	});
});
