"use client";
import { useState, useRef } from "react";
import type React from "react";

import { useRouter, useSearchParams } from "next/navigation";
import { createMedia, publishMedia } from "@/lib/meta";
import {
  Upload,
  Youtube,
  CheckCircle,
  XCircle,
  Loader2,
  Instagram,
  ArrowLeft,
  Cloud,
  Send,
  AlertCircle,
} from "lucide-react";
import { HashtagPicker } from "@/components/hashtag-picker";

interface SelectedAccount {
  id: string;
  username: string;
  platform: "instagram" | "youtube";
  status: "pending" | "uploading" | "success" | "error";
  error?: string;
  token?: string;
}

interface AvailableAccount {
  id: string;
  username: string;
  platform: "instagram" | "youtube";
  token?: string;
}

export default function UploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload states
  const [cloudinaryUrl, setCloudinaryUrl] = useState<string>("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  // Publish states
  const [caption, setCaption] = useState("");
  const [selectedAccounts, setSelectedAccounts] = useState<SelectedAccount[]>(
    [],
  );
  const [availableAccounts, setAvailableAccounts] = useState<
    AvailableAccount[]
  >([]);
  const [isPublishing, setIsPublishing] = useState(false);

  // UI states
  const [error, setError] = useState<string>("");
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [step, setStep] = useState<"upload" | "publish">("upload");

  // Load available accounts
  const loadAccounts = async () => {
    try {
      const igAccounts = localStorage.getItem("ig_accounts");
      const ytAccounts = localStorage.getItem("youtube_accounts");

      const accounts: AvailableAccount[] = [];

      if (igAccounts) {
        const igData = JSON.parse(igAccounts);
        igData.forEach((account: any) => {
          accounts.push({
            id: account.id,
            username: account.username,
            platform: "instagram",
            token: account.token,
          });
        });
      }

      if (ytAccounts) {
        const ytData = JSON.parse(ytAccounts);
        ytData.forEach((account: any) => {
          accounts.push({
            id: account.id,
            username: account.username,
            platform: "youtube",
            token: account.token,
          });
        });
      }

      setAvailableAccounts(accounts);
    } catch (err) {
      console.log("[v0] No accounts found");
    }
  };

  const uploadToCloudinary = async (file: File) => {
    setIsUploading(true);
    setError("");
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || "";
      const uploadPreset =
        process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET || "";

      if (!cloudName || !uploadPreset) {
        throw new Error(
          "Cloudinary not configured. Add environment variables.",
        );
      }

      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          const progress = (e.loaded / e.total) * 100;
          setUploadProgress(Math.round(progress));
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status === 200) {
          try {
            const response = JSON.parse(xhr.responseText);
            setCloudinaryUrl(response.secure_url);
            setStep("publish");
            setUploadProgress(100);
            setTimeout(() => loadAccounts(), 500);
          } catch (e) {
            setError("Failed to parse upload response");
          }
        } else {
          const response = JSON.parse(xhr.responseText);
          setError(response.error?.message || "Upload failed");
        }
        setIsUploading(false);
      });

      xhr.addEventListener("error", () => {
        setError("Network error during upload");
        setIsUploading(false);
      });

      xhr.open(
        "POST",
        `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
      );
      formData.append("upload_preset", uploadPreset);
      xhr.send(formData);
    } catch (err: any) {
      setError(err.message || "Upload failed");
      setIsUploading(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file
    const maxSize = 5 * 1024 * 1024 * 1024; // 5GB
    if (file.size > maxSize) {
      setError("File is too large (max 5GB)");
      return;
    }

    uploadToCloudinary(file);
  };

  const toggleAccount = (account: AvailableAccount) => {
    setSelectedAccounts((prev) => {
      const exists = prev.find((a) => a.id === account.id);
      if (exists) {
        return prev.filter((a) => a.id !== account.id);
      } else {
        return [
          ...prev,
          {
            id: account.id,
            username: account.username,
            platform: account.platform,
            token: account.token,
            status: "pending",
          },
        ];
      }
    });
  };

  const publishToAccounts = async () => {
    if (!cloudinaryUrl || selectedAccounts.length === 0) {
      setError("Select at least one account");
      return;
    }

    setIsPublishing(true);
    setError("");

    try {
      const ytAccountsStored = JSON.parse(
        localStorage.getItem("youtube_accounts") || "[]",
      );

      // Use the uploaded Cloudinary URL as the final media URL
      const finalMediaUrl = cloudinaryUrl;

      // Append selected hashtags (from the picker) to the caption if present
      const finalCaption =
        hashtags.length > 0 ? `${caption}\n\n${hashtags.join(" ")}` : caption;

      // Publish to each selected account one-by-one
      for (let i = 0; i < selectedAccounts.length; i++) {
        const account = selectedAccounts[i];

        setSelectedAccounts((prev) =>
          prev.map((a) =>
            a.id === account.id ? { ...a, status: "uploading" } : a,
          ),
        );

        try {
          if (account.platform === "instagram") {
            // Post to Instagram Reel (expects createMedia + publishMedia helpers)
            const mediaContainer = await createMedia({
              igUserId: account.id,
              token: account.token,
              mediaUrl: finalMediaUrl,
              caption: finalCaption,
              isReel: true,
            });

            if (mediaContainer?.id) {
              // publishMedia helper should accept these params; adjust if your helper differs
              await publishMedia({
                mediaContainerId: mediaContainer.id,
                token: account.token,
              });
            } else {
              throw new Error("Failed to create Instagram media container");
            }
          } else if (account.platform === "youtube") {
            // Upload to YouTube via your server-side endpoint
            const ytAccount = ytAccountsStored.find(
              (a: any) => a.id === account.id,
            );
            if (!ytAccount?.accessToken) {
              throw new Error(
                "YouTube access token not found. Please reconnect your YouTube account.",
              );
            }

            const uploadResponse = await fetch("/api/youtube/upload", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                accessToken: ytAccount.accessToken,
                videoUrl: finalMediaUrl,
                title: finalCaption.substring(0, 100) || "Untitled Video",
                description: finalCaption,
                keywords: [],
                privacy: "public",
                isShort: false,
              }),
            });

            if (!uploadResponse.ok) {
              const errorData = await uploadResponse.json();
              throw new Error(errorData.error || "YouTube upload failed");
            }

            const result = await uploadResponse.json();
            console.log("[v0] YouTube video uploaded:", result.url);
          }

          setSelectedAccounts((prev) =>
            prev.map((a) =>
              a.id === account.id ? { ...a, status: "success" } : a,
            ),
          );
        } catch (err: any) {
          setSelectedAccounts((prev) =>
            prev.map((a) =>
              a.id === account.id
                ? { ...a, status: "error", error: err.message }
                : a,
            ),
          );
        }
      }
    } catch (err: any) {
      setError(err.message || "Publishing failed");
    } finally {
      setIsPublishing(false);
    }
  };

  const resetUpload = () => {
    setCloudinaryUrl("");
    setCaption("");
    setSelectedAccounts([]);
    setUploadProgress(0);
    setHashtags([]);
    setStep("upload");
    setError("");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/50 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center">
          <button
            onClick={() => router.back()}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="ml-4 text-xl font-bold">Upload & Publish</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex gap-3 text-red-200">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* STEP 1: UPLOAD TO CLOUDINARY */}
        {step === "upload" && !cloudinaryUrl && (
          <div className="bg-slate-900/50 backdrop-blur-sm rounded-2xl p-8 border border-white/10">
            <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
              <Cloud className="w-6 h-6" />
              Upload to Cloudinary
            </h2>

            <div
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${
                isUploading
                  ? "border-blue-500/30 bg-blue-500/5"
                  : "border-white/20 hover:border-pink-500/50 hover:bg-pink-500/5"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*,image/*"
                onChange={handleFileSelect}
                disabled={isUploading}
                className="hidden"
              />

              {isUploading ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="w-12 h-12 animate-spin text-blue-400" />
                  <div>
                    <p className="font-semibold mb-2">
                      Uploading... {uploadProgress}%
                    </p>
                    <div className="w-full bg-white/10 rounded-full h-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full transition-all"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <Upload className="w-12 h-12 text-white/40" />
                  <div>
                    <p className="font-semibold">
                      Click to upload video or image
                    </p>
                    <p className="text-sm text-white/40 mt-1">
                      Max 5GB • MP4, MOV, AVI, WebM, etc.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 2: PUBLISH TO INSTAGRAM & YOUTUBE */}
        {step === "publish" && cloudinaryUrl && (
          <div className="space-y-6">
            {/* Video Preview */}
            <div className="bg-slate-900/50 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
              <h2 className="text-lg font-bold mb-4">Preview</h2>
              <div className="aspect-video bg-black rounded-lg overflow-hidden">
                <video src={cloudinaryUrl} controls className="w-full h-full" />
              </div>
            </div>

            {/* Caption & Hashtags */}
            <div className="bg-slate-900/50 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
              <h2 className="text-lg font-bold mb-4">Caption</h2>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Write caption..."
                className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-white placeholder:text-white/40 resize-none h-24"
              />

              {/* Hashtag Picker */}
              <div className="mt-4">
                <HashtagPicker
                  selectedHashtags={hashtags}
                  onHashtagsChange={setHashtags}
                  caption={""}
                />
              </div>

              {/* Add hashtags to caption */}
              {hashtags.length > 0 && (
                <button
                  onClick={() => {
                    setCaption(
                      (prev) =>
                        prev + (prev ? "\n\n" : "") + hashtags.join(" "),
                    );
                    setHashtags([]);
                  }}
                  className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-semibold transition-colors"
                >
                  Add {hashtags.length} Hashtags
                </button>
              )}
            </div>

            {/* Select Accounts */}
            <div className="bg-slate-900/50 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
              <h2 className="text-lg font-bold mb-4">Publish to</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {availableAccounts.map((account) => (
                  <button
                    key={account.id}
                    onClick={() => toggleAccount(account)}
                    className={`p-4 rounded-lg border-2 transition-all text-left ${
                      selectedAccounts.find((a) => a.id === account.id)
                        ? "border-pink-500 bg-pink-500/10"
                        : "border-white/20 hover:border-white/40"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {account.platform === "instagram" ? (
                        <Instagram className="w-5 h-5" />
                      ) : (
                        <Youtube className="w-5 h-5" />
                      )}
                      <div>
                        <p className="font-semibold">{account.username}</p>
                        <p className="text-xs text-white/40 capitalize">
                          {account.platform}
                        </p>
                      </div>
                      {selectedAccounts.find((a) => a.id === account.id) && (
                        <CheckCircle className="w-5 h-5 ml-auto text-pink-400" />
                      )}
                    </div>
                  </button>
                ))}
              </div>

              {availableAccounts.length === 0 && (
                <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg text-blue-200 text-sm">
                  Connect Instagram or YouTube accounts first
                </div>
              )}
            </div>

            {/* Publish Button */}
            <div className="flex gap-3">
              <button
                onClick={resetUpload}
                className="flex-1 px-6 py-3 bg-white/10 hover:bg-white/20 rounded-lg font-semibold transition-colors"
              >
                Upload Another
              </button>
              <button
                onClick={publishToAccounts}
                disabled={isPublishing || selectedAccounts.length === 0}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-pink-600 to-pink-700 hover:from-pink-700 hover:to-pink-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {isPublishing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Publishing...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Publish Now
                  </>
                )}
              </button>
            </div>

            {/* Status Messages */}
            {selectedAccounts.length > 0 && (
              <div className="space-y-2">
                {selectedAccounts.map((account) => (
                  <div
                    key={account.id}
                    className={`p-3 rounded-lg flex items-center gap-3 ${
                      account.status === "success"
                        ? "bg-green-500/10 text-green-200 border border-green-500/30"
                        : account.status === "error"
                          ? "bg-red-500/10 text-red-200 border border-red-500/30"
                          : account.status === "uploading"
                            ? "bg-blue-500/10 text-blue-200 border border-blue-500/30"
                            : ""
                    }`}
                  >
                    {account.status === "success" ? (
                      <CheckCircle className="w-5 h-5" />
                    ) : account.status === "error" ? (
                      <XCircle className="w-5 h-5" />
                    ) : account.status === "uploading" ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : null}
                    <div>
                      <p className="font-semibold">{account.username}</p>
                      {account.error && (
                        <p className="text-xs">{account.error}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
