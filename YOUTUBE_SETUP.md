# YouTube OAuth Setup Guide

## Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable YouTube Data API v3:
   - Go to "APIs & Services" > "Library"
   - Search for "YouTube Data API v3"
   - Click "Enable"

## Step 2: Create OAuth 2.0 Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth 2.0 Client ID"
3. Configure OAuth consent screen if not done:
   - User Type: External
   - App name: Your app name
   - User support email: Your email
   - Developer contact: Your email
   - Add scopes: `https://www.googleapis.com/auth/youtube.upload`, `https://www.googleapis.com/auth/youtube.readonly`
   - Add test users if needed

4. Create OAuth Client ID:
   - Application type: Web application
   - Name: YouTube Integration
   - Authorized redirect URIs:
     - http://localhost:3000/auth/youtube-callback (for development)
     - https://yourdomain.com/auth/youtube-callback (for production)

5. Copy your Client ID and Client Secret

## Step 3: Add Environment Variables

Add these to your Vercel project or .env.local file:

\`\`\`
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
NEXT_PUBLIC_APP_URL=http://localhost:3000 (or your production URL)
\`\`\`

## Step 4: Test YouTube Login

1. Restart your development server
2. Click "Add YouTube Account" button
3. Authorize the app with your YouTube account
4. You should be redirected back and see your YouTube channel connected

## Handling YouTube Bot Checks & Cookie Setup

YouTube sometimes blocks downloads from shared/mobile IP ranges with a **"Sign in to confirm you're not a bot"** message. When this happens, the app shows a clean dialog with fallback steps.

### Automatic Handling (No Cookies Needed)

1. **Auto-clean URLs** — Mobile/shared links (`youtu.be`, `youtube.com/shorts/...`) are automatically normalized to standard `youtube.com/watch?v=...` URLs.
2. **Direct file fallback** — If URL mode is blocked, you can select a video file directly from your phone/computer. The file uploads securely via Cloudinary/Firebase and shorts are generated without touching YouTube's download restrictions.

### Cookie-Based Bypass (Desktop Only)

If you want to keep using URL mode for videos that repeatedly trigger the bot check, you can configure exported browser cookies. **This requires a desktop browser — mobile browsers cannot export cookies in the required format.**

#### Supported Environment Variables

| Variable                 | Description                                                         |
| ------------------------ | ------------------------------------------------------------------- |
| `YOUTUBE_COOKIES_FILE`   | Absolute path to a Netscape `cookies.txt` file on the server        |
| `YOUTUBE_COOKIES_BASE64` | Base64-encoded contents of a Netscape `cookies.txt` file            |
| `YOUTUBE_COOKIES`        | Inline Netscape cookie string (newlines as `\n` or actual newlines) |

#### How to Export Cookies from Chrome (Desktop)

1. Install a cookie exporter extension (e.g., **"Get cookies.txt LOCALLY"** from Chrome Web Store).
2. Go to [youtube.com](https://youtube.com) and make sure you are **logged in**.
3. Click the extension → **Export** → choose **Netscape format**.
4. Save the file as `cookies.txt`.
5. Set `YOUTUBE_COOKIES_FILE=/absolute/path/to/cookies.txt` in your environment.

#### How to Export Cookies from Firefox (Desktop)

1. Install the **"cookies.txt"** extension.
2. Go to [youtube.com](https://youtube.com) and make sure you are **logged in**.
3. Click the extension → **Export** → **Netscape format**.
4. Save the file as `cookies.txt`.
5. Set `YOUTUBE_COOKIES_FILE=/absolute/path/to/cookies.txt` in your environment.

#### Using Base64 Instead of a File

If you cannot place a file on the server (e.g., Vercel serverless), encode the contents:

```bash
# On macOS/Linux
base64 -i cookies.txt -o cookies.txt.base64

# Then set the environment variable
YOUTUBE_COOKIES_BASE64=<paste-contents-of-cookies.txt.base64>
```

#### Important Notes

- Cookies expire. If the block returns after some time, re-export fresh cookies.
- Only logged-in cookies work. Make sure you are signed into YouTube before exporting.
- The app uses `yt-dlp` with cookies first, then falls back to `ytdl` and `youtubei.js` if cookies are unavailable or insufficient.
- On mobile, there is no way to export Netscape cookies. Use the **direct file upload fallback** instead.

---

## Important Notes

- Make sure to add your production domain to authorized redirect URIs before deploying
- YouTube API has daily quota limits - check your quota usage in Google Cloud Console
- Refresh tokens are stored to maintain long-term access
