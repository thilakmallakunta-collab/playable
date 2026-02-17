"use client";

import { useState, useCallback, useRef } from "react";

interface FileUploadProps {
  onUpload: (file: File) => void;
  isLoading: boolean;
}

export default function FileUpload({ onUpload, isLoading }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (
        file.name.endsWith(".html") ||
        file.name.endsWith(".htm") ||
        file.type === "text/html"
      ) {
        onUpload(file);
      } else {
        alert("Please upload an HTML file (.html or .htm)");
      }
    },
    [onUpload]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={() => fileInputRef.current?.click()}
      className={`
        relative cursor-pointer border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-300
        ${
          isDragging
            ? "border-purple-400 bg-purple-500/10 scale-[1.02]"
            : "border-gray-700 hover:border-gray-500 hover:bg-gray-900/50"
        }
        ${isLoading ? "pointer-events-none opacity-60" : ""}
      `}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".html,.htm"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      {isLoading ? (
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
          <p className="text-gray-400 text-lg">Scanning for images...</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gray-800 flex items-center justify-center">
            <svg
              className={`w-8 h-8 transition-colors ${
                isDragging ? "text-purple-400" : "text-gray-500"
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
          </div>
          <div>
            <p className="text-lg font-medium text-gray-200">
              Drop your playable ad HTML file here
            </p>
            <p className="text-sm text-gray-500 mt-1">
              or click to browse &middot; Accepts .html and .htm files
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
