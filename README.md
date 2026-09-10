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
| `contacts:read` | The credential test, and every contact lookup |
| `contacts:write` | Creating, updating, deleting contacts; adding and removing tags |
| `lists:read` / `lists:write` | The list dropdown; adding and removing members |
| `tags:read` / `tags:write` | The tag dropdown; adding and removing tags |
| `campaigns:write` | Sending email |
| `webhooks:write` | The trigger node, which registers its own endpoint |

Reads are unmetered on every plan. Writes are metered per hour per workspace —
120 on Free, 600 on Starter, unlimited on Pro and Business — and answer `429`
with a `Retry-After` when the hour is spent, rather than failing permanently.

## Operations

**SendBeam**

| Resource | Operations |
| --- | --- |
| Contact | Create or update, Get, Get many, Update, Delete |
| Email | Send to a contact |
| List | Add contact, Remove contact, Get many |
| Tag | Add to contact, Remove from contact, Get many |

Email is sent to a *contact*, not to a raw address, so consent and unsubscribe
state are always honoured — an unsubscribed contact cannot be mailed by
accident from a workflow.

**SendBeam Trigger** starts a workflow on any of 21 events, including
`contact.created`, `contact.unsubscribed`, `contact.tag_added`,
`form.submitted`, `email.bounced`, `email.clicked` and `campaign.sent`.
Activating the node registers a webhook endpoint in SendBeam; deactivating it
removes it again.

## Compatibility

Tested against n8n 1.x. Requires Node.js 20.19 or later.

## Resources

* [SendBeam API reference](https://sendbeam.io/docs/api)
* [SendBeam webhooks](https://sendbeam.io/docs/webhooks)
* [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)

## Licence

[MIT](LICENSE)
