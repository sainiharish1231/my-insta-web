# Instagram keyword Auto DM setup

The app's Auto DM responds to an incoming Instagram message when its text matches an enabled keyword rule. It ignores messages sent by the business itself, records webhook message IDs to avoid duplicate replies, and stores Page access tokens encrypted in MongoDB.

## Environment values

Set these on the server and in Vercel Production:

- `MONGODB_URI`
- `SCHEDULED_POSTS_ENCRYPTION_KEY` (the same stable 32-byte base64 key used by the Reel scheduler)
- `FACEBOOK_APP_SECRET` (Meta App Dashboard → App settings → Basic)
- `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` (a long random string you create; enter the exact same value in Meta)
- `NEXT_PUBLIC_FACEBOOK_APP_ID` (already used by Instagram login)

Do not expose `FACEBOOK_APP_SECRET` or `SCHEDULED_POSTS_ENCRYPTION_KEY` with a `NEXT_PUBLIC_` prefix. Do not commit real secrets.

## Meta Developer setup

1. In Meta App Dashboard, add the Messenger product and enable Instagram Messaging for the app.
2. Configure Webhooks for the Instagram object. Use `https://YOUR_PUBLIC_DOMAIN/api/instagram/webhook` as the callback URL and the exact `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` as the verify token. Subscribe to the `messages` field (and `messaging_postbacks` if using button replies later).
3. In Facebook Login permissions, request `instagram_manage_messages`, `pages_manage_metadata`, and `pages_messaging`, alongside the existing Instagram and Page permissions. The app requests these when connecting Instagram.
4. Reconnect the Instagram account after adding permissions. The callback saves the encrypted Page token and tries to subscribe the Page to messaging webhooks.
5. Publish the app and request App Review / Advanced Access for people outside the app's roles. Until approval, Meta may limit messages and webhook deliveries to app-role testers.
6. Open Dashboard → Instagram Auto DM, choose the account, add a keyword and reply, then enable the rule.

The Instagram account must be Professional and linked to the Facebook Page whose Page token has the `MESSAGING` task. Replies are only sent in response to a user's incoming message and must remain within Meta's allowed messaging window. Meta message text has a 1,000-byte limit; the UI/API enforce that limit.

## Local development

Meta needs a publicly reachable HTTPS callback. `localhost` cannot receive live Instagram webhooks; deploy to a public Vercel URL or use a secure tunnel for development. Vercel Cron is unrelated to webhook delivery.
