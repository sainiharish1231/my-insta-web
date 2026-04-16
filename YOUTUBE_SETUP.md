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

## Important Notes

- Make sure to add your production domain to authorized redirect URIs before deploying
- YouTube API has daily quota limits - check your quota usage in Google Cloud Console
- Refresh tokens are stored to maintain long-term access
