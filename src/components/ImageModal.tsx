"use client";

import { useState, useCallback } from "react";
import { ExtractedImage, formatFileSize } from "@/lib/extractImages";

interface ImageModalProps {
  image: ExtractedImage;
  apiKey: string;
  onClose: () => void;
}

export default function ImageModal({
  image,
  apiKey,
  onClose,
}: ImageModalProps) {
  const [description, setDescription] = useState<string | null>(null);
  const [isDescribing, setIsDescribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenCount, setTokenCount] = useState<number | null>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);

  const handleDownload = useCallback(() => {
    const link = document.createElement("a");
    link.href = image.dataUri;
    const ext = image.mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
    link.download = `${image.id}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [image]);

  const handleDescribe = useCallback(async () => {
    if (!apiKey) {
      setError(
        "Please enter your Claude API key in the settings above first."
      );
      return;
    }

    setIsDescribing(true);
    setError(null);
    setDescription(null);

    try {
      const response = await fetch("/api/describe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          imageDataUri: image.dataUri,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to describe image");
      }

      setDescription(data.description);
      setTokenCount(data.tokens || null);
      setModelUsed(data.model || null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to describe image"
      );
    } finally {
      setIsDescribing(false);
    }
  }, [apiKey, image.dataUri]);

  const handleCopyDescription = useCallback(() => {
    if (description) {
      navigator.clipboard.writeText(description);
    }
  }, [description]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-100">
              Image Details
            </h2>
            <span className="text-xs text-gray-500 font-mono">{image.id}</span>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-gray-200"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Image display */}
          <div className="relative bg-[#1a1a2e] rounded-xl p-4 flex items-center justify-center min-h-[200px] max-h-[400px]">
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
              alt="Selected image"
              className="relative max-w-full max-h-[380px] object-contain z-10"
            />
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

          {/* Action buttons */}
          <div className="mt-6 flex gap-3">
            <button
              onClick={handleDownload}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-xl font-medium transition-colors"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              Download
            </button>
            <button
              onClick={handleDescribe}
              disabled={isDescribing}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-600/50 text-white rounded-xl font-medium transition-colors"
            >
              {isDescribing ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Analyzing with Claude...
                </>
              ) : (
                <>
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                    />
                  </svg>
                  Describe with Claude
                </>
              )}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
              <div className="flex items-start gap-2">
                <svg
                  className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <p className="text-sm text-red-400">{error}</p>
              </div>
            </div>
          )}

          {/* Description result */}
          {description && (
            <div className="mt-4 p-5 bg-gray-800/50 border border-gray-700 rounded-xl">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <svg
                    className="w-4 h-4 text-orange-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                    />
                  </svg>
                  <h3 className="text-sm font-semibold text-orange-400">
                    Claude Description
                  </h3>
                  {modelUsed && (
                    <span className="text-[10px] text-gray-500 bg-gray-700/50 px-1.5 py-0.5 rounded">
                      {modelUsed}
                    </span>
                  )}
                  {tokenCount && (
                    <span className="text-[10px] text-gray-500">
                      {tokenCount} tokens
                    </span>
                  )}
                </div>
                <button
                  onClick={handleCopyDescription}
                  className="text-xs text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                  Copy
                </button>
              </div>
              <div className="description-content text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                {description}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
