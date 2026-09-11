# Contributing

Thanks for looking. This is the official SendBeam node for n8n: one node with the actions a workflow needs,
and a trigger for SendBeam's events. Changes that keep it focused are much easier to accept than changes that
grow it.

## Before you start

For anything beyond a typo, **open an issue first**. It is a short conversation and it saves you writing
something we then ask you to change. If you are not sure whether an idea fits, ask — the answer is often yes
with a different shape.

Questions about SendBeam itself — your account, plans, the API, deliverability — are better at
<https://sendbeam.io/contact> than in this repository.

## Reporting a bug

Use the **Bug report** template. The version fields matter: most reports turn out to depend on the n8n
version, how n8n is run, or the permissions on the API key. Include them and we can usually reproduce it the
same day.

Never paste an API key into an issue, a log or a screenshot. If one slips through, delete the key in SendBeam
under **Settings → API Keys** and create a new one.

If it is exploitable, do not open an issue — see [SECURITY.md](SECURITY.md).

## Working on a change

You need Node.js 24 or later, the same as n8n itself.

```bash
npm install
npm run lint      # n8n's own rules for community nodes
npm test          # builds, runs every action and the trigger, and checks requests against SendBeam's API
npm run dev       # starts n8n with the node loaded, to try a change by hand
```

`npm test` runs the node against a stand-in for n8n in `test/harness.js`, so it needs no n8n install and no
SendBeam account. It does need network access: `test/contract.test.js` checks every request against the
published API description at <https://sendbeam.io/openapi.json>. A new action without a scenario there fails
the suite on purpose.

CI runs lint and the tests on every push and pull request, and both must pass before anything is merged or
published.

## House style

- **No runtime dependencies.** n8n only verifies community nodes that have none, so requests go through n8n's
  own request helper.
- Errors are shown in SendBeam's own words wherever SendBeam gives some, not n8n's generic message.
- Names and descriptions in the node panel follow n8n's conventions — `npm run lint` checks most of them.
- Comments explain *why*, not what. If the reason a line exists is not obvious in six months, write it down;
  if it is obvious, do not.
- Match the surrounding code rather than your own preferences.

## Pull requests

One change per pull request. Fill in the template; the checklist is short.

Keep the history readable: a clear subject line in the imperative, and a body that says what was wrong rather
than what you typed. Maintainers squash on merge, so the pull request title becomes the commit.

## Releases

Maintainers publish a release on GitHub, and the **Publish** workflow puts it on npm with a provenance
statement. Nothing is published from a developer's machine.

## Licence

By contributing you agree that your work is licensed under the [MIT licence](LICENSE).
