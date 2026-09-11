# n8n-nodes-sendbeam

Use [SendBeam](https://sendbeam.io) from [n8n](https://n8n.io): keep contacts in
step with the rest of your stack, move people on and off lists, tag them, send
email, and start workflows from what happens in your SendBeam workspace.

SendBeam is a UK email platform for people who run several websites — each site
is a workspace with its own lists, forms and sending domain.

## Installation

In n8n, go to **Settings → Community nodes → Install** and enter
`n8n-nodes-sendbeam`, or follow the
[community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/).

## Credentials

Create an API key in SendBeam under **Settings → API Keys**, in the workspace
you want to connect, and give it the permissions the workflow needs:

| Permission | Needed for |
| --- | --- |
| `contacts:read` | The credential test, and finding contacts by email |
| `contacts:write` | Creating, updating, unsubscribing and deleting contacts |
| `lists:read` / `lists:write` | Choosing a list; adding and removing members; creating lists |
| `tags:read` / `tags:write` | Choosing a tag; adding and removing tags; creating tags |
| `campaigns:read` / `campaigns:write` | Finding and reporting on campaigns; creating, sending, duplicating and deleting them; sending email to a contact |
| `automations:read` / `automations:write` | Choosing an automation; starting one for a contact |
| `segments:read` | Choosing a segment as a campaign audience |
| `transactional:send` | Sending transactional email to any address |
| `webhooks:read` / `webhooks:write` | The trigger node, which sets up and removes its own endpoint |

## Operations

**SendBeam**

| Resource | Operations |
| --- | --- |
| Automation | Start for contact, Get many |
| Campaign | Create, Get, Get many, Get report, Send (now or scheduled), Duplicate (optionally to non-openers), Delete |
| Contact | Create or update, Get, Get many, Update, Unsubscribe, Delete, Add to list, Remove from list, Add tag, Remove tag |
| Email | Send to contact, Send transactional |
| List | Create, Get many |
| Tag | Create, Get many |

Contacts are picked **by email** by default — the address a workflow already
has — or from a searchable list, or by ID. Tags can be picked by name, and
adding a tag that does not exist yet creates it. Adding a tag or list
membership a contact already has succeeds, so a workflow can be re-run safely.

**Start for contact** works on active automations that have an API trigger in
SendBeam, for contacts who are subscribed and not already in that automation.

**Send to contact** only mails subscribed contacts, so consent and unsubscribe
state are always honoured. **Send transactional** is for mail a person asked
for — receipts, password resets, booking reminders. It goes to any address,
including people who unsubscribed from marketing, but not to addresses that
bounced or marked mail as spam.

**SendBeam Trigger** starts a workflow on any of 21 events, such as Contact
Created, Contact Unsubscribed, Form Submitted, Email Clicked and Campaign Sent.
Publishing the workflow sets up a webhook endpoint in SendBeam; unpublishing it
removes it again. SendBeam sends events to n8n's webhook address over `https://`,
so an n8n running on your own computer needs its `WEBHOOK_URL` pointed at a
tunnel.

## Example workflows

**Add new customers to a list.** A Stripe Trigger (or Shopify, or a form tool)
fires when someone buys → **SendBeam: Contact → Create or update**, with the
email and name mapped from the trigger → **SendBeam: Contact → Add to list**,
picking the list by name. Re-running it for an existing customer changes
nothing, so retries are safe.

**Tag people by what they did.** A Typeform or Tally trigger → **SendBeam:
Contact → Add tag**, with the contact picked by the email from the form and the
tag typed as a name, such as `webinar-2026`. The tag is created the first time
it is used.

**Start an onboarding sequence from your app.** Your app calls an n8n Webhook
node when someone signs up → **SendBeam: Contact → Create or update** →
**SendBeam: Automation → Start for contact**, choosing an active automation
whose trigger is set to API in SendBeam.

**Tell your team about unsubscribes and bounces.** **SendBeam Trigger** with the
events Contact Unsubscribed and Contact Bounced → a Slack or email node that
posts `{{ $json.data.contact.email }}` and `{{ $json.event }}`. Every event
carries `event`, `created_at` and a `data` object; contact events put the
contact under `data.contact`.

**Send a receipt.** An order webhook → **SendBeam: Email → Send transactional**,
with the customer's email in To and the order details in the HTML.

## Compatibility

Tested against n8n 2.38.

Requires **Node.js 24 or later** — that is n8n's own floor, not ours. On Node 22
n8n refuses to start with `Your Node.js version … is currently not supported by n8n`,
which is easy to mistake for a problem with the node.

## Development

```
npm install
npm test
```

`npm test` builds the node and runs every action and the trigger against a
stand-in for n8n, then checks each request against SendBeam's published API
description at https://sendbeam.io/openapi.json, so it needs network access.
It runs on every push, and a release is not published unless it passes.

## Resources

* [SendBeam API reference](https://sendbeam.io/docs/api)
* [SendBeam webhooks](https://sendbeam.io/docs/api/webhooks)
* [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)

## Licence

[MIT](LICENSE)
