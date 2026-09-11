import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	ILoadOptionsFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

/**
 * Every call to SendBeam goes through here.
 *
 * No HTTP client is imported: a verified community node may carry no runtime
 * dependencies, so this uses n8n's own authenticated request helper, which
 * also means the credential's `x-api-key` header is applied for us.
 */
export async function sendBeamApiRequest(
	this: IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	resource: string,
	body: IDataObject = {},
	qs: IDataObject = {},
): Promise<IDataObject> {
	const credentials = await this.getCredentials('sendBeamApi');
	const baseUrl = ((credentials.baseUrl as string) || 'https://sendbeam.io').replace(/\/+$/, '');

	const options: IHttpRequestOptions = {
		method,
		body,
		qs,
		url: `${baseUrl}/api/v1${resource}`,
		json: true,
	};
	if (!Object.keys(body).length) delete options.body;
	if (!Object.keys(qs).length) delete options.qs;

	try {
		return (await this.helpers.httpRequestWithAuthentication.call(
			this,
			'sendBeamApi',
			options,
		)) as IDataObject;
	} catch (error) {
		const apiError = error as JsonObject;
		// Turn the two answers people actually hit into something that says what
		// to do, rather than surfacing a bare status. Everything else keeps
		// SendBeam's own message, which is already written for a human.
		const status = apiError.statusCode ?? apiError.status;
		const message = String(
			((apiError.error as IDataObject)?.error as string) ?? (error as Error).message ?? '',
		);

		if (status === 429) {
			throw new NodeApiError(this.getNode(), apiError, {
				message: 'SendBeam rate limit reached',
				description:
					message ||
					'This workspace has spent its API writes for the hour. The allowance refills hourly, and a higher plan lifts it. Reads are never counted.',
			});
		}
		if (status === 403) {
			throw new NodeApiError(this.getNode(), apiError, {
				message: 'SendBeam refused this request',
				description:
					message ||
					'The API key does not carry the permission this operation needs. Check the key\'s scopes under Settings → API Keys.',
			});
		}
		throw new NodeApiError(this.getNode(), apiError, message ? { message } : {});
	}
}

/** Whether a request failed because the thing it asked for is already true. */
export function isConflict(error: unknown): boolean {
	return String((error as NodeApiError)?.httpCode) === '409';
}

/**
 * Unwrap a single-resource envelope.
 *
 * SendBeam is not uniform about this, and n8n users feel it: POST /contacts and
 * GET /contacts/{id} answer `{ contact: {...} }`, while POST /webhooks answers
 * the webhook itself. Left alone, half the node's operations would need
 * `$json.contact.id` in the next step and the other half `$json.id`.
 *
 * Only an object with exactly one key holding an object is unwrapped, so
 * genuine multi-field answers — `{ ok, message_id }` from a send, or a list
 * page with its pagination — are passed through untouched.
 */
export function unwrapResource(response: IDataObject): IDataObject {
	const keys = Object.keys(response ?? {});
	if (keys.length !== 1) return response;
	const inner = response[keys[0]];
	if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner as IDataObject;
	return response;
}

/**
 * Fetch every page of a list endpoint.
 *
 * The page size parameter is `limit`, not `per_page` — `per_page` is silently
 * ignored and you get the default 50 back. That matters more than it looks: the
 * first version asked for `per_page: 100` and then treated "fewer than 100
 * returned" as the last page, so every call stopped after 50 rows and reported
 * success. Paging is driven off the `pagination` envelope the API returns
 * instead of inferring the end from a short page.
 */
export async function sendBeamApiRequestAllItems(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	resource: string,
	collection: string,
	qs: IDataObject = {},
): Promise<IDataObject[]> {
	const out: IDataObject[] = [];
	const pageSize = 100;
	let page = 1;
	let totalPages = 1;
	// A ceiling so a paging bug on either side cannot spin forever in someone's
	// workflow.
	const maxPages = 200;

	do {
		const response = await sendBeamApiRequest.call(this, 'GET', resource, {}, {
			...qs,
			page,
			limit: pageSize,
		});
		const batch = (response?.[collection] ?? []) as IDataObject[];
		out.push(...batch);

		const pagination = response?.pagination as IDataObject | undefined;
		totalPages = Number(pagination?.total_pages ?? 1) || 1;
		// No envelope: fall back to the short-page rule, which is right when the
		// page size is the one we actually asked for.
		if (!pagination && batch.length < pageSize) return out;
		page += 1;
	} while (page <= totalPages && page <= maxPages);

	if (page > maxPages) {
		throw new NodeOperationError(
			this.getNode(),
			`Stopped after ${maxPages} pages of ${collection}. Narrow the query, or fetch a fixed number of items.`,
		);
	}
	return out;
}

/**
 * Find the contact with exactly this email address.
 *
 * The API has no lookup by email. `q` is a case-insensitive substring match
 * over email and names, so asking for `jo@example.com` also returns
 * `mojo@example.com`; the exact match is picked out here. SendBeam stores
 * addresses lowercased, so a lowercase comparison is exact.
 */
export async function findContactByEmail(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	email: string,
): Promise<IDataObject | undefined> {
	const wanted = email.trim().toLowerCase();
	const matches = await sendBeamApiRequestAllItems.call(this, '/contacts', 'contacts', { q: wanted });
	return matches.find((c) => String(c.email).toLowerCase() === wanted);
}

type Locator = { mode: string; value: string };

function readLocator(this: IExecuteFunctions, name: string, itemIndex: number): Locator {
	const locator = this.getNodeParameter(name, itemIndex) as Locator;
	const value = String(locator?.value ?? '').trim();
	if (!value) {
		throw new NodeOperationError(this.getNode(), `Choose a ${name}`, { itemIndex });
	}
	return { mode: locator.mode, value };
}

/**
 * The contact an operation acts on. Workflows nearly always have an email
 * address to hand rather than a SendBeam ID, so "By Email" is the default mode
 * and is resolved here.
 */
export async function getContactId(this: IExecuteFunctions, itemIndex: number): Promise<string> {
	const { mode, value } = readLocator.call(this, 'contact', itemIndex);
	if (mode !== 'email') return value;

	const contact = await findContactByEmail.call(this, value);
	if (!contact) {
		throw new NodeOperationError(this.getNode(), `No contact with the email ${value}`, {
			itemIndex,
			description:
				'Nothing in this SendBeam workspace has that address. To add them, use Contact → Create or Update first.',
		});
	}
	return contact.id as string;
}

/** The ID behind a "From List" or "By ID" picker. */
export function getResourceId(this: IExecuteFunctions, name: string, itemIndex: number): string {
	return readLocator.call(this, name, itemIndex).value;
}

export function getListId(this: IExecuteFunctions, itemIndex: number): string {
	return readLocator.call(this, 'list', itemIndex).value;
}

/**
 * The tag an operation acts on. "By Name" is how people think about tags, so a
 * name is matched without regard to case, and — when adding — created if the
 * workspace does not have it yet.
 */
export async function getTagId(
	this: IExecuteFunctions,
	itemIndex: number,
	createIfMissing: boolean,
): Promise<string> {
	const { mode, value } = readLocator.call(this, 'tag', itemIndex);
	if (mode !== 'name') return value;

	const tags = await sendBeamApiRequestAllItems.call(this, '/tags', 'tags');
	const found = tags.find((t) => String(t.name).toLowerCase() === value.toLowerCase());
	if (found) return found.id as string;

	if (!createIfMissing) {
		throw new NodeOperationError(this.getNode(), `No tag called "${value}"`, { itemIndex });
	}
	const created = unwrapResource(await sendBeamApiRequest.call(this, 'POST', '/tags', { name: value }));
	return created.id as string;
}
