"use client";

import { useState, useCallback } from "react";
import FileUpload from "@/components/FileUpload";
import ImageGallery from "@/components/ImageGallery";
import ImageModal from "@/components/ImageModal";
import ApiKeyInput from "@/components/ApiKeyInput";
import { ExtractedImage } from "@/lib/extractImages";

export default function Home() {
  const [apiKey, setApiKey] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [images, setImages] = useState<ExtractedImage[]>([]);
  const [fileName, setFileName] = useState("");
  const [selectedImage, setSelectedImage] = useState<ExtractedImage | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const handleUpload = useCallback(async (file: File) => {
    setIsLoading(true);
    setError(null);
    setImages([]);
    setFileName("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/extract", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to extract images");
      }

      setImages(data.images);
      setFileName(data.fileName);

      if (data.images.length === 0) {
        setError(
          "No images found in this file. Make sure it's a playable ad HTML file with embedded images."
        );
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to process the file"
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleReset = useCallback(() => {
    setImages([]);
    setFileName("");
    setError(null);
    setSelectedImage(null);
  }, []);

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-500 to-orange-500 flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-100">
                  Playable Ads Image Tool
                </h1>
                <p className="text-xs text-gray-500 hidden sm:block">
                  Extract & describe images with Claude Vision
                </p>
              </div>
            </div>

            {images.length > 0 && (
              <button
                onClick={handleReset}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg transition-colors"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                New File
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* API Key + Upload section */}
        {images.length === 0 && (
          <div className="max-w-2xl mx-auto space-y-6">
            {/* Hero */}
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-gray-100 mb-3">
                Playable Ad Image Extractor
              </h2>
              <p className="text-gray-400 max-w-lg mx-auto">
                Upload a playable ad HTML file to extract all embedded images.
                Then describe any image in detail using Claude Vision.
              </p>
            </div>

            {/* Steps */}
            <div className="grid grid-cols-3 gap-4 mb-8">
              <div className="text-center p-4">
                <div className="w-10 h-10 rounded-full bg-purple-600/20 text-purple-400 flex items-center justify-center mx-auto mb-2 text-sm font-bold">
                  1
                </div>
                <p className="text-xs text-gray-400">
                  Enter your Claude API key
                </p>
              </div>
              <div className="text-center p-4">
                <div className="w-10 h-10 rounded-full bg-purple-600/20 text-purple-400 flex items-center justify-center mx-auto mb-2 text-sm font-bold">
                  2
                </div>
                <p className="text-xs text-gray-400">
                  Upload playable ad HTML
                </p>
              </div>
              <div className="text-center p-4">
                <div className="w-10 h-10 rounded-full bg-purple-600/20 text-purple-400 flex items-center justify-center mx-auto mb-2 text-sm font-bold">
                  3
                </div>
                <p className="text-xs text-gray-400">
                  View, download & describe
                </p>
              </div>
            </div>

            <ApiKeyInput onKeyChange={setApiKey} />

            <FileUpload onUpload={handleUpload} isLoading={isLoading} />

            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
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
          </div>
        )}

        {/* Gallery section */}
        {images.length > 0 && (
          <div>
            <div className="mb-6">
              <ApiKeyInput onKeyChange={setApiKey} />
            </div>

            <ImageGallery
              images={images}
              fileName={fileName}
              onImageClick={setSelectedImage}
            />
          </div>
        )}
      </div>

      {/* Image Modal */}
      {selectedImage && (
        <ImageModal
          image={selectedImage}
          apiKey={apiKey}
          onClose={() => setSelectedImage(null)}
        />
      )}
    </main>
  );
}
