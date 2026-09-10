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
		throw new NodeApiError(this.getNode(), apiError);
	}
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
