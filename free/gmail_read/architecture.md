# Gmail — Read setup

Read-only Gmail access via Google OAuth. Uses the `gmail.readonly` scope so the skill physically cannot send mail or modify your mailbox.

## What you need

1. A Google Cloud project (free)
2. A Google OAuth 2.0 Client ID + secret (one client serves the whole Workspace skill family — Gmail Read, Gmail Send, future Calendar/Drive skills)
3. A refresh token scoped to `gmail.readonly`

## One-time Google Cloud setup (~5 minutes)

Skip this section if you already have a Google OAuth client for Hearth.

1. **Open the Cloud Console** at https://console.cloud.google.com
2. **Create a project** (top-left dropdown → New Project). Name it something like `hearth-workspace`. You can reuse a project you already have.
3. **Enable the Gmail API**:
   - APIs & Services → Library
   - Search "Gmail API" → click → Enable
4. **Configure the OAuth consent screen** (only required the first time):
   - APIs & Services → OAuth consent screen
   - User type: **External** (unless you're in a Workspace org and want Internal)
   - App name: `Hearth` (or whatever you like)
   - User support email + Developer contact email: your address
   - Save and continue through the scope screen (no scopes needed here — we add them in the playground)
   - **Add yourself as a Test user** so you can authorize without publishing the app
5. **Create the OAuth Client ID**:
   - APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: **Web application**
   - Name: `Hearth`
   - **Authorized redirect URIs**: add `https://developers.google.com/oauthplayground`
   - Create → copy the **Client ID** and **Client secret** somewhere safe

Paste those two values into the **Google OAuth client ID** and **Google OAuth client secret** fields in the gear panel.

## Getting the refresh token (per-skill, ~2 minutes)

The refresh token is scoped — this skill gets a read-only token; Gmail Send gets a separate send-only token. Minimum-privilege isolation.

1. Open https://developers.google.com/oauthplayground
2. **Click the gear icon** (top right) → check **"Use your own OAuth credentials"** → paste your Client ID + Client secret → Close
3. **Step 1 — Select & authorize APIs**:
   - Scroll the API list, find **Gmail API v1**
   - Tick **only** `https://www.googleapis.com/auth/gmail.readonly`
   - Do NOT select any other scopes
   - Click **Authorize APIs**
4. Sign in with the Google account whose mailbox you want this skill to read. Accept the consent screen (it will warn that "Hearth hasn't been verified" — that's normal for unpublished apps; click "Continue").
5. Back in the playground, **Step 2 — Exchange authorization code for tokens**:
   - Click **Exchange authorization code for tokens**
   - You'll see an `access_token` (short-lived, ignored) and a **`refresh_token`** (long-lived — this is what you want)
6. Copy the **refresh_token** value into the **Gmail read refresh token** field in the gear panel → Save configuration

## What the skill can do

Three actions, dispatched by `args.action`:

| Action | What it does | Args |
|---|---|---|
| `search` (default) | Search messages with Gmail's query syntax | `query` (string, e.g. `from:newsletter is:unread`), `max_results` (1-100, default 25) |
| `get` | Read one message by ID | `id` (from search results), `format` (`full` / `metadata` / `raw`, default `full`) |
| `labels` | List your Gmail labels | none |

## Security notes

- The refresh token is encrypted in your vault. It never leaves your machine except when exchanged for an access token at `oauth2.googleapis.com`.
- The `gmail.readonly` scope is enforced by Google's servers, not by this skill. Even if a hostile party stole this token, they could not send mail with it.
- Revoke the token any time at https://myaccount.google.com/permissions
