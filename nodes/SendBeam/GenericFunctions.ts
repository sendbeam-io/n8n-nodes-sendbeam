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

/** Fetch every page of a list endpoint. SendBeam pages with `page`/`per_page`. */
export async function sendBeamApiRequestAllItems(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	resource: string,
	collection: string,
	qs: IDataObject = {},
): Promise<IDataObject[]> {
	const out: IDataObject[] = [];
	let page = 1;
	// A hard ceiling so a paging bug on either side cannot spin forever inside
	// someone's workflow.
	const maxPages = 200;
	while (page <= maxPages) {
		const response = await sendBeamApiRequest.call(this, 'GET', resource, {}, {
			...qs,
			page,
			per_page: 100,
		});
		const batch = (response?.[collection] ?? []) as IDataObject[];
		out.push(...batch);
		if (batch.length < 100) return out;
		page += 1;
	}
	throw new NodeOperationError(
		this.getNode(),
		`Stopped after ${maxPages} pages of ${collection}. Narrow the query, or fetch a fixed number of items.`,
	);
}
