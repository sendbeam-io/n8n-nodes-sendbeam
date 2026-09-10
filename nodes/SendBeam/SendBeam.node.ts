import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { sendBeamApiRequest, sendBeamApiRequestAllItems } from './GenericFunctions';

export class SendBeam implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SendBeam',
		name: 'sendBeam',
		icon: 'file:sendbeam.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Create and update contacts, manage lists and tags, and send email with SendBeam',
		usableAsTool: true,
		defaults: { name: 'SendBeam' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'sendBeamApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Contact', value: 'contact' },
					{ name: 'Email', value: 'email' },
					{ name: 'List', value: 'list' },
					{ name: 'Tag', value: 'tag' },
				],
				default: 'contact',
			},

			// ── Contact ──────────────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['contact'] } },
				options: [
					{ name: 'Create or Update', value: 'upsert', description: 'Create a new record, or update the current one if it already exists (upsert)', action: 'Create or update a contact' },
					{ name: 'Delete', value: 'delete', action: 'Delete a contact' },
					{ name: 'Get', value: 'get', action: 'Get a contact' },
					{ name: 'Get Many', value: 'getAll', action: 'Get many contacts' },
					{ name: 'Update', value: 'update', action: 'Update a contact' },
				],
				default: 'upsert',
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'name@email.com',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['contact'], operation: ['upsert'] } },
			},
			{
				displayName: 'Contact ID',
				name: 'contactId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['contact'], operation: ['get', 'update', 'delete'] } },
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['contact'], operation: ['upsert', 'update'] } },
				options: [
					{ displayName: 'Custom Fields', name: 'customFieldsUi', type: 'fixedCollection', typeOptions: { multipleValues: true }, default: {}, description: 'Up to 50 keys of your own', options: [{ name: 'field', displayName: 'Field', values: [ { displayName: 'Key', name: 'key', type: 'string', default: '' }, { displayName: 'Value', name: 'value', type: 'string', default: '' } ] }] },
					{ displayName: 'Email', name: 'email', type: 'string', placeholder: 'name@email.com', default: '', displayOptions: { show: { '/operation': ['update'] } } },
					{ displayName: 'First Name', name: 'first_name', type: 'string', default: '' },
					{ displayName: 'Last Name', name: 'last_name', type: 'string', default: '' },
					{
						displayName: 'Resubscribe',
						name: 'resubscribe',
						type: 'boolean',
						default: false,
						description:
							'Whether to bring an unsubscribed contact back. Only set this when the person has given you consent again — it overrides their earlier opt-out.',
					},
					{ displayName: 'Source', name: 'source', type: 'string', default: '', description: 'Where the contact came from. Defaults to "api".' },
				],
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: { show: { resource: ['contact'], operation: ['getAll'] } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1 },
				description: 'Max number of results to return',
				displayOptions: { show: { resource: ['contact'], operation: ['getAll'], returnAll: [false] } },
			},

			// ── Email ────────────────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['email'] } },
				options: [{ name: 'Send', value: 'send', action: 'Send an email to a contact' }],
				default: 'send',
			},
			{
				displayName: 'Contact ID',
				name: 'contactId',
				type: 'string',
				default: '',
				required: true,
				description: 'SendBeam only sends to a contact it knows, so its consent and unsubscribe state are always honoured',
				displayOptions: { show: { resource: ['email'], operation: ['send'] } },
			},
			{
				displayName: 'Subject',
				name: 'subject',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['email'], operation: ['send'] } },
			},
			{
				displayName: 'HTML Content',
				name: 'htmlContent',
				type: 'string',
				typeOptions: { rows: 6 },
				default: '',
				required: true,
				displayOptions: { show: { resource: ['email'], operation: ['send'] } },
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['email'], operation: ['send'] } },
				options: [
					{ displayName: 'Text Content', name: 'text_content', type: 'string', typeOptions: { rows: 4 }, default: '', description: 'Plain-text alternative. Worth sending: some clients and filters prefer it.' },
				],
			},

			// ── List ─────────────────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['list'] } },
				options: [
					{ name: 'Add Contact', value: 'add', action: 'Add a contact to a list' },
					{ name: 'Get Many', value: 'getAll', action: 'Get many lists' },
					{ name: 'Remove Contact', value: 'remove', action: 'Remove a contact from a list' },
				],
				default: 'add',
			},
			{
				displayName: 'List Name or ID',
				name: 'listId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getLists' },
				default: '',
				required: true,
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				displayOptions: { show: { resource: ['list'], operation: ['add', 'remove'] } },
			},
			{
				displayName: 'Contact ID',
				name: 'contactId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['list'], operation: ['add', 'remove'] } },
			},

			// ── Tag ──────────────────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['tag'] } },
				options: [
					{ name: 'Add to Contact', value: 'add', action: 'Add a tag to a contact' },
					{ name: 'Get Many', value: 'getAll', action: 'Get many tags' },
					{ name: 'Remove From Contact', value: 'remove', action: 'Remove a tag from a contact' },
				],
				default: 'add',
			},
			{
				displayName: 'Tag Name or ID',
				name: 'tagId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getTags' },
				default: '',
				required: true,
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				displayOptions: { show: { resource: ['tag'], operation: ['add', 'remove'] } },
			},
			{
				displayName: 'Contact ID',
				name: 'contactId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['tag'], operation: ['add', 'remove'] } },
			},
		],
	};

	methods = {
		loadOptions: {
			async getLists(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const lists = await sendBeamApiRequestAllItems.call(this, '/lists', 'lists');
				return lists.map((l) => ({ name: (l.name as string) ?? (l.id as string), value: l.id as string }));
			},
			async getTags(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const tags = await sendBeamApiRequestAllItems.call(this, '/tags', 'tags');
				return tags.map((t) => ({ name: (t.name as string) ?? (t.id as string), value: t.id as string }));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				let response: IDataObject | IDataObject[] = {};

				if (resource === 'contact') {
					if (operation === 'upsert' || operation === 'update') {
						const extra = this.getNodeParameter('additionalFields', i) as IDataObject;
						const body: IDataObject = {};
						for (const [key, value] of Object.entries(extra)) {
							if (key === 'customFieldsUi') continue;
							if (value !== '' && value !== undefined) body[key] = value;
						}
						const ui = (extra.customFieldsUi as IDataObject) ?? {};
						const pairs = (ui.field as IDataObject[]) ?? [];
						if (pairs.length) {
							body.custom_fields = pairs.reduce<IDataObject>((acc, f) => {
								if (f.key) acc[f.key as string] = f.value;
								return acc;
							}, {});
						}
						if (operation === 'upsert') {
							body.email = this.getNodeParameter('email', i) as string;
							response = await sendBeamApiRequest.call(this, 'POST', '/contacts', body);
						} else {
							const id = this.getNodeParameter('contactId', i) as string;
							response = await sendBeamApiRequest.call(this, 'PATCH', `/contacts/${id}`, body);
						}
					} else if (operation === 'get') {
						const id = this.getNodeParameter('contactId', i) as string;
						response = await sendBeamApiRequest.call(this, 'GET', `/contacts/${id}`);
					} else if (operation === 'delete') {
						const id = this.getNodeParameter('contactId', i) as string;
						response = await sendBeamApiRequest.call(this, 'DELETE', `/contacts/${id}`);
					} else if (operation === 'getAll') {
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						if (returnAll) {
							response = await sendBeamApiRequestAllItems.call(this, '/contacts', 'contacts');
						} else {
							const limit = this.getNodeParameter('limit', i) as number;
							const page = await sendBeamApiRequest.call(this, 'GET', '/contacts', {}, { limit });
							response = ((page?.contacts as IDataObject[]) ?? []).slice(0, limit);
						}
					}
				} else if (resource === 'email') {
					const body: IDataObject = {
						contact_id: this.getNodeParameter('contactId', i) as string,
						subject: this.getNodeParameter('subject', i) as string,
						html_content: this.getNodeParameter('htmlContent', i) as string,
						...(this.getNodeParameter('options', i) as IDataObject),
					};
					response = await sendBeamApiRequest.call(this, 'POST', '/send', body);
				} else if (resource === 'list') {
					if (operation === 'getAll') {
						response = await sendBeamApiRequestAllItems.call(this, '/lists', 'lists');
					} else {
						const listId = this.getNodeParameter('listId', i) as string;
						const contactId = this.getNodeParameter('contactId', i) as string;
						response =
							operation === 'add'
								? await sendBeamApiRequest.call(this, 'POST', `/lists/${listId}/contacts`, { contact_id: contactId })
								: await sendBeamApiRequest.call(this, 'DELETE', `/lists/${listId}/contacts`, { contact_id: contactId });
					}
				} else if (resource === 'tag') {
					if (operation === 'getAll') {
						response = await sendBeamApiRequestAllItems.call(this, '/tags', 'tags');
					} else {
						const tagId = this.getNodeParameter('tagId', i) as string;
						const contactId = this.getNodeParameter('contactId', i) as string;
						response =
							operation === 'add'
								? await sendBeamApiRequest.call(this, 'POST', `/contacts/${contactId}/tags`, { tag_id: tagId })
								: await sendBeamApiRequest.call(this, 'DELETE', `/contacts/${contactId}/tags/${tagId}`);
					}
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown resource: ${resource}`, { itemIndex: i });
				}

				const rows = Array.isArray(response) ? response : [response];
				out.push(
					...rows.map((json) => ({ json, pairedItem: { item: i } })),
				);
			} catch (error) {
				// Honour n8n's own convention: a failing item can be passed on
				// rather than stopping a run that is halfway through a list.
				if (this.continueOnFail()) {
					out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw error;
			}
		}

		return [out];
	}
}
