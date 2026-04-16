import { app } from "@/lib/firebase";
import { getDownloadURL, getStorage, ref, uploadBytesResumable } from "firebase/storage";

export const MAX_UPLOAD_FILE_SIZE_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB
const SIMPLE_API_UPLOAD_MAX_SIZE_BYTES = 4 * 1024 * 1024; // 4 MB
const API_CHUNK_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB

// Cloudinary config - presigned uploads (direct, no Vercel timeout!)
const CLOUDINARY_CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_UPLOAD_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

type UploadProgressCallback = (percent: number) => void;

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function validateMediaFile(file: File): string | null {
  if (!file) {
    return "Please select a file.";
  }

  if (file.size <= 0) {
    return "Selected file is empty. Please choose another file.";
  }

  if (file.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
    return "File is too large. Maximum supported size is 4GB.";
  }

  return null;
}

async function uploadToFirebase(
  file: File,
  onProgress?: UploadProgressCallback
): Promise<string> {
  if (!app.options.apiKey || !app.options.projectId || !app.options.storageBucket) {
    throw new Error(
      "Firebase Storage is not configured. Add NEXT_PUBLIC_FIREBASE_* variables in your deployed environment."
    );
  }

  const storage = getStorage(app);
  const safeName = sanitizeFilename(file.name);
  const path = `uploads/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${safeName}`;
  const storageRef = ref(storage, path);

  const uploadTask = uploadBytesResumable(storageRef, file, {
    contentType: file.type || "application/octet-stream",
    cacheControl: "public, max-age=31536000",
  });

  return new Promise((resolve, reject) => {
    uploadTask.on(
      "state_changed",
      (snapshot) => {
        if (onProgress && snapshot.totalBytes > 0) {
          const percent = Math.round(
            (snapshot.bytesTransferred / snapshot.totalBytes) * 100
          );
          onProgress(percent);
        }
      },
      (error) => {
        reject(
          new Error(
            error?.message ||
              "Direct cloud upload failed. Please check storage setup and try again."
          )
        );
      },
      async () => {
        try {
          const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
          onProgress?.(100);
          resolve(downloadUrl);
        } catch (error: any) {
          reject(
            new Error(
              error?.message ||
                "Upload finished but public URL could not be generated."
            )
          );
        }
      }
    );
  });
}

async function uploadViaApi(
  file: File,
  onProgress?: UploadProgressCallback
): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  onProgress?.(0);

  const res = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });

  if (res.status === 413) {
    throw new Error(
      "Request entity too large. Configure Firebase direct upload for large videos."
    );
  }

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to upload file: ${errorText}`);
  }

  const data = await res.json();
  if (!data.url) {
    throw new Error("Upload succeeded but no URL returned");
  }

  onProgress?.(100);
  return data.url;
}

async function uploadViaChunkedApi(
  file: File,
  onProgress?: UploadProgressCallback
): Promise<string> {
  const totalChunks = Math.ceil(file.size / API_CHUNK_UPLOAD_BYTES);
  let uploadId: string | null = null;

  onProgress?.(0);

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const start = chunkIndex * API_CHUNK_UPLOAD_BYTES;
    const end = Math.min(start + API_CHUNK_UPLOAD_BYTES, file.size);
    const chunk = file.slice(start, end);
    const formData = new FormData();

    formData.append("file", chunk, file.name);
    formData.append("filename", file.name);
    formData.append("contentType", file.type || "application/octet-stream");
    formData.append("fileSize", String(file.size));
    formData.append("chunkIndex", String(chunkIndex));
    formData.append("totalChunks", String(totalChunks));
    formData.append("chunkSize", String(API_CHUNK_UPLOAD_BYTES));

    if (uploadId) {
      formData.append("uploadId", uploadId);
    }

    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to upload file chunk: ${errorText}`);
    }

    const data = await res.json();
    if (!data.uploadId) {
      throw new Error("Chunk upload succeeded but no upload ID was returned");
    }

    uploadId = data.uploadId;
    const uploadedBytes = Math.min(end, file.size);
    const percent = Math.max(
      1,
      Math.min(100, Math.round((uploadedBytes / file.size) * 100))
    );
    onProgress?.(percent);

    if (chunkIndex === totalChunks - 1) {
      if (!data.url) {
        throw new Error("Upload completed but no file URL was returned");
      }
      return data.url;
    }
  }

  throw new Error("Chunked upload did not complete");
}

async function uploadToCloudinary(
  file: File,
  onProgress?: UploadProgressCallback
): Promise<string> {
  // Use Cloudinary presigned URL for direct upload - NO Vercel timeout!
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
    throw new Error(
      "Cloudinary not configured. Set NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME and NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET."
    );
  }

  const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`;
  const formData = new FormData();

  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  formData.append("folder", `instagram-uploads/${new Date().toISOString().slice(0, 10)}`);
  formData.append("resource_type", "video");

  onProgress?.(10); // Show immediate progress

  const xhr = new XMLHttpRequest();

  return new Promise((resolve, reject) => {
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        const percentComplete = Math.round((event.loaded / event.total) * 100);
        onProgress?.(Math.min(95, percentComplete)); // Cap at 95% until finalized
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status === 200) {
        const response = JSON.parse(xhr.responseText);
        onProgress?.(100);
        resolve(response.secure_url || response.url);
      } else {
        reject(new Error(`Cloudinary upload failed: ${xhr.statusText}`));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Cloudinary upload failed - network error"));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("Cloudinary upload was cancelled"));
    });

    xhr.open("POST", uploadUrl);
    xhr.send(formData);
  });
}

export async function uploadMediaToBlob(
  file: File,
  onProgress?: UploadProgressCallback
): Promise<string> {
  const validationError = validateMediaFile(file);
  if (validationError) {
    throw new Error(validationError);
  }

  // Try Cloudinary first (no Vercel timeout for large files!)
  if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_UPLOAD_PRESET) {
    try {
      console.log("[v0] Attempting Cloudinary upload for large videos...");
      return await uploadToCloudinary(file, onProgress);
    } catch (cloudinaryError: any) {
      console.error("[v0] Cloudinary upload failed:", cloudinaryError);
      // Fall back to other methods
    }
  }

  // Try Firebase direct upload
  try {
    return await uploadToFirebase(file, onProgress);
  } catch (firebaseError: any) {
    console.error("[v0] Direct Firebase upload failed:", firebaseError);
  }

  // Fall back to API uploads
  if (file.size <= SIMPLE_API_UPLOAD_MAX_SIZE_BYTES) {
    return uploadViaApi(file, onProgress);
  }

  return uploadViaChunkedApi(file, onProgress);
}
