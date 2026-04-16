import { generateCloudinarySignature } from '@/lib/cloudinary';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 30; // Quick signature generation

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const signature = await generateCloudinarySignature(body);
    
    return NextResponse.json({
      signature,
      timestamp: Math.floor(Date.now() / 1000),
    });
  } catch (error) {
    console.error('[v0] Signature generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate signature' },
      { status: 500 }
    );
  }
}
