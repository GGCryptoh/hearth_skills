# Google Calendar — architecture & one-time OAuth setup

This skill reads and creates events on your Google Calendar through Google's
official Calendar API v3, authenticated with an OAuth **refresh token** you
generate once. No password is ever stored — only a scoped refresh token that
can be revoked at any time from your Google account.

## Scopes

This skill requests the minimum it needs:

- `https://www.googleapis.com/auth/calendar.readonly` — read events (`list`)
- `https://www.googleapis.com/auth/calendar.events` — create events (`create`)

It cannot read your mail, files, or contacts, and it cannot delete your
calendar. To also allow deleting events you would need a broader scope — this
skill deliberately does not request it.

## Token flow

```
refresh_token (in vault, long-lived)
      │
      ▼  POST oauth2.googleapis.com/token  (grant_type=refresh_token)
access_token (short-lived, ~1h, never stored)
      │
      ▼  Authorization: Bearer <access_token>
Google Calendar API v3
```

We exchange the refresh token for a fresh access token on every call. This is
cheaper than caching (no rotation logic, no stale-token bugs) and the refresh
endpoint is fast (~150 ms).

## One-time setup (≈ 5 minutes)

### 1. Create an OAuth client in Google Cloud Console

1. Go to <https://console.cloud.google.com> → create (or pick) a project.
2. **APIs & Services → Library** → search **Google Calendar API** → **Enable**.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - If prompted, configure the OAuth consent screen (External is fine; add
     yourself as a test user).
   - Application type: **Web application**.
   - Under **Authorized redirect URIs** add exactly:
     `https://developers.google.com/oauthplayground`
4. Copy the **Client ID** and **Client secret**.

Paste both into this skill's gear panel:
`GCAL_OAUTH_CLIENT_ID` and `GCAL_OAUTH_CLIENT_SECRET`.

### 2. Mint a refresh token via the OAuth Playground

1. Open <https://developers.google.com/oauthplayground>.
2. Click the **gear icon** (top-right) → tick **Use your own OAuth
   credentials** → paste your Client ID + Client secret.
3. **Step 1** — in the scope list find **Calendar API v3** and tick BOTH:
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.readonly`
4. Click **Authorize APIs**, sign in, accept the consent screen.
5. **Step 2** — click **Exchange authorization code for tokens**.
6. Copy the **Refresh token** value.

Paste it into the gear panel as `GCAL_OAUTH_REFRESH_TOKEN`. Done.

## Usage

- **List:** `action='list'`, optional `days_ahead` (default 7) and
  `calendar_id` (default `primary`).
- **Create:** `action='create'` with `summary`, `start_iso`, `end_iso`
  (RFC3339 with an offset, e.g. `2026-07-15T15:00:00-04:00`), optional
  `description` and `attendees` (a single email or an array). When attendees
  are supplied the skill sets `sendUpdates=all` so Google emails the invites.

## Revoking access

Visit <https://myaccount.google.com/permissions>, find the app, and click
**Remove access**. The refresh token dies immediately; re-run step 2 to mint a
new one.
