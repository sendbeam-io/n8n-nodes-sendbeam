# n8n-nodes-sendbeam

Use [SendBeam](https://sendbeam.io) from [n8n](https://n8n.io): keep contacts in
step with the rest of your stack, move people on and off lists, tag them, send
email, and start workflows from what happens in your SendBeam workspace.

SendBeam is a UK email platform for people who run several websites — each site
is a workspace with its own lists, forms and sending domain.

## Installation

Follow the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/)
and install `n8n-nodes-sendbeam`.

## Credentials

You need a SendBeam API key: **Settings → API Keys** inside the workspace you
want to connect. A key belongs to one workspace and carries that workspace's
permissions, so only workspace admins can create one. Give it only the
permissions the workflow needs:

| Scope | Needed for |
| --- | --- |
| `contacts:read` | The credential test, and finding contacts by email |
| `contacts:write` | Creating, updating, unsubscribing and deleting contacts |
| `lists:read` / `lists:write` | Choosing a list; adding and removing members; creating lists |
| `tags:read` / `tags:write` | Choosing a tag; adding and removing tags; creating tags |
| `campaigns:read` / `campaigns:write` | Finding and reporting on campaigns; creating, sending, duplicating and deleting them; sending email to a contact |
| `automations:read` / `automations:write` | Choosing an automation; starting one for a contact |
| `segments:read` | Choosing a segment as a campaign audience |
| `transactional:send` | Sending transactional email to any address |
| `webhooks:write` | The trigger node, which registers its own endpoint |

Reads are never metered. Writes are metered per hour per workspace, and a
spent allowance answers `429` with a `Retry-After` rather than failing
permanently.

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

**Start for contact** works on automations that are active and have an API
trigger in SendBeam, so the automation's author decides whether outside tools
may enrol people.

**Send to contact** only mails subscribed contacts, so consent and unsubscribe
state are always honoured. **Send transactional** is for mail a person asked
for — receipts, password resets, booking reminders — and goes to any address.

**SendBeam Trigger** starts a workflow on any of 21 events, such as Contact
Created, Contact Unsubscribed, Form Submitted, Email Clicked and Campaign Sent.
Activating the workflow registers a webhook endpoint in SendBeam; deactivating
it removes it again. SendBeam only delivers to a public `https://` address, so
an n8n running on your own computer needs its `WEBHOOK_URL` pointed at a tunnel.

## Compatibility

Tested against n8n 2.38.

Requires **Node.js 24 or later** — that is n8n's own floor, not ours. On Node 22
n8n refuses to start with `Your Node.js version is currently not supported`,
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
* [SendBeam webhooks](https://sendbeam.io/docs/webhooks)
* [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)

## Licence

[MIT](LICENSE)
