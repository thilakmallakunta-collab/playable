"use client";

import { useState, useCallback } from "react";
import { ExtractedImage, formatFileSize } from "@/lib/extractImages";
import { AIProvider } from "./ApiKeyInput";

interface ImageModalProps {
  image: ExtractedImage;
  apiKey: string;
  provider: AIProvider;
  isReplaced: boolean;
  onClose: () => void;
  onReplace: (imageId: string, newDataUri: string) => void;
}

type ReplaceStep = "idle" | "describing" | "generating" | "done" | "error";

export default function ImageModal({
  image,
  apiKey,
  provider,
  isReplaced,
  onClose,
  onReplace,
}: ImageModalProps) {
  const [step, setStep] = useState<ReplaceStep>("idle");
  const [description, setDescription] = useState<string | null>(null);
  const [newImageUri, setNewImageUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const providerLabel = provider === "claude" ? "Claude" : "Groq";

  const handleDownload = useCallback(() => {
    const link = document.createElement("a");
    link.href = image.dataUri;
    const ext = image.mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
    link.download = `${image.id}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [image]);

  const handleReplace = useCallback(async () => {
    if (!apiKey) {
      setError(
        `Please enter your ${providerLabel} API key in the settings above first.`
      );
      return;
    }

    setError(null);
    setDescription(null);
    setNewImageUri(null);

    // Step 1: Describe the image
    setStep("describing");
    try {
      const descResponse = await fetch("/api/describe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          imageDataUri: image.dataUri,
          provider,
        }),
      });

      const descData = await descResponse.json();
      if (!descResponse.ok) {
        throw new Error(descData.error || "Failed to describe image");
      }

      setDescription(descData.description);

      // Step 2: Generate replacement image using the description
      setStep("generating");

      const genPrompt = `Create a high-quality game asset image similar to this description but with fresh creative variations: ${descData.description}. Style: clean digital art, game asset, transparent background if applicable, vibrant colors.`;

      const genResponse = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: genPrompt,
          width: 512,
          height: 512,
        }),
      });

      const genData = await genResponse.json();
      if (!genResponse.ok) {
        throw new Error(genData.error || "Failed to generate image");
      }

      setNewImageUri(genData.dataUri);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Replace failed");
      setStep("error");
    }
  }, [apiKey, image.dataUri, provider, providerLabel]);

  const handleConfirmReplace = useCallback(() => {
    if (newImageUri) {
      onReplace(image.id, newImageUri);
      onClose();
    }
  }, [newImageUri, image.id, onReplace, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-100">
              Image Details
            </h2>
            <span className="text-xs text-gray-500 font-mono">{image.id}</span>
            {isReplaced && (
              <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded-full font-bold">
                REPLACED
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-gray-200"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Images: side by side when we have a new image */}
          <div className={`grid ${newImageUri ? "grid-cols-2 gap-4" : "grid-cols-1"}`}>
            {/* Original image */}
            <div>
              <p className="text-xs text-gray-500 mb-2 text-center font-medium uppercase tracking-wider">
                {newImageUri ? "Original" : "Current Image"}
              </p>
              <div className="relative bg-[#1a1a2e] rounded-xl p-4 flex items-center justify-center min-h-[200px] max-h-[350px]">
                <div
                  className="absolute inset-0 rounded-xl opacity-20"
                  style={{
                    backgroundImage:
                      "linear-gradient(45deg, #333 25%, transparent 25%), linear-gradient(-45deg, #333 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #333 75%), linear-gradient(-45deg, transparent 75%, #333 75%)",
                    backgroundSize: "16px 16px",
                    backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
                  }}
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.dataUri}
                  alt="Original image"
                  className="relative max-w-full max-h-[330px] object-contain z-10"
                />
              </div>
            </div>

            {/* New image (after generation) */}
            {newImageUri && (
              <div>
                <p className="text-xs text-green-400 mb-2 text-center font-medium uppercase tracking-wider">
                  Replacement
                </p>
                <div className="relative bg-[#1a1a2e] rounded-xl p-4 flex items-center justify-center min-h-[200px] max-h-[350px] border border-green-500/30">
                  <div
                    className="absolute inset-0 rounded-xl opacity-20"
                    style={{
                      backgroundImage:
                        "linear-gradient(45deg, #333 25%, transparent 25%), linear-gradient(-45deg, #333 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #333 75%), linear-gradient(-45deg, transparent 75%, #333 75%)",
                      backgroundSize: "16px 16px",
                      backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
                    }}
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={newImageUri}
                    alt="Replacement image"
                    className="relative max-w-full max-h-[330px] object-contain z-10"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Image metadata */}
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="bg-gray-800/50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500">Size</p>
              <p className="text-sm font-medium text-gray-200">
                {formatFileSize(image.sizeBytes)}
              </p>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500">Format</p>
              <p className="text-sm font-medium text-gray-200">
                {image.mimeType.split("/")[1]?.toUpperCase()}
              </p>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500">Source</p>
              <p className="text-sm font-medium text-gray-200">
                {image.source}
              </p>
            </div>
          </div>

          {/* Progress indicator */}
          {(step === "describing" || step === "generating") && (
            <div className="mt-4 p-4 bg-purple-500/10 border border-purple-500/20 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
                <div>
                  <p className="text-sm font-medium text-purple-300">
                    {step === "describing"
                      ? `Step 1/2: Describing image with ${providerLabel}...`
                      : "Step 2/2: Generating replacement image..."}
                  </p>
                  <p className="text-xs text-purple-400/60 mt-0.5">
                    {step === "describing"
                      ? "Analyzing the image to create a description prompt"
                      : "Using AI to generate a fresh creative variation"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-6 flex gap-3">
            <button
              onClick={handleDownload}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-xl font-medium transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Download
            </button>

            {step === "done" && newImageUri ? (
              <button
                onClick={handleConfirmReplace}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-medium transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Confirm Replacement
              </button>
            ) : (
              <button
                onClick={handleReplace}
                disabled={step === "describing" || step === "generating"}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-600/50 text-white rounded-xl font-medium transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {step === "error" ? "Retry Replace" : "Replace"}
              </button>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-red-400">{error}</p>
              </div>
            </div>
          )}

          {/* Description used as prompt */}
          {description && (
            <div className="mt-4 p-4 bg-gray-800/50 border border-gray-700 rounded-xl">
              <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wider">
                Description used as generation prompt
              </p>
              <p className="text-xs text-gray-400 leading-relaxed line-clamp-4">
                {description}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
