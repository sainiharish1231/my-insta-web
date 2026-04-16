'use client';

import { useState, useRef } from 'react';

interface CloudinaryUploadProps {
  onUploadSuccess: (url: string) => void;
  onUploadStart?: () => void;
  onProgressChange?: (progress: number) => void;
  disabled?: boolean;
  maxFileSize?: number;
}

export function CloudinaryUploadWidget({
  onUploadSuccess,
  onUploadStart,
  onProgressChange,
  disabled,
  maxFileSize = 4 * 1024 * 1024 * 1024,
}: CloudinaryUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName || !uploadPreset) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm mb-4">
        Cloudinary not configured. Add NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME and NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET.
      </div>
    );
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > maxFileSize) {
      alert(`File too large. Max size: ${maxFileSize / 1024 / 1024 / 1024}GB`);
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    onUploadStart?.();

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', uploadPreset);
      formData.append('cloud_name', cloudName);
      formData.append('folder', 'instaweb-uploads');

      const xhr = new XMLHttpRequest();

      // Track upload progress
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 100);
          setUploadProgress(progress);
          onProgressChange?.(progress);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          const response = JSON.parse(xhr.responseText);
          const url = response.secure_url || response.url;

          if (url) {
            localStorage.setItem(
              'lastCloudinaryUpload',
              JSON.stringify({
                url,
                publicId: response.public_id,
                timestamp: Date.now(),
              })
            );
            onUploadSuccess(url);
            setUploading(false);
            setUploadProgress(0);
          }
        }
      });

      xhr.addEventListener('error', () => {
        console.error('[v0] Upload failed:', xhr.responseText);
        alert('Upload failed. Check console for details.');
        setUploading(false);
      });

      // Direct upload to Cloudinary
      xhr.open('POST', `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`);
      xhr.send(formData);
    } catch (error) {
      console.error('[v0] Upload error:', error);
      setUploading(false);
    }
  };

  return (
    <div className="w-full mb-6">
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileChange}
        accept="video/*,image/*"
        disabled={uploading || disabled}
        className="hidden"
      />

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading || disabled}
        className="w-full px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-all"
      >
        {uploading ? `Uploading: ${uploadProgress}%` : 'Upload Video/Image to Cloudinary'}
      </button>

      {uploading && (
        <div className="mt-2 bg-white/10 rounded-lg overflow-hidden">
          <div
            className="bg-blue-500 h-1 transition-all"
            style={{ width: `${uploadProgress}%` }}
          />
        </div>
      )}
    </div>
  );
}
