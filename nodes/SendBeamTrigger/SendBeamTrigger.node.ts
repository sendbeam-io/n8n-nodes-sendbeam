import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { sendBeamApiRequest } from '../SendBeam/GenericFunctions';

/**
 * Every event SendBeam can deliver, named the way people describe them rather
 * than by their wire names. The value stays the wire name so an exported
 * workflow still reads plainly.
 */
const EVENTS = [
	{ name: 'Campaign Sent', value: 'campaign.sent', description: 'A campaign was sent' },
	{ name: 'Contact Bounced', value: 'contact.bounced', description: "A contact's address bounced" },
	{ name: 'Contact Complained', value: 'contact.complained', description: 'A contact reported an email as spam' },
	{ name: 'Contact Created', value: 'contact.created', description: 'A contact was added' },
	{ name: 'Contact Deleted', value: 'contact.deleted', description: 'A contact was deleted' },
	{ name: 'Contact Joined List', value: 'contact.list_joined', description: 'A contact joined a list' },
	{ name: 'Contact Left List', value: 'contact.list_left', description: 'A contact left a list' },
	{ name: 'Contact Resubscribed', value: 'contact.resubscribed', description: 'An unsubscribed contact subscribed again' },
	{ name: 'Contact Tag Added', value: 'contact.tag_added', description: 'A tag was added to a contact' },
	{ name: 'Contact Tag Removed', value: 'contact.tag_removed', description: 'A tag was removed from a contact' },
	{ name: 'Contact Unsubscribed', value: 'contact.unsubscribed', description: 'A contact unsubscribed' },
	{ name: 'Contact Updated', value: 'contact.updated', description: "A contact's details changed" },
	{ name: 'Domain Failed', value: 'domain.failed', description: 'A sending domain failed verification' },
	{ name: 'Domain Verified', value: 'domain.verified', description: 'A sending domain was verified' },
	{ name: 'Email Bounced', value: 'email.bounced', description: 'An email bounced' },
	{ name: 'Email Clicked', value: 'email.clicked', description: 'A link in an email was clicked' },
	{ name: 'Email Complained', value: 'email.complained', description: 'An email was reported as spam' },
	{ name: 'Email Delivered', value: 'email.delivered', description: 'An email was delivered' },
	{ name: 'Email Opened', value: 'email.opened', description: 'An email was opened' },
	{ name: 'Email Sent', value: 'email.sent', description: 'An email was sent' },
	{ name: 'Form Submitted', value: 'form.submitted', description: 'A form was submitted' },
];

/**
 * SendBeam only delivers to a public https address and refuses anything else.
 * n8n's default webhook URL on a laptop is http://localhost:5678, so this is the
 * first thing almost everyone trying the trigger locally runs into.
 */
function isDeliverable(url: string): boolean {
	if (!url.startsWith('https://')) return false;
	const host = new URL(url).hostname;
	return !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[::1\])/.test(host);
}

export class SendBeamTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SendBeam Trigger',
		name: 'sendBeamTrigger',
		icon: 'file:sendbeam.svg',
		group: ['trigger'],
		version: 1,
		description: 'Starts a workflow when something happens in SendBeam',
		usableAsTool: true,
		defaults: { name: 'SendBeam Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'sendBeamApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'SendBeam can only reach n8n on a public https address. On your own computer, set n8n\'s WEBHOOK_URL to a tunnel address before activating this workflow.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: [],
				description: 'The SendBeam events that start this workflow',
				options: EVENTS,
			},
		],
	};

	webhookMethods = {
		default: {
			/**
			 * n8n asks this before creating. Matching on the URL rather than on a
			 * stored ID means a workflow that was duplicated, or restored from an
			 * export, does not register a second endpoint delivering the same
			 * events twice.
			 */
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default');
				const response = await sendBeamApiRequest.call(this, 'GET', '/webhooks');
				const existing = ((response?.webhooks as IDataObject[]) ?? []).find(
					(w) => w.url === webhookUrl,
				);
				if (!existing) return false;
				this.getWorkflowStaticData('node').webhookId = existing.id;
				return true;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				if (!isDeliverable(webhookUrl)) {
					throw new NodeOperationError(
						this.getNode(),
						'SendBeam cannot reach this n8n instance',
						{
							description: `The webhook address is ${webhookUrl}. SendBeam only delivers to a public https address. Start a tunnel (for example cloudflared or ngrok), set n8n's WEBHOOK_URL to its https address, restart n8n and activate the workflow again.`,
						},
					);
				}
				const events = this.getNodeParameter('events') as string[];
				const response = await sendBeamApiRequest.call(this, 'POST', '/webhooks', {
					url: webhookUrl,
					event_types: events,
					description: `n8n: ${this.getWorkflow().name ?? 'workflow'}`,
				});
				const created = (response?.webhook as IDataObject) ?? response;
				this.getWorkflowStaticData('node').webhookId = created?.id;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node');
				if (!data.webhookId) return true;
				try {
					await sendBeamApiRequest.call(this, 'DELETE', `/webhooks/${data.webhookId}`);
				} catch {
					// Already gone, or the key lost access. Either way the endpoint
					// is not ours to worry about any more, and throwing here would
					// leave the node stuck in a state it cannot be deactivated from.
				}
				delete data.webhookId;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		// SendBeam delivers { id, event, created_at, data }. The event is passed
		// through whole rather than unwrapped: a workflow branching on `event`
		// needs it, and unwrapping would lose the delivery id that makes a run
		// traceable back to a webhook delivery in SendBeam.
		const body = this.getBodyData() as IDataObject;
		return { workflowData: [this.helpers.returnJsonArray([body])] };
	}
}
