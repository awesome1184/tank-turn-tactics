# Deployment guide

The game has two separately hosted pieces:

- **Web client:** GitHub Pages at https://awesome1184.github.io/tank-turn-tactics/
- **Multiplayer API:** Cloudflare Worker named `tank-turn-tactics-api`, with one SQLite-backed Durable Object per room.

The repository already contains the Worker configuration and GitHub Actions workflow. You do not need to create a Durable Object namespace by hand; the first Wrangler deployment registers the `GameRoom` class from `apps/worker/wrangler.jsonc`.

## 1. Create a Cloudflare account

Go to https://dash.cloudflare.com/ and create or sign in to your account.

Open **Workers & Pages** and make sure your account's `workers.dev` subdomain is enabled. This project uses the standard Worker URL; it does not require you to buy a domain or configure DNS.

## 2. Create a Cloudflare API token

In Cloudflare, open **Manage Account → Account API tokens** (or **My Profile → API Tokens**, depending on the dashboard entry point), then:

1. Choose **Create Token**, then use **Custom** under Permission policies.
2. For the first deployment, grant the **Workers → Admin** role at the Workers product scope for the one account where the game will run. Cloudflare requires product-level Admin to create a Worker that does not exist yet.
3. Create the token and copy it immediately.
4. After the first deployment creates the Worker, you can replace this with a narrower token scoped to the individual `tank-turn-tactics-api` Worker with the **Editor** role. Update the GitHub secret with the replacement token.

Keep this token private. Do not paste it into source files, chat, or the GitHub repository itself. Cloudflare's GitHub Actions guide recommends storing it as a CI/CD secret.

Cloudflare's current role model distinguishes creating a Worker from updating one: a new Worker requires Workers product-level **Admin**; deploying an existing Worker requires **Editor** access to that Worker. This lets you reduce the token's scope after the initial deploy.

## 3. Copy your Cloudflare Account ID

In the Cloudflare dashboard, open **Workers & Pages** and copy **Account ID** from **Account Details**. You can also use the dashboard's global search for **Copy account ID**.

## 4. Add the credentials to GitHub

Open the repository:

https://github.com/awesome1184/tank-turn-tactics/settings/secrets/actions

Under **Secrets → Actions**, create these two repository secrets:

| Name | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | The API token you just created |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare Account ID |

Do not put either value in a normal repository variable or commit it into a file.

## 5. Deploy the multiplayer Worker

In GitHub, open **Actions → Deploy server → Run workflow** and run it on `main`.

The workflow installs the project dependencies and runs `wrangler deploy` using those two secrets. The Wrangler configuration creates or updates:

- Worker: `tank-turn-tactics-api`
- Durable Object binding: `ROOMS`
- Durable Object class: `GameRoom`
- SQLite migration: `v1`

When the deployment completes, open **Cloudflare → Workers & Pages → tank-turn-tactics-api** and copy its `workers.dev` URL. It will look like:

```text
https://tank-turn-tactics-api.<your-workers-subdomain>.workers.dev
```

Test it by opening:

```text
https://tank-turn-tactics-api.<your-workers-subdomain>.workers.dev/api/health
```

A successful response looks like:

```json
{"ok":true,"service":"tank-turn-tactics-api"}
```

## 6. Connect GitHub Pages to the Worker

Return to the repository's **Settings → Secrets and variables → Actions → Variables** page:

https://github.com/awesome1184/tank-turn-tactics/settings/variables/actions

Create this repository variable:

| Name | Value |
| --- | --- |
| `VITE_API_BASE` | The complete Worker URL, with no trailing slash |

For example, use `https://tank-turn-tactics-api.example.workers.dev` — replace `example` with your actual workers.dev subdomain.

This is a public URL, not a secret; the web client needs it at build time.

Then open **Actions → Deploy web client → Run workflow** and run it on `main`. This rebuilds the browser client with the Worker URL embedded. Refresh the game page after the Pages deployment succeeds.

## 7. Free plan and capacity notes

The Worker is configured to use SQLite-backed Durable Objects, which Cloudflare supports on Workers Free and Paid plans. Current Free-plan Durable Object allowances include 100,000 requests and 13,000 GB-seconds of compute duration per day; incoming WebSocket messages use a 20:1 request-billing ratio, while outgoing WebSocket messages are not billed as requests. Limits reset daily, and operations of a type can fail after that type's free allowance is exceeded. Keep an eye on usage during larger playtests.

For small playtests, start on the Free plan and watch the Worker and Durable Object metrics in Cloudflare. Upgrade only if the game's actual usage needs it. See Cloudflare's [Durable Objects pricing documentation](https://developers.cloudflare.com/durable-objects/platform/pricing/).

## Troubleshooting

- **Missing credentials:** check that both GitHub repository secrets are spelled exactly as shown.
- **Permission denied during first deployment:** the token needs permission to create the first Worker; see the first-deployment note above.
- **Worker deploys but the game says the server URL is not configured:** add the `VITE_API_BASE` repository variable and rerun **Deploy web client**.
- **Health check fails:** confirm the Worker deployment succeeded and that you copied the exact `workers.dev` URL, without `/api/health` or a trailing slash, into `VITE_API_BASE`.
