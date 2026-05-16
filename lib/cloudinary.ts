import { v2 as cloudinary } from "cloudinary";

// Initialize Cloudinary with environment variables
if (!process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME) {
  throw new Error(
    "NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME environment variable is required",
  );
}

cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const getCloudinaryUploadPreset = () => {
  if (!process.env.CLOUDINARY_UPLOAD_PRESET) {
    throw new Error(
      "CLOUDINARY_UPLOAD_PRESET environment variable is required",
    );
  }
  return process.env.CLOUDINARY_UPLOAD_PRESET;
};

// Generate signed upload signature (for secure server-side uploads)
export const generateCloudinarySignature = async (
  params: Record<string, any>,
) => {
  try {
    const signature = cloudinary.utils.api_sign_request(
      params,
      process.env.CLOUDINARY_API_SECRET!,
    );
    return signature;
  } catch (error) {
    console.error("[v0] Error generating Cloudinary signature:", error);
    throw error;
  }
};

// Upload file to Cloudinary with progress tracking
export const uploadToCloudinary = async (
  file: File,
  onProgress?: (progress: number) => void,
): Promise<string> => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", getCloudinaryUploadPreset());
  formData.append("resource_type", "auto");

  const xhr = new XMLHttpRequest();

  return new Promise((resolve, reject) => {
    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          const percentComplete = (e.loaded / e.total) * 100;
          onProgress(percentComplete);
        }
      });
    }

    xhr.addEventListener("load", () => {
      if (xhr.status === 200) {
        const response = JSON.parse(xhr.responseText);
        resolve(response.secure_url);
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Upload failed"));
    });

    xhr.open(
      "POST",
      `https://api.cloudinary.com/v1_1/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/auto/upload`,
    );
    xhr.send(formData);
  });
};
