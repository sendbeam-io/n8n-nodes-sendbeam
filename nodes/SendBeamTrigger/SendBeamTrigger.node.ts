import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { sendBeamApiRequest } from '../SendBeam/GenericFunctions';

/**
 * Every event SendBeam can deliver. Kept in the order the API documents them
 * so the dropdown reads as contact lifecycle, then delivery, then account.
 */
const EVENTS = [
	'contact.created',
	'contact.updated',
	'contact.unsubscribed',
	'contact.resubscribed',
	'contact.bounced',
	'contact.complained',
	'contact.deleted',
	'contact.tag_added',
	'contact.tag_removed',
	'contact.list_joined',
	'contact.list_left',
	'email.sent',
	'email.delivered',
	'email.opened',
	'email.clicked',
	'email.bounced',
	'email.complained',
	'campaign.sent',
	'form.submitted',
	'domain.verified',
	'domain.failed',
] as const;

export class SendBeamTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SendBeam Trigger',
		name: 'sendBeamTrigger',
		icon: 'file:../SendBeam/sendbeam.svg',
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
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: [],
				description: 'The SendBeam events that start this workflow',
				options: EVENTS.map((value) => ({ name: value, value })),
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
				const webhookUrl = this.getNodeWebhookUrl('default');
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
