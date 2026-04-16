"use client";

import { useEffect, useRef, useState } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  Cloud,
  Instagram,
  Loader2,
  Send,
  Sparkles,
  Trash2,
  Upload,
  XCircle,
  Youtube,
} from "lucide-react";
import { HashtagPicker } from "@/components/hashtag-picker";
import { createMedia, publishMedia } from "@/lib/meta";

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

interface CloudinaryAsset {
  secureUrl: string;
  publicId: string;
  resourceType: string;
}

function createSmartCaption(base: string, hashtags: string[]) {
  const cleaned = base.trim();
  const opener = cleaned || "Fresh post, sharp edit, and ready to go live.";
  const lines = [
    opener,
    "Built to stop the scroll and keep the watch time high.",
    "Drop your thoughts below and save this for later.",
  ];

  if (hashtags.length > 0) {
    lines.push(hashtags.join(" "));
  }

  return lines.join("\n\n");
}

export default function UploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cloudinaryAsset, setCloudinaryAsset] = useState<CloudinaryAsset | null>(
    null,
  );
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [caption, setCaption] = useState("");
  const [selectedAccounts, setSelectedAccounts] = useState<SelectedAccount[]>(
    [],
  );
  const [availableAccounts, setAvailableAccounts] = useState<
    AvailableAccount[]
  >([]);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState("");
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [step, setStep] = useState<"upload" | "publish">("upload");
  const [deleteAfterPublish, setDeleteAfterPublish] = useState(true);
  const [isGeneratingCaption, setIsGeneratingCaption] = useState(false);

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = () => {
    try {
      const igAccounts = JSON.parse(localStorage.getItem("ig_accounts") || "[]");
      const ytAccounts = JSON.parse(
        localStorage.getItem("youtube_accounts") || "[]",
      );

      const accounts: AvailableAccount[] = [
        ...igAccounts.map((account: any) => ({
          id: account.id,
          username: account.username,
          platform: "instagram" as const,
          token: account.token,
        })),
        ...ytAccounts.map((account: any) => ({
          id: account.id,
          username: account.username || account.name,
          platform: "youtube" as const,
          token: account.accessToken || account.token,
        })),
      ];

      setAvailableAccounts(accounts);
      setSelectedAccounts((prev) => {
        if (prev.length > 0) {
          return prev;
        }

        return accounts.map((account) => ({
          ...account,
          status: "pending" as const,
        }));
      });
    } catch (loadError) {
      console.error("[v0] Failed to load accounts:", loadError);
    }
  };

  const uploadToCloudinary = async (file: File) => {
    setIsUploading(true);
    setError("");
    setUploadProgress(0);

    try {
      const formData = new FormData();
      const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || "";
      const uploadPreset =
        process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET || "";

      if (!cloudName || !uploadPreset) {
        throw new Error(
          "Cloudinary not configured. Add NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME and NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET.",
        );
      }

      formData.append("file", file);
      formData.append("upload_preset", uploadPreset);
      formData.append(
        "folder",
        `instant-posts/${new Date().toISOString().slice(0, 10)}`,
      );
      formData.append(
        "resource_type",
        file.type.startsWith("video/") ? "video" : "auto",
      );

      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          const progress = (event.loaded / event.total) * 100;
          setUploadProgress(Math.round(progress));
        }
      });

      xhr.addEventListener("load", () => {
        try {
          const response = JSON.parse(xhr.responseText);

          if (xhr.status !== 200) {
            throw new Error(response.error?.message || "Upload failed");
          }

          setCloudinaryAsset({
            secureUrl: response.secure_url,
            publicId: response.public_id,
            resourceType: response.resource_type || "video",
          });
          setStep("publish");
          setUploadProgress(100);
          loadAccounts();
        } catch (uploadError: any) {
          setError(uploadError.message || "Failed to parse upload response");
        } finally {
          setIsUploading(false);
        }
      });

      xhr.addEventListener("error", () => {
        setError("Network error during upload");
        setIsUploading(false);
      });

      xhr.open("POST", `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`);
      xhr.send(formData);
    } catch (uploadError: any) {
      setError(uploadError.message || "Upload failed");
      setIsUploading(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const maxSize = 5 * 1024 * 1024 * 1024;
    if (file.size > maxSize) {
      setError("File is too large (max 5GB)");
      return;
    }

    uploadToCloudinary(file);
  };

  const toggleAccount = (account: AvailableAccount) => {
    setSelectedAccounts((prev) => {
      const exists = prev.find((item) => item.id === account.id);
      if (exists) {
        return prev.filter((item) => item.id !== account.id);
      }

      return [
        ...prev,
        {
          ...account,
          status: "pending",
        },
      ];
    });
  };

  const generateAICaption = async () => {
    setIsGeneratingCaption(true);
    try {
      const smartCaption = createSmartCaption(caption, hashtags);
      setCaption(smartCaption);
    } finally {
      setIsGeneratingCaption(false);
    }
  };

  const deleteCloudinaryAsset = async () => {
    if (!cloudinaryAsset?.publicId) {
      return;
    }

    const response = await fetch("/api/cloudinary/delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        publicId: cloudinaryAsset.publicId,
        resourceType: cloudinaryAsset.resourceType,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Failed to clean up Cloudinary media");
    }
  };

  const publishToAccounts = async () => {
    if (!cloudinaryAsset?.secureUrl || selectedAccounts.length === 0) {
      setError("At least one account should stay selected");
      return;
    }

    setIsPublishing(true);
    setError("");

    try {
      const ytAccountsStored = JSON.parse(
        localStorage.getItem("youtube_accounts") || "[]",
      );
      const finalMediaUrl = cloudinaryAsset.secureUrl;
      const finalCaption =
        hashtags.length > 0 ? `${caption}\n\n${hashtags.join(" ")}` : caption;

      let successCount = 0;

      for (const account of selectedAccounts) {
        setSelectedAccounts((prev) =>
          prev.map((item) =>
            item.id === account.id ? { ...item, status: "uploading" } : item,
          ),
        );

        try {
          if (account.platform === "instagram") {
            const creationId = await createMedia({
              igUserId: account.id,
              token: account.token,
              mediaUrl: finalMediaUrl,
              caption: finalCaption,
              isReel: true,
            });

            await publishMedia({
              igUserId: account.id,
              token: account.token,
              creationId,
            });
          } else {
            const ytAccount = ytAccountsStored.find(
              (storedAccount: any) => storedAccount.id === account.id,
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
                refreshToken: ytAccount.refreshToken,
                videoUrl: finalMediaUrl,
                title: finalCaption.substring(0, 100) || "Untitled Video",
                description: finalCaption,
                keywords: hashtags.map((item) => item.replace("#", "")),
                privacy: "public",
                isShort: false,
              }),
            });

            const result = await uploadResponse.json();
            if (!uploadResponse.ok) {
              throw new Error(result.error || "YouTube upload failed");
            }
          }

          successCount += 1;
          setSelectedAccounts((prev) =>
            prev.map((item) =>
              item.id === account.id ? { ...item, status: "success" } : item,
            ),
          );
        } catch (publishError: any) {
          setSelectedAccounts((prev) =>
            prev.map((item) =>
              item.id === account.id
                ? { ...item, status: "error", error: publishError.message }
                : item,
            ),
          );
        }
      }

      if (
        deleteAfterPublish &&
        successCount === selectedAccounts.length &&
        cloudinaryAsset.publicId
      ) {
        await deleteCloudinaryAsset();
      }
    } catch (publishError: any) {
      setError(publishError.message || "Publishing failed");
    } finally {
      setIsPublishing(false);
    }
  };

  const resetUpload = () => {
    setCloudinaryAsset(null);
    setCaption("");
    setSelectedAccounts(
      availableAccounts.map((account) => ({
        ...account,
        status: "pending",
      })),
    );
    setUploadProgress(0);
    setHashtags([]);
    setStep("upload");
    setError("");
  };

  const allSelected = selectedAccounts.length === availableAccounts.length;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#1e293b_0%,#0f172a_35%,#020617_100%)] text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="rounded-xl p-2 transition-colors hover:bg-white/10"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-cyan-300/70">
                Direct Flow
              </p>
              <h1 className="text-xl font-bold">Upload & Publish Studio</h1>
            </div>
          </div>
          <div className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-4 py-1.5 text-sm text-emerald-300">
            {allSelected ? "All accounts auto-selected" : "Custom selection"}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {error && (
          <div className="mb-6 flex gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-red-200">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {step === "upload" && !cloudinaryAsset && (
          <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl shadow-slate-950/40 backdrop-blur-xl">
              <div className="mb-8 flex items-center justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.25em] text-cyan-300/70">
                    Step 1
                  </p>
                  <h2 className="mt-2 flex items-center gap-3 text-3xl font-bold">
                    <Cloud className="h-8 w-8 text-cyan-300" />
                    Push to Cloudinary
                  </h2>
                  <p className="mt-2 text-white/60">
                    Upload once. Publish everywhere. Clean up automatically after success.
                  </p>
                </div>
              </div>

              <div
                onClick={() => fileInputRef.current?.click()}
                className={`cursor-pointer rounded-3xl border-2 border-dashed p-14 text-center transition-all ${
                  isUploading
                    ? "border-cyan-400/40 bg-cyan-400/10"
                    : "border-white/15 bg-slate-950/40 hover:border-cyan-400/50 hover:bg-cyan-400/5"
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
                  <div className="mx-auto max-w-md">
                    <Loader2 className="mx-auto h-14 w-14 animate-spin text-cyan-300" />
                    <p className="mt-4 text-xl font-semibold">
                      Uploading... {uploadProgress}%
                    </p>
                    <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-cyan-400/20 to-emerald-400/20">
                      <Upload className="h-10 w-10 text-cyan-200" />
                    </div>
                    <div>
                      <p className="text-2xl font-semibold">
                        Tap to upload video or image
                      </p>
                      <p className="mt-2 text-white/50">
                        Max 5GB. Best for MP4 / H.264. One upload drives all connected accounts.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
                <p className="text-sm uppercase tracking-[0.25em] text-fuchsia-300/70">
                  Accounts
                </p>
                <h3 className="mt-2 text-xl font-semibold">
                  Ready by default
                </h3>
                <p className="mt-2 text-sm text-white/60">
                  Jitne bhi accounts login hain, sab default selected rahenge. Manual selection optional hai.
                </p>
                <div className="mt-5 space-y-3">
                  {availableAccounts.length === 0 ? (
                    <p className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4 text-sm text-blue-200">
                      Connect Instagram or YouTube accounts first.
                    </p>
                  ) : (
                    availableAccounts.map((account) => (
                      <div
                        key={`${account.platform}-${account.id}`}
                        className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/40 p-3"
                      >
                        {account.platform === "instagram" ? (
                          <Instagram className="h-5 w-5 text-pink-400" />
                        ) : (
                          <Youtube className="h-5 w-5 text-red-400" />
                        )}
                        <div>
                          <p className="font-medium">{account.username}</p>
                          <p className="text-xs capitalize text-white/45">
                            {account.platform}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-3xl border border-emerald-400/15 bg-emerald-500/10 p-6 text-sm text-emerald-200">
                Publish ke baad agar sab selected accounts success ho gaye, to Cloudinary asset auto-delete ho jayega.
              </div>
            </div>
          </div>
        )}

        {step === "publish" && cloudinaryAsset && (
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-6">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm uppercase tracking-[0.25em] text-cyan-300/70">
                      Step 2
                    </p>
                    <h2 className="mt-2 text-2xl font-bold">Finalize the post</h2>
                  </div>
                  <button
                    onClick={resetUpload}
                    className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm transition-colors hover:bg-white/10"
                  >
                    Upload Another
                  </button>
                </div>

                <div className="overflow-hidden rounded-3xl border border-white/10 bg-black">
                  <video
                    src={cloudinaryAsset.secureUrl}
                    controls
                    className="aspect-video w-full"
                  />
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-white/60">
                  Cloud URL ready. Publish ke baad cleanup toggle on hai.
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-xl font-semibold">Caption Studio</h3>
                  <button
                    onClick={generateAICaption}
                    disabled={isGeneratingCaption}
                    className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-500 to-cyan-500 px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {isGeneratingCaption ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    AI Caption
                  </button>
                </div>

                <textarea
                  value={caption}
                  onChange={(event) => setCaption(event.target.value)}
                  placeholder="Write caption..."
                  className="h-32 w-full resize-none rounded-2xl border border-white/10 bg-slate-950/50 p-4 text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                />

                <div className="mt-4">
                  <HashtagPicker
                    selectedHashtags={hashtags}
                    onHashtagsChange={setHashtags}
                    caption={caption}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-semibold">Accounts</h3>
                    <p className="mt-1 text-sm text-white/55">
                      Default me sab selected hain.
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      setSelectedAccounts(
                        allSelected
                          ? []
                          : availableAccounts.map((account) => ({
                              ...account,
                              status: "pending",
                            })),
                      )
                    }
                    className="text-sm text-cyan-300 transition-colors hover:text-cyan-200"
                  >
                    {allSelected ? "Clear all" : "Select all"}
                  </button>
                </div>

                <div className="space-y-3">
                  {availableAccounts.map((account) => {
                    const active = selectedAccounts.some(
                      (item) => item.id === account.id,
                    );

                    return (
                      <button
                        key={`${account.platform}-${account.id}`}
                        onClick={() => toggleAccount(account)}
                        className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition-all ${
                          active
                            ? "border-cyan-400/40 bg-cyan-400/10"
                            : "border-white/10 bg-slate-950/30 hover:border-white/25"
                        }`}
                      >
                        {account.platform === "instagram" ? (
                          <Instagram className="h-5 w-5 text-pink-400" />
                        ) : (
                          <Youtube className="h-5 w-5 text-red-400" />
                        )}
                        <div className="flex-1">
                          <p className="font-medium">{account.username}</p>
                          <p className="text-xs capitalize text-white/45">
                            {account.platform}
                          </p>
                        </div>
                        {active && <CheckCircle className="h-5 w-5 text-cyan-300" />}
                      </button>
                    );
                  })}
                </div>

                <label className="mt-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-white/70">
                  <input
                    type="checkbox"
                    checked={deleteAfterPublish}
                    onChange={(event) => setDeleteAfterPublish(event.target.checked)}
                    className="h-4 w-4 rounded"
                  />
                  Delete from Cloudinary after successful publish on all selected accounts
                </label>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
                <button
                  onClick={publishToAccounts}
                  disabled={isPublishing || selectedAccounts.length === 0}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-fuchsia-600 to-cyan-500 px-6 py-4 font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPublishing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Publishing...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Publish to All Selected
                    </>
                  )}
                </button>

                <div className="mt-4 space-y-2">
                  {selectedAccounts.map((account) => (
                    <div
                      key={`${account.platform}-${account.id}`}
                      className={`flex items-center gap-3 rounded-2xl border p-3 ${
                        account.status === "success"
                          ? "border-green-500/30 bg-green-500/10 text-green-200"
                          : account.status === "error"
                            ? "border-red-500/30 bg-red-500/10 text-red-200"
                            : account.status === "uploading"
                              ? "border-blue-500/30 bg-blue-500/10 text-blue-200"
                              : "border-white/10 bg-slate-950/30 text-white/70"
                      }`}
                    >
                      {account.status === "success" ? (
                        <CheckCircle className="h-5 w-5" />
                      ) : account.status === "error" ? (
                        <XCircle className="h-5 w-5" />
                      ) : account.status === "uploading" ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Trash2 className="h-5 w-5 opacity-0" />
                      )}
                      <div>
                        <p className="font-medium">{account.username}</p>
                        {account.error && (
                          <p className="text-xs opacity-90">{account.error}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
