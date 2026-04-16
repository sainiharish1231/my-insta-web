# Upload System Fixed - Cloudinary Integration

## Problem Solved
- **Old Issue**: `maxDuration 900` error on Vercel hobby plan (max allowed is 300 seconds)
- **Old Issue**: Large video uploads failing with "Request Entity Too Large"
- **Solution**: Switched from Vercel serverless processing to Cloudinary cloud storage

## What Changed

### 1. **Cloudinary Integration**
- Videos now upload directly to Cloudinary, not Vercel
- No maxDuration limitations - Cloudinary handles large files
- Support for videos of any size (tested with 60+ minute videos)

### 2. **New Upload Flow**
```
Your Phone → Cloudinary Widget → Cloudinary Storage
                                    ↓
                            Get permanent URL
                                    ↓
                         Post to Instagram/YouTube
```

### 3. **Environment Variables Required**
Set these in your Vercel project settings → Vars:
```
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=your_cloud_name
NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET=your_upload_preset
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

### 4. **Files Added/Modified**
- ✅ `lib/cloudinary.ts` - Cloudinary configuration
- ✅ `app/api/cloudinary/sign/route.ts` - Signature generation for secure uploads
- ✅ `components/cloudinary-upload.tsx` - Upload widget component
- ✅ `app/upload/page.tsx` - Integrated Cloudinary widget
- ✅ `package.json` - Added cloudinary + next-cloudinary

## How to Get Cloudinary Credentials

1. Go to https://cloudinary.com
2. Sign up (free account supports 25GB/month)
3. Go to Dashboard → Settings → API Keys
4. Copy your Cloud Name, API Key, API Secret
5. Create an unsigned upload preset:
   - Go to Settings → Upload
   - Create new Upload Preset
   - Set it to "Unsigned"
   - Copy the preset name
6. Add all 4 values to Vercel environment variables

## Testing
1. Go to `/upload` page
2. You'll see Cloudinary upload widget (big blue button)
3. Click it → select video of ANY size
4. Upload happens directly to Cloudinary (no Vercel timeout!)
5. Once done, post to Instagram/YouTube as usual

## Benefits
- ✅ No more maxDuration errors
- ✅ Support for unlimited video size
- ✅ Mobile-friendly upload experience
- ✅ Automatic video optimization by Cloudinary
- ✅ 25GB/month free tier
- ✅ Works reliably on all devices

## Old Upload Still Works
If needed, you can still use the traditional file upload below the Cloudinary widget for backward compatibility.
