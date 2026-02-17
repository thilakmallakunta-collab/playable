"use client";

import { ExtractedImage } from "@/lib/extractImages";
import { formatFileSize } from "@/lib/extractImages";

interface ImageGalleryProps {
  images: ExtractedImage[];
  fileName: string;
  onImageClick: (image: ExtractedImage) => void;
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
  onImageClick,
}: ImageGalleryProps) {
  const totalSize = images.reduce((sum, img) => sum + img.sizeBytes, 0);

  return (
    <div>
      {/* Stats bar */}
      <div className="flex flex-wrap items-center gap-4 mb-6 p-4 bg-gray-900 rounded-xl border border-gray-800">
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
            Found <strong className="text-white">{images.length}</strong> images
            in{" "}
            <strong className="text-white font-mono text-xs">{fileName}</strong>
          </span>
        </div>
        <div className="h-4 w-px bg-gray-700" />
        <span className="text-sm text-gray-400">
          Total size: <strong className="text-gray-200">{formatFileSize(totalSize)}</strong>
        </span>
      </div>

      {/* Image grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {images.map((image) => (
          <button
            key={image.id}
            onClick={() => onImageClick(image)}
            className="group relative bg-gray-900 border border-gray-800 rounded-xl overflow-hidden hover:border-purple-500/50 hover:shadow-lg hover:shadow-purple-500/10 transition-all duration-300 text-left"
          >
            {/* Image container */}
            <div className="aspect-square bg-[#1a1a2e] flex items-center justify-center p-2 relative overflow-hidden">
              {/* Checkerboard pattern for transparency */}
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
              {/* Hover overlay */}
              <div className="absolute inset-0 bg-purple-600/0 group-hover:bg-purple-600/10 transition-colors duration-300 z-20 flex items-center justify-center">
                <span className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-sm font-medium bg-black/60 px-3 py-1 rounded-full">
                  Click to view
                </span>
              </div>
            </div>

            {/* Image info */}
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
        ))}
      </div>
    </div>
  );
}
