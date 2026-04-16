# Cloudinary Setup Guide

Yeh app large video uploads ke liye **Cloudinary** use karta hai. Is se koi Vercel timeout errors nahi aayenge aur unlimited size ki videos upload kar sakte ho.

## Setup Steps

### 1. Cloudinary Account Banao
1. https://cloudinary.com/users/register/free par jaao
2. Free account create karo
3. Email verify karo

### 2. Apna Cloud Name aur API Keys Find Karo
1. Dashboard pe jaao: https://cloudinary.com/console
2. Apka **Cloud Name** dekho (top of page)
3. Settings → API Keys section mein jaao
4. API Key aur API Secret copy karo

### 3. Upload Preset Create Karo
1. Settings → Upload tab pe jaao
2. "Add upload preset" par click karo
3. Name: `instaweb_uploads` (ya koi bhi naam)
4. Mode: **Unsigned** (important! isse client upload work karega)
5. Save karo

### 4. Environment Variables Set Karo

**Local Development ke liye (.env.local file mein):**
```
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=your-cloud-name
NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET=instaweb_uploads
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

**Vercel Deployment ke liye:**
1. https://vercel.com/dashboard par jaao
2. Apna project select karo
3. Settings → Environment Variables
4. Add karo:
   - `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`
   - `NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET`
   - `CLOUDINARY_API_KEY`
   - `CLOUDINARY_API_SECRET`

## Features

✅ **Unlimited File Size** - 4GB tak videos upload karo
✅ **No Timeout Errors** - Upload directly to Cloudinary, Vercel bypass
✅ **Fast Uploads** - Cloudinary's infrastructure automatically best CDN choose karta hai
✅ **Auto Optimization** - Videos automatically optimize ho jaate hain

## How It Works

1. User file select karta hai
2. File directly Cloudinary ko upload ho jaati hai (Vercel se nahi guzarta)
3. Upload complete hone ke baad URL return hota hai
4. Woh URL Instagram/YouTube pe post hota hai

**Key Point:** Vercel sirf metadata handle karta hai, actual file upload Cloudinary handle karta hai!

## Troubleshooting

**Error: "Cloudinary not configured"**
→ Environment variables properly set hain check karo

**Upload widget nahi dikha?**
→ Package install ho gaye hain check karo: `npm install next-cloudinary`

**Video upload slow hai?**
→ Cloudinary ke bandwidth unlimited hai, par apne internet speed check karo
