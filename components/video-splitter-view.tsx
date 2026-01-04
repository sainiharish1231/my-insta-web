"use client";

import type React from "react";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Upload,
  Scissors,
  Loader2,
  Check,
  Play,
  Pause,
  Download,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { splitVideoIntoShorts, type VideoSegment } from "@/lib/video-splitter";

interface VideoSplitterViewProps {
  onAddToQueue?: (segments: VideoSegment[]) => void;
}

export function VideoSplitterView({ onAddToQueue }: VideoSplitterViewProps) {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [segments, setSegments] = useState<VideoSegment[]>([]);
  const [previewSegment, setPreviewSegment] = useState<VideoSegment | null>(
    null
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("video/")) {
        toast.error("Please select a valid video file");
        return;
      }

      if (file.size > 500 * 1024 * 1024) {
        toast.error("Video file is too large. Maximum size is 500MB.");
        return;
      }

      setVideoFile(file);
      setSegments([]);
      toast.success("Video file loaded successfully");
    }
  };

  const handleSplitVideo = async () => {
    if (!videoFile) {
      toast.error("Please select a video file first");
      return;
    }

    setProcessing(true);
    setProgress(0);
    setStatus("Starting video processing...");

    try {
      const videoSegments = await splitVideoIntoShorts(videoFile, (prog) => {
        setProgress((prog.current / prog.total) * 100);
        setStatus(prog.status);
      });

      setSegments(videoSegments);
      toast.success(
        `Successfully created ${videoSegments.length} short videos!`
      );
    } catch (error) {
      console.error("Video splitting error:", error);
      toast.error(
        `Failed to split video: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    } finally {
      setProcessing(false);
    }
  };

  const handlePreviewSegment = (segment: VideoSegment) => {
    if (!segment.blob) {
      toast.error("Video segment not ready");
      return;
    }

    setPreviewSegment(segment);
    setIsPlaying(false);

    setTimeout(() => {
      if (videoPreviewRef.current) {
        if (videoPreviewRef.current.src) {
          URL.revokeObjectURL(videoPreviewRef.current.src);
        }
        const blobUrl = URL.createObjectURL(segment.blob!);
        videoPreviewRef.current.src = blobUrl;
        videoPreviewRef.current.load();
      }
    }, 100);
  };

  const handlePlayPause = () => {
    if (!videoPreviewRef.current) return;

    if (isPlaying) {
      videoPreviewRef.current.pause();
      setIsPlaying(false);
    } else {
      videoPreviewRef.current.play().catch((err) => {
        console.error("[v0] Play error:", err);
        toast.error("Failed to play video");
      });
      setIsPlaying(true);
    }
  };

  const handleDownloadSegment = (segment: VideoSegment) => {
    if (!segment.blob) return;

    const url = URL.createObjectURL(segment.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${segment.title.replace(/[^a-zA-Z0-9]/g, "_")}.webm`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Download started");
  };

  const handleEditTitle = (segment: VideoSegment) => {
    setEditingSegmentId(segment.id);
    setEditingTitle(segment.title);
  };

  const handleSaveTitle = () => {
    if (editingSegmentId && editingTitle.trim()) {
      setSegments((prev) =>
        prev.map((seg) =>
          seg.id === editingSegmentId
            ? { ...seg, title: editingTitle.trim() }
            : seg
        )
      );
      setEditingSegmentId(null);
      setEditingTitle("");
      toast.success("Title updated");
    }
  };

  const handleCancelEdit = () => {
    setEditingSegmentId(null);
    setEditingTitle("");
  };

  const handleAddAllToQueue = () => {
    if (segments.length === 0) {
      toast.error("No segments to add");
      return;
    }

    if (onAddToQueue) {
      onAddToQueue(segments);
      toast.success(`Added ${segments.length} shorts to upload queue!`);
      handleReset();
    }
  };

  const handleReset = () => {
    if (videoPreviewRef.current?.src) {
      URL.revokeObjectURL(videoPreviewRef.current.src);
    }
    setVideoFile(null);
    setSegments([]);
    setPreviewSegment(null);
    setProgress(0);
    setStatus("");
    setIsPlaying(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-orange-500 shadow-lg">
          <Scissors className="h-7 w-7 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-rose-500 to-orange-500 bg-clip-text text-transparent">
            Video Splitter
          </h1>
          <p className="text-muted-foreground mt-1">
            Split long videos into 30-second Instagram Reels-ready shorts
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Upload & Split Section */}
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" />
              Upload Video
            </CardTitle>
            <CardDescription>
              Select a video file (max 5 minutes, 500MB)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <Label>Video File</Label>
              <div className="flex gap-2">
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  onChange={handleFileSelect}
                  className="bg-secondary/50"
                />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-transparent shrink-0"
                >
                  <Upload className="h-4 w-4" />
                </Button>
              </div>

              {videoFile && (
                <Card className="bg-secondary/30 border-primary/20">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/20">
                        <Play className="h-6 w-6 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{videoFile.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {(videoFile.size / (1024 * 1024)).toFixed(2)} MB
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {processing && (
              <div className="space-y-3 py-4">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <p className="text-sm font-medium">{status}</p>
                </div>
                <Progress value={progress} className="h-2" />
                <p className="text-xs text-muted-foreground text-center">
                  {Math.round(progress)}% complete
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={handleSplitVideo}
                disabled={!videoFile || processing}
                className="flex-1 bg-gradient-to-r from-rose-500 to-orange-500 hover:from-rose-600 hover:to-orange-600"
              >
                {processing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Scissors className="mr-2 h-4 w-4" />
                    Split into 30s Shorts
                  </>
                )}
              </Button>
              {segments.length > 0 && (
                <Button
                  variant="outline"
                  onClick={handleReset}
                  className="bg-transparent"
                >
                  Reset
                </Button>
              )}
            </div>

            {segments.length > 0 && (
              <Button
                onClick={handleAddAllToQueue}
                className="w-full bg-primary"
                size="lg"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add All {segments.length} Shorts to Queue
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Preview Section */}
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="h-5 w-5 text-primary" />
              Video Preview
            </CardTitle>
            <CardDescription>
              Click on a segment below to preview
            </CardDescription>
          </CardHeader>
          <CardContent>
            {previewSegment ? (
              <div className="space-y-4">
                <div className="relative aspect-[9/16] bg-black rounded-lg overflow-hidden">
                  <video
                    ref={videoPreviewRef}
                    className="w-full h-full object-contain"
                    onEnded={() => setIsPlaying(false)}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    controls={false}
                  />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <Button
                      size="lg"
                      variant="secondary"
                      className="h-16 w-16 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur pointer-events-auto"
                      onClick={handlePlayPause}
                    >
                      {isPlaying ? (
                        <Pause className="h-8 w-8" />
                      ) : (
                        <Play className="h-8 w-8 ml-1" />
                      )}
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <h3 className="font-semibold">{previewSegment.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    Duration: {previewSegment.duration.toFixed(1)}s (
                    {formatDuration(previewSegment.startTime)} -{" "}
                    {formatDuration(previewSegment.endTime)})
                  </p>
                  <Button
                    variant="outline"
                    className="w-full bg-transparent"
                    onClick={() => handleDownloadSegment(previewSegment)}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download This Segment
                  </Button>
                </div>
              </div>
            ) : (
              <div className="aspect-[9/16] bg-secondary/30 rounded-lg flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <Play className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No segment selected</p>
                  <p className="text-sm">Click on a segment to preview</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Segments List */}
      {segments.length > 0 && (
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Scissors className="h-5 w-5 text-primary" />
                Generated Shorts ({segments.length})
              </span>
              <span className="text-sm font-normal text-muted-foreground">
                Total duration:{" "}
                {formatDuration(
                  segments.reduce((acc, s) => acc + s.duration, 0)
                )}
              </span>
            </CardTitle>
            <CardDescription>
              Click on any segment to preview or download. Click the title to
              edit.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px] pr-4">
              <div className="grid gap-3">
                {segments.map((segment, index) => (
                  <Card
                    key={segment.id}
                    className={`cursor-pointer transition-all hover:border-primary/50 ${
                      previewSegment?.id === segment.id
                        ? "border-primary bg-primary/5"
                        : "bg-secondary/30 border-border/50"
                    }`}
                    onClick={() => handlePreviewSegment(segment)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-rose-500 to-orange-500 text-white font-bold shrink-0">
                            {index + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            {editingSegmentId === segment.id ? (
                              <div
                                className="flex gap-2"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Input
                                  value={editingTitle}
                                  onChange={(e) =>
                                    setEditingTitle(e.target.value)
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") handleSaveTitle();
                                    if (e.key === "Escape") handleCancelEdit();
                                  }}
                                  className="h-8 text-sm"
                                  autoFocus
                                />
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={handleSaveTitle}
                                >
                                  <Check className="h-4 w-4" />
                                </Button>
                              </div>
                            ) : (
                              <p
                                className="font-medium truncate hover:text-primary"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditTitle(segment);
                                }}
                              >
                                {segment.title}
                              </p>
                            )}
                            <p className="text-sm text-muted-foreground">
                              {formatDuration(segment.startTime)} -{" "}
                              {formatDuration(segment.endTime)} (
                              {segment.duration.toFixed(1)}s)
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {segment.blob && (
                            <Check className="h-5 w-5 text-green-500" />
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownloadSegment(segment);
                            }}
                            disabled={!segment.blob}
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
