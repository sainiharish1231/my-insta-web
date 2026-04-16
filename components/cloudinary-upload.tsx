'use client';

import { CldUploadWidget } from 'next-cloudinary';
import { Dispatch, SetStateAction } from 'react';

interface CloudinaryUploadProps {
  onUploadSuccess: (url: string) => void;
  onUploadStart?: () => void;
  onProgressChange?: (progress: number) => void;
  disabled?: boolean;
  maxFileSize?: number; // in bytes
}

export function CloudinaryUploadWidget({
  onUploadSuccess,
  onUploadStart,
  onProgressChange,
  disabled,
  maxFileSize = 4 * 1024 * 1024 * 1024, // 4GB default
}: CloudinaryUploadProps) {
  return (
    <CldUploadWidget
      uploadPreset={process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET}
      resourceType="auto"
      maxBytes={maxFileSize}
      onSuccess={(result: any) => {
        const url = result.info?.secure_url || result.info?.url;
        if (url) {
          onUploadSuccess(url);
        }
      }}
      onQueuesEnd={() => {
        onProgressChange?.(100);
      }}
      options={{
        sources: ['local', 'url', 'camera'],
        multiple: false,
        maxDisplaySize: 40,
        clientAllowedFormats: [
          'mp4',
          'mov',
          'avi',
          'mkv',
          'webm',
          'flv',
          'jpg',
          'jpeg',
          'png',
          'gif',
          'webp',
        ],
        showAdvancedOptions: true,
        showPoweredBy: false,
        folder: 'instaweb-uploads',
      }}
    >
      {({ open }) => (
        <button
          type="button"
          onClick={() => open()}
          disabled={disabled}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
        >
          Upload to Cloudinary
        </button>
      )}
    </CldUploadWidget>
  );
}
