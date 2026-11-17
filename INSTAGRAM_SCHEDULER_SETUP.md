# Instagram scheduled Reels setup

Instagram Reels now use a server-side queue. The app stores the job in MongoDB, encrypts its Instagram token, and a Vercel Cron Function prepares the media container shortly before the requested time and publishes it when due. Facebook Page video scheduling and YouTube scheduling continue to use their platform APIs.

## Required deployment settings

Set these values in the deployment environment (and in `.env.local` for local development):

- `MONGODB_URI`: existing MongoDB connection string.
- `SCHEDULED_POSTS_ENCRYPTION_KEY`: a stable base64-encoded 32-byte random key. Generate it with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
- `CRON_SECRET`: a separate random secret. Generate it with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

Keep the encryption key unchanged between deployments. Replacing it makes tokens in already queued jobs unreadable. Never commit the real secrets.

## Deploy

1. Add the environment values to the Vercel project for Production and Preview as needed.
2. Deploy the commit to Production. `vercel.json` registers `/api/cron/instagram-scheduler` to run every minute.
3. Open the app, connect Instagram, and schedule a Reel at least 20 minutes in the future.
4. Check Dashboard → Scheduled Posts for the queue status. A post marked `error` needs review before you schedule it again.

The cron route requires `Authorization: Bearer <CRON_SECRET>`. Do not expose that value in client code. Local development does not run Vercel Cron automatically.

The queue creates Instagram's media container up to 10 minutes before the scheduled time. Instagram containers expire after 24 hours, so the app creates them close to publication time instead of when a post is scheduled.
