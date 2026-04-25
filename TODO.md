# Shorts Render Speed Optimization - TODO

## Status: IN PROGRESS

### Step 1: Create TODO & confirm plan ✅

### Step 2: Edit `lib/server/youtube-shorts.ts` - Hardware accel + fast profiles + pipelining ✅

- Hardware acceleration auto-detect (h264_videotoolbox, nvenc, vaapi, qsv)
- Fast render profiles: veryfast preset, crf 22/23, lower bitrates
- gblur sigma reduced 28 → 12 (huge CPU save)
- Render-Upload pipelining (upload starts while next render runs)
- Higher concurrency limits

### Step 3: Edit API routes - maxDuration 300 → 600 ✅

- `app/api/youtube/shorts/create/route.ts`
- `app/api/youtube/shorts/create-stream/route.ts`
- `app/api/youtube/shorts/create-upload/route.ts`
- `app/api/youtube/shorts/create-upload-stream/route.ts`
- `app/api/youtube/shorts/source/route.ts`

### Step 4: Test build ✅

- `npx tsc --noEmit` passed with 0 errors
