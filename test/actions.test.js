'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { SendBeam, context, runAction, httpError, rl, contact, page } = require('./harness');

const byEmail = rl('email', 'jo@example.com');
// A search for "jo@example.com" also matches "mojo@example.com".
const searchHits = page('contacts', [contact({ id: 'c-9', email: 'mojo@example.com' }), contact()]);

describe('Contact', () => {
	test('Create or Update creates a contact that does not exist yet', async () => {
		const { out, calls } = await runAction({
			params: {
				resource: 'contact',
				operation: 'upsert',
				email: ' Jo@Example.com ',
				additionalFields: {
					first_name: 'Jo',
					last_name: '',
					source: 'website',
					customFieldsUi: { field: [{ key: 'plan', value: 'pro' }] },
				},
			},
			routes: {
				'GET /contacts': page('contacts', []),
				'POST /contacts': (req) => ({ contact: contact({ email: req.body.email.toLowerCase() }) }),
			},
		});
		assert.equal(calls[0].qs.q, 'jo@example.com');
		assert.equal(calls[1].method, 'POST');
		assert.deepEqual(calls[1].body, {
			email: 'Jo@Example.com',
			first_name: 'Jo',
			source: 'website',
			custom_fields: { plan: 'pro' },
		});
		assert.equal(out[0].id, 'c-1', 'the contact comes out unwrapped');
	});

	test('Create or Update updates the contact with that exact email, keeping its other custom fields', async () => {
		const { calls } = await runAction({
			params: {
				resource: 'contact',
				operation: 'upsert',
				email: 'jo@example.com',
				additionalFields: {
					last_name: 'Bloggs',
					source: 'import',
					resubscribe: true,
					customFieldsUi: { field: [{ key: 'plan', value: 'pro' }] },
				},
			},
			routes: {
				'GET /contacts': page('contacts', [
					contact({ id: 'c-9', email: 'mojo@example.com' }),
					contact({ custom_fields: { plan: 'free', city: 'Leeds' } }),
				]),
				'PATCH /contacts/:id': { contact: contact() },
			},
		});
		assert.equal(calls.length, 2, 'no create');
		assert.equal(calls[1].path, '/contacts/c-1');
		assert.deepEqual(calls[1].body, {
			last_name: 'Bloggs',
			custom_fields: { plan: 'pro', city: 'Leeds' },
		}, 'source is only set on create; resubscribe is dropped for a subscribed contact');
	});

	test('Create or Update resubscribes an unsubscribed contact when asked', async () => {
		const { calls } = await runAction({
			params: { resource: 'contact', operation: 'upsert', email: 'jo@example.com', additionalFields: { resubscribe: true } },
			routes: {
				'GET /contacts': page('contacts', [contact({ status: 'unsubscribed' })]),
				'PATCH /contacts/:id': { contact: contact() },
			},
		});
		assert.deepEqual(calls[1].body, { resubscribe: true });
	});

	test('Create or Update with nothing to change makes no write', async () => {
		const { out, calls } = await runAction({
			params: { resource: 'contact', operation: 'upsert', email: 'jo@example.com', additionalFields: {} },
			routes: { 'GET /contacts': page('contacts', [contact()]) },
		});
		assert.equal(calls.length, 1);
		assert.equal(out[0].id, 'c-1');
	});

	test('Create or Update adds lists and tags, and ones already there count as done', async () => {
		const { calls } = await runAction({
			params: {
				resource: 'contact',
				operation: 'upsert',
				email: 'new@example.com',
				additionalFields: { lists: ['l-1'], tags: ['t-1', 't-2'] },
			},
			routes: {
				'GET /contacts': page('contacts', []),
				'POST /contacts': { contact: contact({ id: 'c-new', email: 'new@example.com' }) },
				'POST /lists/:id/contacts': httpError(409, 'Contact is already in this list'),
				'POST /contacts/:id/tags': (req) =>
					req.body.tag_id === 't-1' ? httpError(409, 'Contact already has this tag') : { contact_tag: {} },
			},
		});
		assert.deepEqual(
			calls.slice(2).map((c) => `${c.method} ${c.path} ${JSON.stringify(c.body)}`),
			[
				'POST /lists/l-1/contacts {"contact_id":"c-new"}',
				'POST /contacts/c-new/tags {"tag_id":"t-1"}',
				'POST /contacts/c-new/tags {"tag_id":"t-2"}',
			],
		);
	});

	test('Get finds the contact by exact email, not a partial match', async () => {
		const { out, calls } = await runAction({
			params: { resource: 'contact', operation: 'get', contact: byEmail },
			routes: { 'GET /contacts': searchHits, 'GET /contacts/:id': { contact: contact() } },
		});
		assert.equal(calls[1].path, '/contacts/c-1');
		assert.equal(out[0].email, 'jo@example.com');
	});

	test('Get by ID makes no lookup', async () => {
		const { calls } = await runAction({
			params: { resource: 'contact', operation: 'get', contact: rl('id', 'c-1') },
			routes: { 'GET /contacts/:id': { contact: contact() } },
		});
		assert.deepEqual(calls.map((c) => c.path), ['/contacts/c-1']);
	});

	test('Get from the list uses the chosen ID', async () => {
		const { calls } = await runAction({
			params: { resource: 'contact', operation: 'get', contact: rl('list', 'c-1') },
			routes: { 'GET /contacts/:id': { contact: contact() } },
		});
		assert.deepEqual(calls.map((c) => c.path), ['/contacts/c-1']);
	});

	test('An email with no contact says so and how to add one', async () => {
		await assert.rejects(
			runAction({
				params: { resource: 'contact', operation: 'get', contact: byEmail },
				routes: { 'GET /contacts': page('contacts', []) },
			}),
			(error) => {
				assert.equal(error.message, 'No contact with the email jo@example.com');
				assert.match(error.description, /Create or Update/);
				return true;
			},
		);
	});

	test('An expression that finds nothing says the contact is empty', async () => {
		await assert.rejects(
			runAction({ params: { resource: 'contact', operation: 'get', contact: rl('email', '') } }),
			/The contact is empty/,
		);
	});

	test('Update merges custom fields onto what the contact has', async () => {
		const { calls } = await runAction({
			params: {
				resource: 'contact',
				operation: 'update',
				contact: rl('id', 'c-1'),
				updateFields: { first_name: 'Joanne', customFieldsUi: { field: [{ key: 'plan', value: 'pro' }] } },
			},
			routes: {
				'GET /contacts/:id': { contact: contact({ custom_fields: { plan: 'free', city: 'Leeds' } }) },
				'PATCH /contacts/:id': { contact: contact() },
			},
		});
		assert.deepEqual(calls[1].body, { first_name: 'Joanne', custom_fields: { plan: 'pro', city: 'Leeds' } });
	});

	test('Update with no fields is refused before calling SendBeam', async () => {
		await assert.rejects(
			runAction({
				params: { resource: 'contact', operation: 'update', contact: rl('id', 'c-1'), updateFields: {} },
			}),
			/Add at least one field to update/,
		);
	});

	test('Unsubscribe sets the status', async () => {
		const { calls } = await runAction({
			params: { resource: 'contact', operation: 'unsubscribe', contact: rl('id', 'c-1') },
			routes: { 'PATCH /contacts/:id': { contact: contact({ status: 'unsubscribed' }) } },
		});
		assert.deepEqual(calls[0].body, { status: 'unsubscribed' });
	});

	test('Delete', async () => {
		const { out, calls } = await runAction({
			params: { resource: 'contact', operation: 'delete', contact: rl('id', 'c-1') },
			routes: { 'DELETE /contacts/:id': { success: true } },
		});
		assert.equal(calls[0].path, '/contacts/c-1');
		assert.deepEqual(out, [{ success: true }]);
	});

	test('Add to List succeeds when the contact is already a member', async () => {
		const { out, calls } = await runAction({
			params: { resource: 'contact', operation: 'addToList', contact: rl('id', 'c-1'), list: rl('list', 'l-1') },
			routes: { 'POST /lists/:id/contacts': httpError(409, 'Contact is already in this list') },
		});
		assert.deepEqual(calls[0].body, { contact_id: 'c-1' });
		assert.equal(out[0].already_member, true);
	});

	test('Add to List does not hide other failures', async () => {
		await assert.rejects(
			runAction({
				params: { resource: 'contact', operation: 'addToList', contact: rl('id', 'c-1'), list: rl('list', 'l-1') },
				routes: {
					'POST /lists/:id/contacts': httpError(422, 'Cannot add a contact with status: unsubscribed.'),
				},
			}),
			/Cannot add a contact with status: unsubscribed/,
		);
	});

	test('Remove From List sends the contact in the body', async () => {
		const { calls } = await runAction({
			params: { resource: 'contact', operation: 'removeFromList', contact: rl('id', 'c-1'), list: rl('id', 'l-1') },
			routes: { 'DELETE /lists/:id/contacts': { success: true } },
		});
		assert.equal(calls[0].path, '/lists/l-1/contacts');
		assert.deepEqual(calls[0].body, { contact_id: 'c-1' });
	});

	test('Add Tag by name uses the existing tag whatever its case', async () => {
		const { calls } = await runAction({
			params: { resource: 'contact', operation: 'addTag', contact: rl('id', 'c-1'), tag: rl('name', 'customer') },
			routes: {
				'GET /tags': { tags: [{ id: 't-1', name: 'Customer' }] },
				'POST /contacts/:id/tags': { contact_tag: { contact_id: 'c-1', tag_id: 't-1' } },
			},
		});
		assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ['GET /tags', 'POST /contacts/c-1/tags']);
		assert.deepEqual(calls[1].body, { tag_id: 't-1' });
	});

	test('Add Tag by name creates a tag that does not exist', async () => {
		const { calls } = await runAction({
			params: { resource: 'contact', operation: 'addTag', contact: rl('id', 'c-1'), tag: rl('name', 'VIP') },
			routes: {
				'GET /tags': { tags: [] },
				'POST /tags': { tag: { id: 't-new', name: 'VIP' } },
				'POST /contacts/:id/tags': { contact_tag: {} },
			},
		});
		assert.deepEqual(calls[1].body, { name: 'VIP' });
		assert.deepEqual(calls[2].body, { tag_id: 't-new' });
	});

	test('Add Tag succeeds when the contact already has it', async () => {
		const { out } = await runAction({
			params: { resource: 'contact', operation: 'addTag', contact: rl('id', 'c-1'), tag: rl('id', 't-1') },
			routes: { 'POST /contacts/:id/tags': httpError(409, 'Contact already has this tag') },
		});
		assert.equal(out[0].already_tagged, true);
	});

	test('Remove Tag by name never creates a tag', async () => {
		const { calls } = await runAction({
			params: { resource: 'contact', operation: 'removeTag', contact: rl('id', 'c-1'), tag: rl('name', 'Customer') },
			routes: {
				'GET /tags': { tags: [{ id: 't-1', name: 'Customer' }] },
				'DELETE /contacts/:id/tags/:tagId': { success: true },
			},
		});
		assert.equal(calls[1].path, '/contacts/c-1/tags/t-1');

		await assert.rejects(
			runAction({
				params: { resource: 'contact', operation: 'removeTag', contact: rl('id', 'c-1'), tag: rl('name', 'VIP') },
				routes: { 'GET /tags': { tags: [] } },
			}),
			/No tag called "VIP"/,
		);
	});

	test('Get Many within one page is a single request with the filters', async () => {
		const { calls } = await runAction({
			params: {
				resource: 'contact',
				operation: 'getAll',
				limit: 20,
				filters: { q: '', status: 'subscribed', tag: 't-1' },
			},
			routes: { 'GET /contacts': page('contacts', [contact()]) },
		});
		assert.equal(calls.length, 1);
		assert.deepEqual(calls[0].qs, { status: 'subscribed', tag: 't-1', limit: 20 });
	});

	test('Get Many with Return All follows every page', async () => {
		const { out, calls } = await runAction({
			params: { resource: 'contact', operation: 'getAll', returnAll: true, filters: {} },
			routes: {
				'GET /contacts': (req) =>
					req.qs.page === 1
						? page('contacts', [contact({ id: 'a' }), contact({ id: 'b' })], 2)
						: page('contacts', [contact({ id: 'c' })], 2),
			},
		});
		assert.deepEqual(calls.map((c) => c.qs.page), [1, 2]);
		assert.deepEqual(out.map((c) => c.id), ['a', 'b', 'c']);
	});
});

describe('Email', () => {
	test('Send to Contact finds the contact and sends', async () => {
		const { calls } = await runAction({
			params: {
				resource: 'email',
				operation: 'send',
				contact: byEmail,
				subject: 'Hello',
				htmlContent: '<p>Hi</p>',
				options: { text_content: 'Hi' },
			},
			routes: { 'GET /contacts': searchHits, 'POST /send': { ok: true, message_id: 'm-1' } },
		});
		assert.deepEqual(calls[1].body, { contact_id: 'c-1', subject: 'Hello', html_content: '<p>Hi</p>', text_content: 'Hi' });
	});

	test('Send Transactional splits recipients and leaves out empty options', async () => {
		const { calls } = await runAction({
			params: {
				resource: 'email',
				operation: 'sendTransactional',
				to: 'a@example.com, Jo Bloggs <jo@example.com>',
				subject: 'Your order',
				htmlContent: '<p>Thanks</p>',
				transactionalOptions: { cc: 'c@example.com', bcc: '', from_name: '', reply_to: ' help@example.com ' },
			},
			routes: { 'POST /transactional': { ok: true, sent: [] } },
		});
		assert.deepEqual(calls[0].body, {
			to: ['a@example.com', 'Jo Bloggs <jo@example.com>'],
			subject: 'Your order',
			html: '<p>Thanks</p>',
			cc: ['c@example.com'],
			reply_to: 'help@example.com',
		});
	});

	test('Send Transactional to one recipient sends a single address', async () => {
		const { calls } = await runAction({
			params: { resource: 'email', operation: 'sendTransactional', to: 'a@example.com', subject: 'S', htmlContent: 'x' },
			routes: { 'POST /transactional': { ok: true, sent: [] } },
		});
		assert.equal(calls[0].body.to, 'a@example.com');
	});
});

describe('Campaign', () => {
	const create = {
		resource: 'campaign',
		operation: 'create',
		name: ' September ',
		subject: 'News',
		fromEmail: 'news@example.com',
		htmlContent: '<p>News</p>',
		campaignFields: { from_name: 'Acme', text_content: '' },
	};

	test('Create to a list', async () => {
		const { calls } = await runAction({
			params: { ...create, sendTo: 'list', sendToList: 'l-1' },
			routes: { 'POST /campaigns': { campaign: { id: 'cmp-1' } } },
		});
		assert.deepEqual(calls[0].body, {
			name: 'September',
			subject: 'News',
			from_email: 'news@example.com',
			html_content: '<p>News</p>',
			send_to_type: 'list',
			send_to_id: 'l-1',
			from_name: 'Acme',
		});
	});

	test('Create to a segment, and to everyone', async () => {
		const segment = await runAction({
			params: { ...create, sendTo: 'segment', sendToSegment: 's-1' },
			routes: { 'POST /campaigns': { campaign: { id: 'cmp-1' } } },
		});
		assert.equal(segment.calls[0].body.send_to_id, 's-1');

		const all = await runAction({
			params: { ...create, sendTo: 'all' },
			routes: { 'POST /campaigns': { campaign: { id: 'cmp-1' } } },
		});
		assert.equal(all.calls[0].body.send_to_type, 'all');
		assert.equal('send_to_id' in all.calls[0].body, false);
	});

	test('Send now posts no body; an empty answer still gives an item', async () => {
		const { out, calls } = await runAction({
			params: { resource: 'campaign', operation: 'send', campaign: rl('list', 'cmp-1') },
			routes: { 'POST /campaigns/:id/send': '' },
		});
		assert.equal(calls[0].path, '/campaigns/cmp-1/send');
		assert.equal(calls[0].body, undefined);
		assert.deepEqual(out, [{ id: 'cmp-1', status: 'sending' }]);
	});

	test('Send later posts the time as ISO 8601', async () => {
		const { calls } = await runAction({
			params: {
				resource: 'campaign',
				operation: 'send',
				campaign: rl('id', 'cmp-1'),
				sendOptions: { scheduled_at: '2030-01-02T09:00:00.000Z' },
			},
			routes: { 'POST /campaigns/:id/send': { id: 'cmp-1', status: 'scheduled', scheduled_at: '2030-01-02T09:00:00Z' } },
		});
		assert.deepEqual(calls[0].body, { scheduled_at: '2030-01-02T09:00:00.000Z' });
	});

	test('Duplicate, optionally to non-openers', async () => {
		const plain = await runAction({
			params: { resource: 'campaign', operation: 'duplicate', campaign: rl('id', 'cmp-1') },
			routes: { 'POST /campaigns/:id/duplicate': { campaign: { id: 'cmp-2' } } },
		});
		assert.equal(plain.calls[0].body, undefined);
		assert.equal(plain.out[0].id, 'cmp-2');

		const nonOpeners = await runAction({
			params: { resource: 'campaign', operation: 'duplicate', campaign: rl('id', 'cmp-1'), duplicateOptions: { nonOpeners: true } },
			routes: { 'POST /campaigns/:id/duplicate': { campaign: { id: 'cmp-3' } } },
		});
		assert.deepEqual(nonOpeners.calls[0].body, { audience: 'non_openers' });
	});

	test('Delete, Get and Get Report', async () => {
		const deleted = await runAction({
			params: { resource: 'campaign', operation: 'delete', campaign: rl('id', 'cmp-1') },
			routes: { 'DELETE /campaigns/:id': '' },
		});
		assert.deepEqual(deleted.out, [{ id: 'cmp-1', deleted: true }]);

		const got = await runAction({
			params: { resource: 'campaign', operation: 'get', campaign: rl('id', 'cmp-1') },
			routes: { 'GET /campaigns/:id': { campaign: { id: 'cmp-1', name: 'September' } } },
		});
		assert.equal(got.out[0].name, 'September');

		const report = await runAction({
			params: { resource: 'campaign', operation: 'getReport', campaign: rl('id', 'cmp-1') },
			routes: { 'GET /campaigns/:id/report': { campaign_id: 'cmp-1', links: [], clients: [], devices: [], opens: 0, clicks: 0 } },
		});
		assert.equal(report.calls[0].path, '/campaigns/cmp-1/report');
		assert.equal(report.out[0].campaign_id, 'cmp-1');
	});

	test('Get Many filters by status', async () => {
		const { calls } = await runAction({
			params: { resource: 'campaign', operation: 'getAll', limit: 10, campaignFilters: { status: 'sent' } },
			routes: { 'GET /campaigns': page('campaigns', []) },
		});
		assert.deepEqual(calls[0].qs, { status: 'sent', limit: 10 });
	});
});

describe('Automation', () => {
	test('Start by email lets SendBeam look the contact up', async () => {
		const { out, calls } = await runAction({
			params: { resource: 'automation', operation: 'start', automation: rl('list', 'a-1'), contact: byEmail },
			routes: { 'POST /automations/:id/trigger': '' },
		});
		assert.equal(calls.length, 1, 'no contact lookup');
		assert.equal(calls[0].path, '/automations/a-1/trigger');
		assert.deepEqual(calls[0].body, { email: 'jo@example.com' });
		assert.deepEqual(out, [{ automation_id: 'a-1', email: 'jo@example.com', started: true }]);
	});

	test('Start by ID sends the contact ID', async () => {
		const { calls } = await runAction({
			params: { resource: 'automation', operation: 'start', automation: rl('id', 'a-1'), contact: rl('id', 'c-1') },
			routes: { 'POST /automations/:id/trigger': '' },
		});
		assert.deepEqual(calls[0].body, { contact_id: 'c-1' });
	});

	test('Start with an empty email expression says so', async () => {
		await assert.rejects(
			runAction({
				params: { resource: 'automation', operation: 'start', automation: rl('list', 'a-1'), contact: rl('email', '') },
			}),
			/The contact is empty/,
		);
	});

	test('Get Many', async () => {
		const { calls } = await runAction({
			params: { resource: 'automation', operation: 'getAll', returnAll: true, automationFilters: { status: 'active' } },
			routes: { 'GET /automations': { automations: [{ id: 'a-1' }] } },
		});
		assert.equal(calls[0].qs.status, 'active');
	});
});

describe('List and Tag', () => {
	test('Create a list and a tag', async () => {
		const list = await runAction({
			params: { resource: 'list', operation: 'create', name: 'News', listFields: { description: 'Weekly', double_optin: true } },
			routes: { 'POST /lists': { list: { id: 'l-1' } } },
		});
		assert.deepEqual(list.calls[0].body, { name: 'News', description: 'Weekly', double_optin: true });
		assert.equal(list.out[0].id, 'l-1');

		const tag = await runAction({
			params: { resource: 'tag', operation: 'create', name: 'VIP', tagFields: { color: '#2563EB' } },
			routes: { 'POST /tags': { tag: { id: 't-1' } } },
		});
		assert.deepEqual(tag.calls[0].body, { name: 'VIP', color: '#2563EB' });
	});

	test('Get Many respects the limit', async () => {
		const { out } = await runAction({
			params: { resource: 'tag', operation: 'getAll', limit: 1 },
			routes: { 'GET /tags': { tags: [{ id: 't-1' }, { id: 't-2' }] } },
		});
		assert.deepEqual(out.map((t) => t.id), ['t-1']);
	});
});

describe('Errors', () => {
	const get = (response) =>
		runAction({
			params: { resource: 'contact', operation: 'get', contact: rl('id', 'c-1') },
			routes: { 'GET /contacts/:id': response },
		});

	test('429 says the rate limit was reached, in SendBeam\'s words', async () => {
		await assert.rejects(get(httpError(429, 'Hourly API write limit reached.')), (error) => {
			assert.equal(error.message, 'SendBeam rate limit reached');
			assert.equal(error.description, 'Hourly API write limit reached.');
			assert.equal(error.httpCode, '429');
			return true;
		});
	});

	test('403 says the request was refused', async () => {
		await assert.rejects(get(httpError(403, 'This API key is missing the contacts:read scope.')), (error) => {
			assert.equal(error.message, 'SendBeam refused this request');
			assert.match(error.description, /contacts:read/);
			return true;
		});
	});

	test('Any other failure shows SendBeam\'s own message, not n8n\'s generic one', async () => {
		await assert.rejects(get(httpError(404, 'Contact not found')), (error) => {
			assert.equal(error.message, 'Contact not found');
			assert.equal(error.httpCode, '404');
			return true;
		});
	});

	test('Continue On Fail passes the error on as an item', async () => {
		const { out } = await runAction({
			params: { resource: 'contact', operation: 'get', contact: rl('id', 'c-1') },
			routes: { 'GET /contacts/:id': httpError(404, 'Contact not found') },
			continueOnFail: true,
		});
		assert.deepEqual(out, [{ error: 'Contact not found' }]);
	});

	test('Each input item runs with its own values', async () => {
		const emails = ['a@example.com', 'b@example.com'];
		const { out, calls } = await runAction({
			items: [{ json: {} }, { json: {} }],
			params: { resource: 'contact', operation: 'upsert', email: (i) => emails[i], additionalFields: {} },
			routes: {
				'GET /contacts': page('contacts', []),
				'POST /contacts': (req) => ({ contact: contact({ id: req.body.email, email: req.body.email }) }),
			},
		});
		assert.deepEqual(calls.filter((c) => c.method === 'POST').map((c) => c.body.email), emails);
		assert.deepEqual(out.map((c) => c.id), emails);
	});
});

describe('Pickers', () => {
	test('Automations list only those that can be started from outside', async () => {
		const node = new SendBeam();
		const { ctx } = context(node, {
			routes: {
				'GET /automations': {
					automations: [
						{ id: 'a-1', name: 'Welcome', trigger_type: 'api' },
						{ id: 'a-2', name: 'On signup', trigger_type: 'contact_created' },
						{ id: 'a-3', name: 'Either way', trigger_type: 'contact_created', triggers: [{ type: 'api' }] },
					],
				},
			},
		});
		const { results } = await node.methods.listSearch.searchAutomations.call(ctx, '');
		assert.deepEqual(results.map((r) => r.value), ['a-1', 'a-3']);
	});

	test('Contacts show email and name, and page on', async () => {
		const node = new SendBeam();
		const { ctx, calls } = context(node, {
			routes: {
				'GET /contacts': {
					contacts: [contact({ first_name: 'Jo', last_name: 'Bloggs' }), contact({ id: 'c-2', email: 'x@example.com' })],
					pagination: { page: 1, limit: 50, total: 60, total_pages: 2 },
				},
			},
		});
		const result = await node.methods.listSearch.searchContacts.call(ctx, 'jo');
		assert.equal(calls[0].qs.q, 'jo');
		assert.deepEqual(result.results.map((r) => r.name), ['jo@example.com (Jo Bloggs)', 'x@example.com']);
		assert.equal(result.paginationToken, '2');
	});
});

describe('Node description', () => {
	const node = new SendBeam();
	const operations = node.description.properties
		.filter((p) => p.name === 'operation')
		.flatMap((p) => p.options.map((o) => ({ resource: p.displayOptions.show.resource[0], operation: o.value, action: o.action })));

	test('Every action has an action name for the node panel', () => {
		assert.equal(operations.length, 25);
		for (const o of operations) assert.ok(o.action, `${o.resource}/${o.operation} has no action name`);
	});

	test('Every action has a canvas subtitle, and the expression cannot close early', () => {
		const body = node.description.subtitle.replace(/^=\{\{/, '').replace(/\}\}$/, '');
		assert.equal(body.includes('}}'), false, 'a "}}" inside the expression ends it early in n8n');
		const evaluate = new Function('$parameter', `return ${body}`);
		for (const o of operations) {
			const subtitle = evaluate({ resource: o.resource, operation: o.operation });
			assert.equal(typeof subtitle, 'string', `${o.resource}/${o.operation} has no subtitle`);
			assert.ok(subtitle.length > 0);
		}
	});
});
