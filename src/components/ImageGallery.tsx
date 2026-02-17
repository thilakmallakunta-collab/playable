"use client";

import { ExtractedImage } from "@/lib/extractImages";
import { formatFileSize } from "@/lib/extractImages";

interface ImageGalleryProps {
  images: ExtractedImage[];
  fileName: string;
  selectedIds: Set<string>;
  replacedIds: Set<string>;
  onImageClick: (image: ExtractedImage) => void;
  onToggleSelect: (imageId: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

function getSourceLabel(source: string): string {
  switch (source) {
    case "img-tag":
      return "IMG Tag";
    case "inline-style":
      return "Inline Style";
    case "style-block":
      return "CSS Block";
    case "raw-scan":
      return "Script/Raw";
    default:
      return source;
  }
}

function getSourceColor(source: string): string {
  switch (source) {
    case "img-tag":
      return "bg-blue-500/20 text-blue-400";
    case "inline-style":
      return "bg-green-500/20 text-green-400";
    case "style-block":
      return "bg-yellow-500/20 text-yellow-400";
    case "raw-scan":
      return "bg-purple-500/20 text-purple-400";
    default:
      return "bg-gray-500/20 text-gray-400";
  }
}

export default function ImageGallery({
  images,
  fileName,
  selectedIds,
  replacedIds,
  onImageClick,
  onToggleSelect,
  onSelectAll,
  onDeselectAll,
}: ImageGalleryProps) {
  const totalSize = images.reduce((sum, img) => sum + img.sizeBytes, 0);
  const allSelected = selectedIds.size === images.length;

  return (
    <div>
      {/* Stats bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6 p-4 bg-gray-900 rounded-xl border border-gray-800">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <svg
              className="w-5 h-5 text-green-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="text-sm text-gray-300">
              <strong className="text-white">{images.length}</strong> images in{" "}
              <strong className="text-white font-mono text-xs">
                {fileName}
              </strong>
            </span>
          </div>
          <div className="h-4 w-px bg-gray-700" />
          <span className="text-sm text-gray-400">
            Total: <strong className="text-gray-200">{formatFileSize(totalSize)}</strong>
          </span>
          {selectedIds.size > 0 && (
            <>
              <div className="h-4 w-px bg-gray-700" />
              <span className="text-sm text-purple-400 font-medium">
                {selectedIds.size} selected
              </span>
            </>
          )}
          {replacedIds.size > 0 && (
            <>
              <div className="h-4 w-px bg-gray-700" />
              <span className="text-sm text-green-400 font-medium">
                {replacedIds.size} replaced
              </span>
            </>
          )}
        </div>

        {/* Select controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={allSelected ? onDeselectAll : onSelectAll}
            className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
          >
            {allSelected ? "Deselect All" : "Select All"}
          </button>
        </div>
      </div>

      {/* Image grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {images.map((image) => {
          const isSelected = selectedIds.has(image.id);
          const isReplaced = replacedIds.has(image.id);

          return (
            <div
              key={image.id}
              className={`group relative bg-gray-900 border rounded-xl overflow-hidden transition-all duration-300 ${
                isSelected
                  ? "border-purple-500 shadow-lg shadow-purple-500/20 ring-1 ring-purple-500/30"
                  : isReplaced
                  ? "border-green-500/50"
                  : "border-gray-800 hover:border-gray-600"
              }`}
            >
              {/* Checkbox */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSelect(image.id);
                }}
                className={`absolute top-2 left-2 z-30 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${
                  isSelected
                    ? "bg-purple-600 border-purple-600"
                    : "bg-gray-900/70 border-gray-500 hover:border-purple-400"
                }`}
              >
                {isSelected && (
                  <svg
                    className="w-4 h-4 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={3}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </button>

              {/* Replaced badge */}
              {isReplaced && (
                <div className="absolute top-2 right-2 z-30 bg-green-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                  REPLACED
                </div>
              )}

              {/* Image container - click to open modal */}
              <button
                onClick={() => onImageClick(image)}
                className="w-full text-left"
              >
                <div className="aspect-square bg-[#1a1a2e] flex items-center justify-center p-2 relative overflow-hidden">
                  <div
                    className="absolute inset-0 opacity-20"
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
                    alt={`Extracted image ${image.id}`}
                    className="relative max-w-full max-h-full object-contain z-10"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-purple-600/0 group-hover:bg-purple-600/10 transition-colors duration-300 z-20 flex items-center justify-center">
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-sm font-medium bg-black/60 px-3 py-1 rounded-full">
                      Click to view
                    </span>
                  </div>
                </div>

                <div className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-400">
                      {formatFileSize(image.sizeBytes)}
                    </span>
                    <span
                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${getSourceColor(
                        image.source
                      )}`}
                    >
                      {getSourceLabel(image.source)}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-600 mt-1 font-mono truncate">
                    {image.mimeType}
                  </p>
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
