import { app } from "@/lib/firebase";
import { getDownloadURL, getStorage, ref, uploadBytesResumable } from "firebase/storage";

export const MAX_UPLOAD_FILE_SIZE_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB
const API_FALLBACK_MAX_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB

type UploadProgressCallback = (percent: number) => void;

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function hasFirebaseStorageConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY &&
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID &&
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
  );
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
  if (file.size > API_FALLBACK_MAX_SIZE_BYTES) {
    throw new Error(
      "Direct cloud upload is unavailable and fallback server upload supports only up to 500MB."
    );
  }

  const formData = new FormData();
  formData.append("file", file);

  onProgress?.(0);

  const res = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });

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

export async function uploadMediaToBlob(
  file: File,
  onProgress?: UploadProgressCallback
): Promise<string> {
  const validationError = validateMediaFile(file);
  if (validationError) {
    throw new Error(validationError);
  }

  if (hasFirebaseStorageConfig()) {
    return uploadToFirebase(file, onProgress);
  }

  return uploadViaApi(file, onProgress);
}
