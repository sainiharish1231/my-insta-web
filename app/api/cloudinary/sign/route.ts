import { generateCloudinarySignature } from '@/lib/cloudinary';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 30; // Quick signature generation

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        {
          error:
            'CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are required for signed Cloudinary uploads',
        },
        { status: 500 }
      );
    }

    const timestamp =
      Number.isFinite(Number(body?.timestamp)) && Number(body.timestamp) > 0
        ? Number(body.timestamp)
        : Math.floor(Date.now() / 1000);
    const signatureParams: Record<string, string | number> = { timestamp };
    if (typeof body?.folder === 'string' && body.folder.trim()) {
      signatureParams.folder = body.folder.trim();
    }

    const signature = await generateCloudinarySignature(signatureParams);
    
    return NextResponse.json({
      apiKey,
      signature,
      timestamp,
    });
  } catch (error) {
    console.error('[v0] Signature generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate signature' },
      { status: 500 }
    );
  }
}
