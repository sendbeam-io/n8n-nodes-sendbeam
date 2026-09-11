'use strict';

/**
 * Runs the built node (dist/) the way n8n does, without n8n.
 *
 * The one thing worth being exact about is failure: n8n's request helper turns
 * an HTTP error into a NodeApiError before the node sees it, and the node's
 * error handling depends on that shape. `httpError` builds it the same way.
 */

const { NodeApiError } = require('n8n-workflow');
const { SendBeam } = require('../dist/nodes/SendBeam/SendBeam.node.js');
const { SendBeamTrigger } = require('../dist/nodes/SendBeamTrigger/SendBeamTrigger.node.js');

const BASE = 'https://sendbeam.test';
const NODE = { name: 'SendBeam', type: 'n8n-nodes-sendbeam.sendBeam', typeVersion: 1, parameters: {} };

/** What axios throws. n8n reads the status from `response` because of the class name. */
class AxiosError extends Error {
	constructor(status, data) {
		super(`Request failed with status code ${status}`);
		this.isAxiosError = true;
		this.response = { status, data };
	}
}

/** The error n8n's authenticated request helper throws for an HTTP failure. */
function httpError(status, message) {
	return new NodeApiError(NODE, new AxiosError(status, { error: message }));
}

/** A resource locator value, as n8n stores it. */
const rl = (mode, value) => ({ __rl: true, mode, value });

/**
 * Routes are "METHOD /path" with `:param` segments, paths without /api/v1.
 * A request no route matches fails the test, so nothing is called by accident.
 */
function router(routes) {
	const compiled = Object.entries(routes).map(([key, handler]) => {
		const [method, path] = key.split(' ');
		return { method, re: new RegExp(`^${path.replace(/:[^/]+/g, '[^/]+')}$`), handler };
	});
	return (req) => {
		const route = compiled.find((r) => r.method === req.method && r.re.test(req.path));
		if (!route) throw new Error(`Unexpected request: ${req.method} ${req.path}`);
		return typeof route.handler === 'function' ? route.handler(req) : route.handler;
	};
}

function context(node, options = {}) {
	const { params = {}, items = [{ json: {} }], routes = {}, respond, continueOnFail = false } = options;
	const calls = [];
	const handle = respond ?? router(routes);

	// Parameters a test leaves out take the node's own default, as in n8n.
	const defaults = {};
	for (const p of node.description.properties) if (!(p.name in defaults)) defaults[p.name] = p.default;

	const ctx = {
		getInputData: () => items,
		getNode: () => NODE,
		getCredentials: async () => ({ apiKey: 'test-key' }),
		continueOnFail: () => continueOnFail,
		getNodeParameter(name, itemIndex, fallback, opts) {
			let value = name in params ? params[name] : fallback !== undefined ? fallback : defaults[name];
			if (typeof value === 'function') value = value(itemIndex);
			if (opts?.extractValue && value && typeof value === 'object' && value.__rl) return value.value;
			return value;
		},
		getNodeWebhookUrl: () => options.webhookUrl,
		getWorkflow: () => ({ name: 'Test workflow' }),
		getWorkflowStaticData: () => options.staticData ?? (options.staticData = {}),
		getBodyData: () => options.body,
		helpers: {
			async httpRequestWithAuthentication(credentialType, request) {
				const url = new URL(request.url);
				const req = {
					method: request.method,
					path: url.pathname.replace(/^\/api\/v1/, ''),
					qs: request.qs ?? {},
					body: request.body,
					credentialType,
					headers: request.headers,
				};
				calls.push(req);
				const result = await handle(req);
				if (result instanceof Error) throw result;
				return result;
			},
			returnJsonArray: (data) => (Array.isArray(data) ? data : [data]).map((json) => ({ json })),
		},
	};
	return { ctx, calls };
}

async function runAction(options) {
	const node = new SendBeam();
	const { ctx, calls } = context(node, options);
	const [out] = await node.execute.call(ctx);
	return { out: out.map((o) => o.json), calls };
}

const contact = (over = {}) => ({
	id: 'c-1',
	email: 'jo@example.com',
	first_name: '',
	last_name: '',
	status: 'subscribed',
	custom_fields: {},
	...over,
});

const page = (key, rows, totalPages = 1) => ({
	[key]: rows,
	pagination: { page: 1, limit: 100, total: rows.length, total_pages: totalPages },
});

module.exports = { SendBeam, SendBeamTrigger, context, runAction, httpError, rl, contact, page, BASE };
