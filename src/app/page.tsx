"use client";

import { useState, useCallback } from "react";
import FileUpload from "@/components/FileUpload";
import ImageGallery from "@/components/ImageGallery";
import ImageModal from "@/components/ImageModal";
import ApiKeyInput, { AIProvider } from "@/components/ApiKeyInput";
import { ExtractedImage } from "@/lib/extractImages";
import { replaceImageInHtml } from "@/lib/replaceImages";

interface ReplaceProgress {
  current: number;
  total: number;
  currentStep: "describing" | "generating";
  imageId: string;
}

export default function Home() {
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState<AIProvider>("groq");
  const [isLoading, setIsLoading] = useState(false);
  const [images, setImages] = useState<ExtractedImage[]>([]);
  const [fileName, setFileName] = useState("");
  const [originalHtml, setOriginalHtml] = useState("");
  const [modifiedHtml, setModifiedHtml] = useState("");
  const [selectedImage, setSelectedImage] = useState<ExtractedImage | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [replacedIds, setReplacedIds] = useState<Set<string>>(new Set());
  const [replacedMap, setReplacedMap] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [bulkReplacing, setBulkReplacing] = useState(false);
  const [replaceProgress, setReplaceProgress] = useState<ReplaceProgress | null>(null);

  const handleUpload = useCallback(async (file: File) => {
    setIsLoading(true);
    setError(null);
    setImages([]);
    setFileName("");
    setOriginalHtml("");
    setModifiedHtml("");
    setSelectedIds(new Set());
    setReplacedIds(new Set());
    setReplacedMap(new Map());

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
      setOriginalHtml(data.originalHtml);
      setModifiedHtml(data.originalHtml);

      if (data.images.length === 0) {
        setError("No images found in this file.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process the file");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleReset = useCallback(() => {
    setImages([]);
    setFileName("");
    setOriginalHtml("");
    setModifiedHtml("");
    setError(null);
    setSelectedImage(null);
    setSelectedIds(new Set());
    setReplacedIds(new Set());
    setReplacedMap(new Map());
  }, []);

  const handleToggleSelect = useCallback((imageId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(imageId)) {
        next.delete(imageId);
      } else {
        next.add(imageId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(images.map((img) => img.id)));
  }, [images]);

  const handleDeselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Single image replacement (from modal)
  const handleSingleReplace = useCallback(
    (imageId: string, newDataUri: string) => {
      const image = images.find((img) => img.id === imageId);
      if (!image) return;

      setModifiedHtml((prev) => replaceImageInHtml(prev, image.dataUri, newDataUri));
      setReplacedIds((prev) => new Set(prev).add(imageId));
      setReplacedMap((prev) => new Map(prev).set(imageId, newDataUri));

      // Update the image in the list to show the new version
      setImages((prev) =>
        prev.map((img) =>
          img.id === imageId ? { ...img, dataUri: newDataUri } : img
        )
      );
    },
    [images]
  );

  // Bulk replace selected images
  const handleBulkReplace = useCallback(async () => {
    if (!apiKey) {
      setError("Please enter your API key first.");
      return;
    }
    if (selectedIds.size === 0) {
      setError("Please select at least one image to replace.");
      return;
    }

    setBulkReplacing(true);
    setError(null);

    const selectedImages = images.filter((img) => selectedIds.has(img.id));
    let currentHtml = modifiedHtml;

    for (let i = 0; i < selectedImages.length; i++) {
      const image = selectedImages[i];

      try {
        // Step 1: Describe
        setReplaceProgress({
          current: i + 1,
          total: selectedImages.length,
          currentStep: "describing",
          imageId: image.id,
        });

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

        // Step 2: Generate
        setReplaceProgress({
          current: i + 1,
          total: selectedImages.length,
          currentStep: "generating",
          imageId: image.id,
        });

        const genPrompt = `Create a high-quality game asset image similar to this description but with fresh creative variations: ${descData.description}. Style: clean digital art, game asset, transparent background if applicable, vibrant colors.`;

        const genResponse = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: genPrompt, width: 512, height: 512 }),
        });

        const genData = await genResponse.json();
        if (!genResponse.ok) {
          throw new Error(genData.error || "Failed to generate image");
        }

        // Replace in HTML
        currentHtml = replaceImageInHtml(currentHtml, image.dataUri, genData.dataUri);

        // Update state
        setModifiedHtml(currentHtml);
        setReplacedIds((prev) => new Set(prev).add(image.id));
        setReplacedMap((prev) => new Map(prev).set(image.id, genData.dataUri));
        setImages((prev) =>
          prev.map((img) =>
            img.id === image.id ? { ...img, dataUri: genData.dataUri } : img
          )
        );
      } catch (err) {
        setError(
          `Failed on image ${image.id}: ${
            err instanceof Error ? err.message : "Unknown error"
          }. Continuing with remaining images...`
        );
      }
    }

    setBulkReplacing(false);
    setReplaceProgress(null);
    setSelectedIds(new Set());
  }, [apiKey, provider, selectedIds, images, modifiedHtml]);

  // Download modified HTML
  const handleDownloadAd = useCallback(() => {
    const blob = new Blob([modifiedHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const baseName = fileName.replace(/\.(html|htm)$/i, "");
    link.download = `${baseName}_modified.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [modifiedHtml, fileName]);

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-100">
                  Playable Ads Image Tool
                </h1>
                <p className="text-xs text-gray-500 hidden sm:block">
                  Extract, replace & download modified playable ads
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {replacedIds.size > 0 && (
                <button
                  onClick={handleDownloadAd}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Download Modified Ad
                </button>
              )}
              {images.length > 0 && (
                <button
                  onClick={handleReset}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  New File
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Upload section */}
        {images.length === 0 && (
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-gray-100 mb-3">
                Playable Ad Image Replacer
              </h2>
              <p className="text-gray-400 max-w-lg mx-auto">
                Upload a playable ad HTML file, select images to replace with
                AI-generated alternatives, then download the modified ad.
              </p>
            </div>

            <div className="grid grid-cols-4 gap-3 mb-8">
              {["Enter API key", "Upload HTML", "Select & Replace", "Download Ad"].map(
                (step, i) => (
                  <div key={i} className="text-center p-3">
                    <div className="w-9 h-9 rounded-full bg-purple-600/20 text-purple-400 flex items-center justify-center mx-auto mb-2 text-sm font-bold">
                      {i + 1}
                    </div>
                    <p className="text-xs text-gray-400">{step}</p>
                  </div>
                )
              )}
            </div>

            <ApiKeyInput onKeyChange={setApiKey} onProviderChange={setProvider} />
            <FileUpload onUpload={handleUpload} isLoading={isLoading} />

            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}
          </div>
        )}

        {/* Gallery section */}
        {images.length > 0 && (
          <div>
            <div className="mb-6">
              <ApiKeyInput onKeyChange={setApiKey} onProviderChange={setProvider} />
            </div>

            {/* Bulk replace bar */}
            {(selectedIds.size > 0 || bulkReplacing) && (
              <div className="mb-6 p-4 bg-purple-900/20 border border-purple-500/30 rounded-xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {bulkReplacing && replaceProgress ? (
                      <>
                        <div className="w-5 h-5 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
                        <div>
                          <p className="text-sm font-medium text-purple-300">
                            Replacing image {replaceProgress.current}/
                            {replaceProgress.total} ({replaceProgress.imageId})
                          </p>
                          <p className="text-xs text-purple-400/60">
                            {replaceProgress.currentStep === "describing"
                              ? "Describing image..."
                              : "Generating replacement..."}
                          </p>
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-purple-300">
                        <strong>{selectedIds.size}</strong> image
                        {selectedIds.size !== 1 ? "s" : ""} selected
                      </p>
                    )}
                  </div>

                  {!bulkReplacing && (
                    <button
                      onClick={handleBulkReplace}
                      className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Replace Selected
                    </button>
                  )}
                </div>

                {/* Progress bar */}
                {bulkReplacing && replaceProgress && (
                  <div className="mt-3 w-full bg-gray-800 rounded-full h-2">
                    <div
                      className="bg-purple-500 h-2 rounded-full transition-all duration-300"
                      style={{
                        width: `${(replaceProgress.current / replaceProgress.total) * 100}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <ImageGallery
              images={images}
              fileName={fileName}
              selectedIds={selectedIds}
              replacedIds={replacedIds}
              onImageClick={setSelectedImage}
              onToggleSelect={handleToggleSelect}
              onSelectAll={handleSelectAll}
              onDeselectAll={handleDeselectAll}
            />

            {/* Download bar at bottom */}
            {replacedIds.size > 0 && (
              <div className="mt-8 p-4 bg-green-900/20 border border-green-500/30 rounded-xl flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-green-300">
                    {replacedIds.size} image{replacedIds.size !== 1 ? "s" : ""}{" "}
                    replaced successfully
                  </p>
                  <p className="text-xs text-green-400/60">
                    Download the modified playable ad with all replacements
                    applied
                  </p>
                </div>
                <button
                  onClick={handleDownloadAd}
                  className="flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Download Modified Ad
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Image Modal */}
      {selectedImage && (
        <ImageModal
          image={selectedImage}
          apiKey={apiKey}
          provider={provider}
          isReplaced={replacedIds.has(selectedImage.id)}
          onClose={() => setSelectedImage(null)}
          onReplace={handleSingleReplace}
        />
      )}
    </main>
  );
}
