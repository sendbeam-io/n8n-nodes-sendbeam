import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	IDisplayOptions,
	INodeExecutionData,
	INodeListSearchResult,
	INodeProperties,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	findContactByEmail,
	getContactId,
	getListId,
	getResourceId,
	getTagId,
	isConflict,
	sendBeamApiRequest,
	sendBeamApiRequestAllItems,
	unwrapResource,
} from './GenericFunctions';

const UUID_REGEX = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const UUID_PLACEHOLDER = 'e.g. 0f8c6d2e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';

/**
 * The contact picker every contact operation shares. It defaults to "By Email"
 * because that is what a workflow almost always has from the step before.
 */
function contactLocator(resource: string, operation: string[]): INodeProperties {
	return {
		displayName: 'Contact',
		name: 'contact',
		type: 'resourceLocator',
		default: { mode: 'email', value: '' },
		required: true,
		displayOptions: { show: { resource: [resource], operation } },
		modes: [
			{
				displayName: 'By Email',
				name: 'email',
				type: 'string',
				placeholder: 'name@email.com',
				validation: [
					{
						type: 'regex',
						properties: { regex: '^\\S+@\\S+\\.\\S+$', errorMessage: 'Not a valid email address' },
					},
				],
			},
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchContacts', searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: UUID_PLACEHOLDER,
				validation: [
					{ type: 'regex', properties: { regex: UUID_REGEX, errorMessage: 'Not a valid contact ID' } },
				],
			},
		],
	};
}

/** A picker for things people choose by name: a searchable list, or an ID. */
function listOrIdLocator(
	displayName: string,
	name: string,
	searchListMethod: string,
	show: NonNullable<IDisplayOptions['show']>,
): INodeProperties {
	return {
		displayName,
		name,
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		displayOptions: { show },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod, searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: UUID_PLACEHOLDER,
				validation: [
					{ type: 'regex', properties: { regex: UUID_REGEX, errorMessage: `Not a valid ${name} ID` } },
				],
			},
		],
	};
}

function returnAllAndLimit(resource: string): INodeProperties[] {
	return [
		{
			displayName: 'Return All',
			name: 'returnAll',
			type: 'boolean',
			default: false,
			description: 'Whether to return all results or only up to a given limit',
			displayOptions: { show: { resource: [resource], operation: ['getAll'] } },
		},
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			default: 50,
			typeOptions: { minValue: 1 },
			description: 'Max number of results to return',
			displayOptions: { show: { resource: [resource], operation: ['getAll'], returnAll: [false] } },
		},
	];
}

const customFields: INodeProperties = {
	displayName: 'Custom Fields',
	name: 'customFieldsUi',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	placeholder: 'Add Custom Field',
	default: {},
	options: [
		{
			name: 'field',
			displayName: 'Field',
			values: [
				{ displayName: 'Key', name: 'key', type: 'string', default: '' },
				{ displayName: 'Value', name: 'value', type: 'string', default: '' },
			],
		},
	],
};

/**
 * What shows under the node on the canvas. n8n's stock pattern prints raw
 * values ("addToList: contact"); this says what the node does instead.
 */
const SUBTITLES: Record<string, Record<string, string>> = {
	contact: {
		addTag: 'Add tag to contact',
		addToList: 'Add contact to list',
		delete: 'Delete contact',
		get: 'Get contact',
		getAll: 'Get many contacts',
		removeFromList: 'Remove contact from list',
		removeTag: 'Remove tag from contact',
		unsubscribe: 'Unsubscribe contact',
		update: 'Update contact',
		upsert: 'Create or update contact',
	},
	automation: { getAll: 'Get many automations', start: 'Start automation for contact' },
	campaign: {
		create: 'Create campaign',
		delete: 'Delete campaign',
		duplicate: 'Duplicate campaign',
		get: 'Get campaign',
		getAll: 'Get many campaigns',
		getReport: 'Get campaign report',
		send: 'Send campaign',
	},
	email: { send: 'Send email to contact', sendTransactional: 'Send transactional email' },
	list: { create: 'Create list', getAll: 'Get many lists' },
	tag: { create: 'Create tag', getAll: 'Get many tags' },
};

const firstName: INodeProperties ={ displayName: 'First Name', name: 'first_name', type: 'string', default: '' };
const lastName: INodeProperties = { displayName: 'Last Name', name: 'last_name', type: 'string', default: '' };
const resubscribe: INodeProperties = {
	displayName: 'Resubscribe',
	name: 'resubscribe',
	type: 'boolean',
	default: false,
	description:
		'Whether to bring an unsubscribed contact back. Only turn this on when the person has given consent again — it overrides their earlier opt-out.',
};

export class SendBeam implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SendBeam',
		name: 'sendBeam',
		icon: 'file:sendbeam.svg',
		group: ['output'],
		version: 1,
		// n8n ends an expression at the first "}}", which a nested object literal
		// always contains, so the braces are spaced apart.
		subtitle: `={{ (${JSON.stringify(SUBTITLES).replace(/\}/g, ' }')})[$parameter["resource"]][$parameter["operation"]] }}`,
		description: 'Manage contacts, lists and tags, and send email with SendBeam',
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
					{ name: 'Automation', value: 'automation' },
					{ name: 'Campaign', value: 'campaign' },
					{ name: 'Contact', value: 'contact' },
					{ name: 'Email', value: 'email' },
					{ name: 'List', value: 'list' },
					{ name: 'Tag', value: 'tag' },
				],
				default: 'contact',
			},

			// ── Automation ───────────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['automation'] } },
				options: [
					{ name: 'Get Many', value: 'getAll', description: 'Get many automations', action: 'Get many automations' },
					{
						name: 'Start for Contact',
						value: 'start',
						description: 'Enrol a contact in an automation',
						action: 'Start an automation for a contact',
					},
				],
				default: 'start',
			},
			{
				displayName:
					'Only automations that are active and have an API trigger can be started from n8n. Add one to the automation in SendBeam first.',
				name: 'automationNotice',
				type: 'notice',
				default: '',
				displayOptions: { show: { resource: ['automation'], operation: ['start'] } },
			},
			listOrIdLocator('Automation', 'automation', 'searchAutomations', {
				resource: ['automation'],
				operation: ['start'],
			}),
			contactLocator('automation', ['start']),
			...returnAllAndLimit('automation'),
			{
				displayName: 'Filters',
				name: 'automationFilters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { resource: ['automation'], operation: ['getAll'] } },
				options: [
					{
						displayName: 'Status',
						name: 'status',
						type: 'options',
						default: 'active',
						options: [
							{ name: 'Active', value: 'active' },
							{ name: 'Draft', value: 'draft' },
							{ name: 'Paused', value: 'paused' },
						],
					},
				],
			},

			// ── Campaign ─────────────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['campaign'] } },
				options: [
					{ name: 'Create', value: 'create', description: 'Create a draft campaign', action: 'Create a campaign' },
					{ name: 'Delete', value: 'delete', description: 'Delete a campaign that was never sent', action: 'Delete a campaign' },
					{ name: 'Duplicate', value: 'duplicate', description: 'Copy a campaign as a new draft', action: 'Duplicate a campaign' },
					{ name: 'Get', value: 'get', description: 'Get a campaign and its stats', action: 'Get a campaign' },
					{ name: 'Get Many', value: 'getAll', description: 'Get many campaigns', action: 'Get many campaigns' },
					{
						name: 'Get Report',
						value: 'getReport',
						description: 'Get link clicks, email clients and devices for a campaign',
						action: 'Get a campaign report',
					},
					{ name: 'Send', value: 'send', description: 'Send a draft campaign now, or schedule it', action: 'Send a campaign' },
				],
				default: 'create',
			},
			listOrIdLocator('Campaign', 'campaign', 'searchCampaigns', {
				resource: ['campaign'],
				operation: ['delete', 'duplicate', 'get', 'getReport', 'send'],
			}),
			{
				displayName:
					'Without a Send At time, this sends to the campaign\'s whole audience as soon as the step runs',
				name: 'sendNotice',
				type: 'notice',
				default: '',
				displayOptions: { show: { resource: ['campaign'], operation: ['send'] } },
			},
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'e.g. September newsletter',
				description: 'For you to find it by. Recipients see the subject, not this.',
				displayOptions: { show: { resource: ['campaign'], operation: ['create'] } },
			},
			{
				displayName: 'Subject',
				name: 'subject',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['campaign'], operation: ['create'] } },
			},
			{
				displayName: 'From Email',
				name: 'fromEmail',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'news@example.com',
				description: "The workspace's own sender address, or one on a domain verified in SendBeam",
				displayOptions: { show: { resource: ['campaign'], operation: ['create'] } },
			},
			{
				displayName: 'Audience',
				name: 'sendTo',
				type: 'options',
				default: 'list',
				options: [
					{ name: 'All Subscribed Contacts', value: 'all' },
					{ name: 'List', value: 'list' },
					{ name: 'Segment', value: 'segment' },
				],
				displayOptions: { show: { resource: ['campaign'], operation: ['create'] } },
			},
			{
				displayName: 'List Name or ID',
				name: 'sendToList',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getLists' },
				default: '',
				required: true,
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				displayOptions: { show: { resource: ['campaign'], operation: ['create'], sendTo: ['list'] } },
			},
			{
				displayName: 'Segment Name or ID',
				name: 'sendToSegment',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getSegments' },
				default: '',
				required: true,
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				displayOptions: { show: { resource: ['campaign'], operation: ['create'], sendTo: ['segment'] } },
			},
			{
				displayName: 'HTML Content',
				name: 'htmlContent',
				type: 'string',
				typeOptions: { rows: 6 },
				default: '',
				required: true,
				displayOptions: { show: { resource: ['campaign'], operation: ['create'] } },
			},
			{
				displayName: 'Additional Fields',
				name: 'campaignFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['campaign'], operation: ['create'] } },
				options: [
					{ displayName: 'From Name', name: 'from_name', type: 'string', default: '' },
					{
						displayName: 'Text Content',
						name: 'text_content',
						type: 'string',
						typeOptions: { rows: 4 },
						default: '',
						description: 'Plain-text alternative',
					},
				],
			},
			{
				displayName: 'Options',
				name: 'sendOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['campaign'], operation: ['send'] } },
				options: [
					{
						displayName: 'Send At',
						name: 'scheduled_at',
						type: 'dateTime',
						default: '',
						description: 'Schedule the campaign for this time instead of sending it now',
					},
				],
			},
			{
				displayName: 'Options',
				name: 'duplicateOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['campaign'], operation: ['duplicate'] } },
				options: [
					{
						displayName: 'Only Non-Openers',
						name: 'nonOpeners',
						type: 'boolean',
						default: false,
						description:
							'Whether to aim the copy at the people who received the original and did not open it. Sent campaigns only.',
					},
				],
			},
			...returnAllAndLimit('campaign'),
			{
				displayName: 'Filters',
				name: 'campaignFilters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { resource: ['campaign'], operation: ['getAll'] } },
				options: [
					{
						displayName: 'Status',
						name: 'status',
						type: 'options',
						default: 'sent',
						options: [
							{ name: 'Cancelled', value: 'cancelled' },
							{ name: 'Draft', value: 'draft' },
							{ name: 'Scheduled', value: 'scheduled' },
							{ name: 'Sending', value: 'sending' },
							{ name: 'Sent', value: 'sent' },
						],
					},
				],
			},

			// ── Contact ──────────────────────────────────────────────────────
			// Everything you do *to a contact* lives here, including putting them
			// on a list or tagging them: that is where people look for it, and it
			// is how n8n groups actions in the node panel.
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['contact'] } },
				options: [
					{ name: 'Add Tag', value: 'addTag', description: 'Add a tag to a contact, creating the tag if needed', action: 'Add a tag to a contact' },
					{ name: 'Add to List', value: 'addToList', description: 'Put a contact on a list', action: 'Add a contact to a list' },
					{ name: 'Create or Update', value: 'upsert', description: 'Create a new record, or update the current one if it already exists (upsert)', action: 'Create or update a contact' },
					{ name: 'Delete', value: 'delete', description: 'Permanently delete a contact. Their address is suppressed, so it cannot be added back through the API.', action: 'Delete a contact' },
					{ name: 'Get', value: 'get', description: 'Get a contact and their tags', action: 'Get a contact' },
					{ name: 'Get Many', value: 'getAll', description: 'Get many contacts', action: 'Get many contacts' },
					{ name: 'Remove From List', value: 'removeFromList', description: 'Take a contact off a list', action: 'Remove a contact from a list' },
					{ name: 'Remove Tag', value: 'removeTag', description: 'Remove a tag from a contact', action: 'Remove a tag from a contact' },
					{ name: 'Unsubscribe', value: 'unsubscribe', description: 'Stop all marketing email to a contact', action: 'Unsubscribe a contact' },
					{ name: 'Update', value: 'update', description: "Change a contact's details", action: 'Update a contact' },
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
			contactLocator('contact', [
				'addTag',
				'addToList',
				'delete',
				'get',
				'removeFromList',
				'removeTag',
				'unsubscribe',
				'update',
			]),
			{
				displayName: 'List',
				name: 'list',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				displayOptions: { show: { resource: ['contact'], operation: ['addToList', 'removeFromList'] } },
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						typeOptions: { searchListMethod: 'searchLists', searchable: true },
					},
					{
						displayName: 'By ID',
						name: 'id',
						type: 'string',
						placeholder: UUID_PLACEHOLDER,
						validation: [
							{ type: 'regex', properties: { regex: UUID_REGEX, errorMessage: 'Not a valid list ID' } },
						],
					},
				],
			},
			{
				displayName: 'Tag',
				name: 'tag',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				displayOptions: { show: { resource: ['contact'], operation: ['addTag', 'removeTag'] } },
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						typeOptions: { searchListMethod: 'searchTags', searchable: true },
					},
					{
						displayName: 'By Name',
						name: 'name',
						type: 'string',
						placeholder: 'e.g. Customer',
						hint: 'When adding, a tag that does not exist yet is created',
					},
					{
						displayName: 'By ID',
						name: 'id',
						type: 'string',
						placeholder: UUID_PLACEHOLDER,
						validation: [
							{ type: 'regex', properties: { regex: UUID_REGEX, errorMessage: 'Not a valid tag ID' } },
						],
					},
				],
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['contact'], operation: ['upsert'] } },
				options: [
					customFields,
					firstName,
					lastName,
					{
						displayName: 'List Names or IDs',
						name: 'lists',
						type: 'multiOptions',
						typeOptions: { loadOptionsMethod: 'getLists' },
						default: [],
						description:
							'Lists to put the contact on. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
					resubscribe,
					{
						displayName: 'Source',
						name: 'source',
						type: 'string',
						default: '',
						placeholder: 'e.g. website',
						description: 'Where a new contact came from. Defaults to "api". Not changed on an existing contact.',
					},
					{
						displayName: 'Tag Names or IDs',
						name: 'tags',
						type: 'multiOptions',
						typeOptions: { loadOptionsMethod: 'getTags' },
						default: [],
						description:
							'Tags to add to the contact. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
				],
			},
			{
				displayName: 'Update Fields',
				name: 'updateFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['contact'], operation: ['update'] } },
				options: [
					{ ...customFields, description: 'Keys you set are changed; other custom fields are kept' },
					{ displayName: 'Email', name: 'email', type: 'string', placeholder: 'name@email.com', default: '' },
					firstName,
					lastName,
					resubscribe,
				],
			},
			...returnAllAndLimit('contact'),
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { resource: ['contact'], operation: ['getAll'] } },
				options: [
					{
						displayName: 'Search',
						name: 'q',
						type: 'string',
						default: '',
						description: 'Matches part of an email address, first name or last name',
					},
					{
						displayName: 'Status',
						name: 'status',
						type: 'options',
						default: 'subscribed',
						options: [
							{ name: 'Bounced', value: 'bounced' },
							{ name: 'Complained', value: 'complained' },
							{ name: 'Subscribed', value: 'subscribed' },
							{ name: 'Unsubscribed', value: 'unsubscribed' },
						],
					},
					{
						displayName: 'Tag Name or ID',
						name: 'tag',
						type: 'options',
						typeOptions: { loadOptionsMethod: 'getTags' },
						default: '',
						description:
							'Only contacts with this tag. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
				],
			},

			// ── Email ────────────────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['email'] } },
				options: [
					{
						name: 'Send to Contact',
						value: 'send',
						description: 'Send to a subscribed contact. Unsubscribed contacts are never mailed.',
						action: 'Send an email to a contact',
					},
					{
						name: 'Send Transactional',
						value: 'sendTransactional',
						description: 'Send a receipt, password reset or other site email to any address',
						action: 'Send a transactional email',
					},
				],
				default: 'send',
			},
			contactLocator('email', ['send']),
			{
				displayName: 'To',
				name: 'to',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'jane@example.com, Jo Bloggs <jo@example.com>',
				description: 'One or more addresses, separated by commas',
				displayOptions: { show: { resource: ['email'], operation: ['sendTransactional'] } },
			},
			{
				displayName: 'Subject',
				name: 'subject',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['email'] } },
			},
			{
				displayName: 'HTML Content',
				name: 'htmlContent',
				type: 'string',
				typeOptions: { rows: 6 },
				default: '',
				required: true,
				displayOptions: { show: { resource: ['email'] } },
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['email'], operation: ['send'] } },
				options: [
					{
						displayName: 'Text Content',
						name: 'text_content',
						type: 'string',
						typeOptions: { rows: 4 },
						default: '',
						description: 'Plain-text alternative. Worth sending: some clients and filters prefer it.',
					},
				],
			},
			{
				displayName: 'Options',
				name: 'transactionalOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['email'], operation: ['sendTransactional'] } },
				options: [
					{ displayName: 'BCC', name: 'bcc', type: 'string', default: '', description: 'Addresses separated by commas' },
					{ displayName: 'CC', name: 'cc', type: 'string', default: '', description: 'Addresses separated by commas' },
					{
						displayName: 'From Email',
						name: 'from_email',
						type: 'string',
						placeholder: 'orders@example.com',
						default: '',
						description: 'Used only when it is on a domain verified in this workspace; otherwise the workspace sender is used',
					},
					{ displayName: 'From Name', name: 'from_name', type: 'string', default: '' },
					{ displayName: 'Reply To', name: 'reply_to', type: 'string', placeholder: 'help@example.com', default: '' },
					{
						displayName: 'Text Content',
						name: 'text',
						type: 'string',
						typeOptions: { rows: 4 },
						default: '',
						description: 'Plain-text alternative',
					},
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
					{ name: 'Create', value: 'create', description: 'Create a list', action: 'Create a list' },
					{ name: 'Get Many', value: 'getAll', description: 'Get many lists', action: 'Get many lists' },
				],
				default: 'create',
			},
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['list', 'tag'], operation: ['create'] } },
			},
			{
				displayName: 'Additional Fields',
				name: 'listFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['list'], operation: ['create'] } },
				options: [
					{ displayName: 'Description', name: 'description', type: 'string', default: '' },
					{
						displayName: 'Double Opt-In',
						name: 'double_optin',
						type: 'boolean',
						default: false,
						description: 'Whether new members must confirm by email before campaigns reach them',
					},
				],
			},
			...returnAllAndLimit('list'),

			// ── Tag ──────────────────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['tag'] } },
				options: [
					{ name: 'Create', value: 'create', description: 'Create a tag', action: 'Create a tag' },
					{ name: 'Get Many', value: 'getAll', description: 'Get many tags', action: 'Get many tags' },
				],
				default: 'create',
			},
			{
				displayName: 'Additional Fields',
				name: 'tagFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['tag'], operation: ['create'] } },
				options: [{ displayName: 'Color', name: 'color', type: 'color', default: '#6B7280' }],
			},
			...returnAllAndLimit('tag'),
		],
	};

	methods = {
		loadOptions: {
			async getLists(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const lists = await sendBeamApiRequestAllItems.call(this, '/lists', 'lists');
				return lists.map((l) => ({ name: String(l.name ?? l.id), value: l.id as string }));
			},
			async getSegments(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const segments = await sendBeamApiRequestAllItems.call(this, '/segments', 'segments');
				return segments.map((s) => ({
					name: String(s.name ?? s.id),
					value: s.id as string,
					description: s.reachable_count !== undefined ? `${s.reachable_count} reachable contacts` : undefined,
				}));
			},
			async getTags(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const tags = await sendBeamApiRequestAllItems.call(this, '/tags', 'tags');
				return tags.map((t) => ({ name: String(t.name ?? t.id), value: t.id as string }));
			},
		},
		listSearch: {
			/**
			 * Only automations that can actually be started from outside: active,
			 * with an API trigger. Offering the rest would only lead to an error.
			 */
			async searchAutomations(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
				const automations = await sendBeamApiRequestAllItems.call(this, '/automations', 'automations', {
					status: 'active',
				});
				const startable = automations.filter(
					(a) =>
						a.trigger_type === 'api' ||
						((a.triggers as IDataObject[]) ?? []).some((t) => t.type === 'api' || t.trigger_type === 'api'),
				);
				return { results: byName(startable, filter) };
			},
			async searchCampaigns(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
				const campaigns = await sendBeamApiRequestAllItems.call(this, '/campaigns', 'campaigns');
				const needle = (filter ?? '').toLowerCase();
				return {
					results: campaigns
						.filter((c) => !needle || String(c.name).toLowerCase().includes(needle))
						.map((c) => ({ name: `${c.name} (${c.status})`, value: c.id as string })),
				};
			},
			async searchContacts(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			): Promise<INodeListSearchResult> {
				const page = Number(paginationToken) || 1;
				const qs: IDataObject = { page, limit: 50 };
				if (filter) qs.q = filter;
				const response = await sendBeamApiRequest.call(this, 'GET', '/contacts', {}, qs);
				const contacts = (response.contacts as IDataObject[]) ?? [];
				const totalPages = Number((response.pagination as IDataObject)?.total_pages ?? 1);
				return {
					results: contacts.map((c) => {
						const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
						return { name: name ? `${c.email} (${name})` : String(c.email), value: c.id as string };
					}),
					paginationToken: page < totalPages ? String(page + 1) : undefined,
				};
			},
			async searchLists(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
				const lists = await sendBeamApiRequestAllItems.call(this, '/lists', 'lists');
				return { results: byName(lists, filter) };
			},
			async searchTags(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
				const tags = await sendBeamApiRequestAllItems.call(this, '/tags', 'tags');
				return { results: byName(tags, filter) };
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
				let response: IDataObject | IDataObject[];

				if (resource === 'automation') {
					response = await automation.call(this, operation, i);
				} else if (resource === 'campaign') {
					response = await campaign.call(this, operation, i);
				} else if (resource === 'contact') {
					response = await contact.call(this, operation, i);
				} else if (resource === 'email') {
					response = await email.call(this, operation, i);
				} else if (resource === 'list' || resource === 'tag') {
					response = await listOrTag.call(this, resource, operation, i);
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown resource: ${resource}`, { itemIndex: i });
				}

				const rows = Array.isArray(response) ? response : [unwrapResource(response)];
				out.push(...rows.map((json) => ({ json, pairedItem: { item: i } })));
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

function byName(rows: IDataObject[], filter?: string) {
	const needle = (filter ?? '').toLowerCase();
	return rows
		.filter((r) => !needle || String(r.name).toLowerCase().includes(needle))
		.map((r) => ({ name: String(r.name), value: r.id as string }));
}

function splitAddresses(value: string): string[] {
	return value
		.split(',')
		.map((a) => a.trim())
		.filter(Boolean);
}

/** The contact fields the API accepts, with the empty ones n8n sends left out. */
function contactBody(fields: IDataObject): IDataObject {
	const body: IDataObject = {};
	for (const key of ['email', 'first_name', 'last_name', 'source']) {
		const value = fields[key];
		if (typeof value === 'string' && value.trim() !== '') body[key] = value.trim();
	}
	if (fields.resubscribe === true) body.resubscribe = true;

	const pairs = ((fields.customFieldsUi as IDataObject)?.field as IDataObject[]) ?? [];
	if (pairs.length) {
		body.custom_fields = pairs.reduce<IDataObject>((acc, f) => {
			if (f.key) acc[String(f.key)] = f.value;
			return acc;
		}, {});
	}
	return body;
}

/**
 * PATCH replaces `custom_fields` wholesale, so setting one key from a workflow
 * would silently wipe every other. Merge onto what the contact already has.
 */
function mergeCustomFields(body: IDataObject, existing: IDataObject) {
	if (!body.custom_fields) return;
	body.custom_fields = {
		...((existing.custom_fields as IDataObject) ?? {}),
		...(body.custom_fields as IDataObject),
	};
}

async function addTag(this: IExecuteFunctions, contactId: string, tagId: string): Promise<IDataObject> {
	try {
		return await sendBeamApiRequest.call(this, 'POST', `/contacts/${contactId}/tags`, { tag_id: tagId });
	} catch (error) {
		// Already tagged is the outcome the workflow asked for. Failing would
		// break every re-run of a workflow over the same people.
		if (isConflict(error)) return { contact_id: contactId, tag_id: tagId, already_tagged: true };
		throw error;
	}
}

async function addToList(this: IExecuteFunctions, contactId: string, listId: string): Promise<IDataObject> {
	try {
		return await sendBeamApiRequest.call(this, 'POST', `/lists/${listId}/contacts`, { contact_id: contactId });
	} catch (error) {
		if (isConflict(error)) {
			return { list_id: listId, contact_id: contactId, membership: 'confirmed', already_member: true };
		}
		throw error;
	}
}

async function contact(this: IExecuteFunctions, operation: string, i: number): Promise<IDataObject | IDataObject[]> {
	if (operation === 'upsert') {
		const address = (this.getNodeParameter('email', i) as string).trim();
		const fields = this.getNodeParameter('additionalFields', i) as IDataObject;
		const body = contactBody(fields);

		// POST /contacts only creates — an address that already exists is refused
		// — so "create or update" has to look first.
		const existing = await findContactByEmail.call(this, address);
		let result: IDataObject;
		if (existing) {
			delete body.source;
			if (body.resubscribe && existing.status !== 'unsubscribed') delete body.resubscribe;
			mergeCustomFields(body, existing);
			result = Object.keys(body).length
				? unwrapResource(await sendBeamApiRequest.call(this, 'PATCH', `/contacts/${existing.id}`, body))
				: existing;
		} else {
			result = unwrapResource(await sendBeamApiRequest.call(this, 'POST', '/contacts', { ...body, email: address }));
		}

		const contactId = result.id as string;
		for (const listId of (fields.lists as string[]) ?? []) await addToList.call(this, contactId, listId);
		for (const tagId of (fields.tags as string[]) ?? []) await addTag.call(this, contactId, tagId);
		return result;
	}

	if (operation === 'getAll') {
		const filters = this.getNodeParameter('filters', i) as IDataObject;
		const qs: IDataObject = {};
		for (const [key, value] of Object.entries(filters)) if (value !== '') qs[key] = value;
		if (this.getNodeParameter('returnAll', i)) {
			return await sendBeamApiRequestAllItems.call(this, '/contacts', 'contacts', qs);
		}
		const limit = this.getNodeParameter('limit', i) as number;
		if (limit > 100) {
			return (await sendBeamApiRequestAllItems.call(this, '/contacts', 'contacts', qs)).slice(0, limit);
		}
		const page = await sendBeamApiRequest.call(this, 'GET', '/contacts', {}, { ...qs, limit });
		return ((page.contacts as IDataObject[]) ?? []).slice(0, limit);
	}

	const contactId = await getContactId.call(this, i);

	switch (operation) {
		case 'get':
			return await sendBeamApiRequest.call(this, 'GET', `/contacts/${contactId}`);
		case 'delete':
			return await sendBeamApiRequest.call(this, 'DELETE', `/contacts/${contactId}`);
		case 'unsubscribe':
			return await sendBeamApiRequest.call(this, 'PATCH', `/contacts/${contactId}`, { status: 'unsubscribed' });
		case 'update': {
			const body = contactBody(this.getNodeParameter('updateFields', i) as IDataObject);
			if (!Object.keys(body).length) {
				throw new NodeOperationError(this.getNode(), 'Add at least one field to update', { itemIndex: i });
			}
			if (body.custom_fields) {
				mergeCustomFields(body, unwrapResource(await sendBeamApiRequest.call(this, 'GET', `/contacts/${contactId}`)));
			}
			return await sendBeamApiRequest.call(this, 'PATCH', `/contacts/${contactId}`, body);
		}
		case 'addToList':
			return await addToList.call(this, contactId, getListId.call(this, i));
		case 'removeFromList':
			return await sendBeamApiRequest.call(this, 'DELETE', `/lists/${getListId.call(this, i)}/contacts`, {
				contact_id: contactId,
			});
		case 'addTag':
			return await addTag.call(this, contactId, await getTagId.call(this, i, true));
		case 'removeTag':
			return await sendBeamApiRequest.call(
				this,
				'DELETE',
				`/contacts/${contactId}/tags/${await getTagId.call(this, i, false)}`,
			);
	}
	throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, { itemIndex: i });
}

async function email(this: IExecuteFunctions, operation: string, i: number): Promise<IDataObject> {
	const subject = this.getNodeParameter('subject', i) as string;
	const html = this.getNodeParameter('htmlContent', i) as string;

	if (operation === 'send') {
		const options = this.getNodeParameter('options', i) as IDataObject;
		return await sendBeamApiRequest.call(this, 'POST', '/send', {
			contact_id: await getContactId.call(this, i),
			subject,
			html_content: html,
			...(options.text_content ? { text_content: options.text_content } : {}),
		});
	}

	if (operation === 'sendTransactional') {
		const to = splitAddresses(this.getNodeParameter('to', i) as string);
		if (!to.length) throw new NodeOperationError(this.getNode(), 'Add at least one recipient', { itemIndex: i });
		const body: IDataObject = { to: to.length === 1 ? to[0] : to, subject, html };
		const options = this.getNodeParameter('transactionalOptions', i) as IDataObject;
		for (const [key, value] of Object.entries(options)) {
			if (typeof value !== 'string' || value.trim() === '') continue;
			body[key] = key === 'cc' || key === 'bcc' ? splitAddresses(value) : value.trim();
		}
		return await sendBeamApiRequest.call(this, 'POST', '/transactional', body);
	}

	throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, { itemIndex: i });
}

/** Leave out the empty values n8n sends for options nobody filled in. */
function nonEmpty(values: IDataObject): IDataObject {
	const out: IDataObject = {};
	for (const [key, value] of Object.entries(values ?? {})) {
		if (value !== '' && value !== undefined && value !== null) out[key] = value;
	}
	return out;
}

/**
 * "Return All" or "Limit" for a list endpoint. A limit that fits in one page is
 * one request; anything else pages through.
 */
async function getMany(
	this: IExecuteFunctions,
	path: string,
	collection: string,
	qs: IDataObject,
	i: number,
): Promise<IDataObject[]> {
	if (this.getNodeParameter('returnAll', i)) {
		return await sendBeamApiRequestAllItems.call(this, path, collection, qs);
	}
	const limit = this.getNodeParameter('limit', i) as number;
	if (limit > 100) {
		return (await sendBeamApiRequestAllItems.call(this, path, collection, qs)).slice(0, limit);
	}
	const page = await sendBeamApiRequest.call(this, 'GET', path, {}, { ...qs, limit });
	return ((page[collection] as IDataObject[]) ?? []).slice(0, limit);
}

/** Some endpoints answer with an empty body; a workflow still needs an item. */
function orSummary(response: unknown, summary: IDataObject): IDataObject {
	return response && typeof response === 'object' ? { ...summary, ...(response as IDataObject) } : summary;
}

async function automation(this: IExecuteFunctions, operation: string, i: number): Promise<IDataObject | IDataObject[]> {
	if (operation === 'getAll') {
		const filters = nonEmpty(this.getNodeParameter('automationFilters', i) as IDataObject);
		return await getMany.call(this, '/automations', 'automations', filters, i);
	}

	if (operation === 'start') {
		const automationId = getResourceId.call(this, 'automation', i);
		const locator = this.getNodeParameter('contact', i) as { mode: string; value: string };
		// The endpoint resolves an email itself, so "By Email" costs no lookup.
		const body: IDataObject =
			locator.mode === 'email' && String(locator.value ?? '').trim()
				? { email: String(locator.value).trim() }
				: { contact_id: await getContactId.call(this, i) };
		const response = await sendBeamApiRequest.call(this, 'POST', `/automations/${automationId}/trigger`, body);
		return orSummary(response, { automation_id: automationId, ...body, started: true });
	}

	throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, { itemIndex: i });
}

async function campaign(this: IExecuteFunctions, operation: string, i: number): Promise<IDataObject | IDataObject[]> {
	if (operation === 'create') {
		const sendTo = this.getNodeParameter('sendTo', i) as string;
		const body: IDataObject = {
			name: (this.getNodeParameter('name', i) as string).trim(),
			subject: this.getNodeParameter('subject', i) as string,
			from_email: (this.getNodeParameter('fromEmail', i) as string).trim(),
			html_content: this.getNodeParameter('htmlContent', i) as string,
			send_to_type: sendTo,
			...nonEmpty(this.getNodeParameter('campaignFields', i) as IDataObject),
		};
		if (sendTo === 'list') body.send_to_id = this.getNodeParameter('sendToList', i);
		if (sendTo === 'segment') body.send_to_id = this.getNodeParameter('sendToSegment', i);
		return await sendBeamApiRequest.call(this, 'POST', '/campaigns', body);
	}

	if (operation === 'getAll') {
		const filters = nonEmpty(this.getNodeParameter('campaignFilters', i) as IDataObject);
		return await getMany.call(this, '/campaigns', 'campaigns', filters, i);
	}

	const id = getResourceId.call(this, 'campaign', i);

	switch (operation) {
		case 'get':
			return await sendBeamApiRequest.call(this, 'GET', `/campaigns/${id}`);
		case 'getReport':
			return await sendBeamApiRequest.call(this, 'GET', `/campaigns/${id}/report`);
		case 'delete':
			return orSummary(await sendBeamApiRequest.call(this, 'DELETE', `/campaigns/${id}`), { id, deleted: true });
		case 'duplicate': {
			const options = this.getNodeParameter('duplicateOptions', i) as IDataObject;
			const body = options.nonOpeners ? { audience: 'non_openers' } : {};
			return await sendBeamApiRequest.call(this, 'POST', `/campaigns/${id}/duplicate`, body);
		}
		case 'send': {
			const { scheduled_at } = nonEmpty(this.getNodeParameter('sendOptions', i) as IDataObject);
			const body = scheduled_at ? { scheduled_at: new Date(scheduled_at as string).toISOString() } : {};
			const response = await sendBeamApiRequest.call(this, 'POST', `/campaigns/${id}/send`, body);
			return orSummary(response, { id, status: scheduled_at ? 'scheduled' : 'sending' });
		}
	}
	throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, { itemIndex: i });
}

async function listOrTag(
	this: IExecuteFunctions,
	resource: 'list' | 'tag',
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	const path = resource === 'list' ? '/lists' : '/tags';

	if (operation === 'create') {
		const extra = this.getNodeParameter(resource === 'list' ? 'listFields' : 'tagFields', i) as IDataObject;
		return await sendBeamApiRequest.call(this, 'POST', path, {
			...extra,
			name: (this.getNodeParameter('name', i) as string).trim(),
		});
	}

	if (operation === 'getAll') {
		const rows = await sendBeamApiRequestAllItems.call(this, path, resource === 'list' ? 'lists' : 'tags');
		if (this.getNodeParameter('returnAll', i)) return rows;
		return rows.slice(0, this.getNodeParameter('limit', i) as number);
	}

	throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, { itemIndex: i });
}
