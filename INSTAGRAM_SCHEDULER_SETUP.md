# Instagram scheduled Reels setup

Instagram Reels use a server-side queue. The app stores the job in MongoDB, encrypts its Instagram token, and a scheduled caller prepares the media container shortly before the requested time and publishes it when due. Facebook Page video scheduling and YouTube scheduling continue to use their platform APIs.

## Required Vercel environment values

Set these in Vercel Production (and in `.env.local` for local development):

- `MONGODB_URI`: existing MongoDB connection string.
- `SCHEDULED_POSTS_ENCRYPTION_KEY`: a stable base64-encoded 32-byte random key. Generate it with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
- `CRON_SECRET`: a separate random secret. Generate it with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

Keep the encryption key unchanged. Replacing it makes tokens in already queued jobs unreadable. Never commit real secrets.

## GitHub Actions scheduler for Vercel Hobby

Vercel Hobby only permits daily cron jobs. This repo uses GitHub Actions to call the protected Vercel route every five minutes instead, so posts can publish close to their scheduled time without Vercel Pro. GitHub may delay scheduled runs during busy periods, so timing is approximate.

1. Add the three values above to Vercel Production.
2. In GitHub, open **Settings → Secrets and variables → Actions**. Add `SCHEDULED_PUBLISHER_URL` (your deployed base URL, such as `https://your-app.vercel.app`) and `CRON_SECRET` (same value as Vercel).
3. Push `.github/workflows/instagram-scheduler.yml` to the repository's default branch and ensure GitHub Actions are enabled. It runs every five minutes and supports manual runs from the Actions tab.
4. Connect Instagram and schedule a Reel at least 20 minutes in the future. Check Dashboard → Scheduled Posts for status.

The endpoint requires `Authorization: Bearer <CRON_SECRET>`. Do not expose that value in client code. Local development does not run GitHub Actions automatically.

The queue creates Instagram's media container up to 10 minutes before the scheduled time. Instagram containers expire after 24 hours, so the app creates them close to publication time instead of when a post is scheduled.
