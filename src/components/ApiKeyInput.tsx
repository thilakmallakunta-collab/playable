"use client";

import { useState, useEffect } from "react";

interface ApiKeyInputProps {
  onKeyChange: (key: string) => void;
}

export default function ApiKeyInput({ onKeyChange }: ApiKeyInputProps) {
  const [apiKey, setApiKey] = useState("");
  const [isVisible, setIsVisible] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    const savedKey = localStorage.getItem("anthropic-api-key");
    if (savedKey) {
      setApiKey(savedKey);
      onKeyChange(savedKey);
      setIsSaved(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = () => {
    if (apiKey.trim()) {
      localStorage.setItem("anthropic-api-key", apiKey.trim());
      onKeyChange(apiKey.trim());
      setIsSaved(true);
    }
  };

  const handleClear = () => {
    localStorage.removeItem("anthropic-api-key");
    setApiKey("");
    onKeyChange("");
    setIsSaved(false);
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <svg
          className="w-5 h-5 text-orange-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
          />
        </svg>
        <h3 className="text-sm font-semibold text-gray-300">
          Claude API Key
        </h3>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-900/50 text-orange-400">
          Anthropic
        </span>
        {isSaved && (
          <span className="text-xs bg-green-900/50 text-green-400 px-2 py-0.5 rounded-full">
            Saved
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={isVisible ? "text" : "password"}
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setIsSaved(false);
            }}
            placeholder="sk-ant-..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent pr-10"
          />
          <button
            type="button"
            onClick={() => setIsVisible(!isVisible)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
          >
            {isVisible ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            )}
          </button>
        </div>
        {!isSaved ? (
          <button
            onClick={handleSave}
            disabled={!apiKey.trim()}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Save
          </button>
        ) : (
          <button
            onClick={handleClear}
            className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 text-sm font-medium rounded-lg transition-colors"
          >
            Clear
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Get your key from{" "}
        <a
          href="https://console.anthropic.com/settings/keys"
          target="_blank"
          rel="noopener noreferrer"
          className="text-purple-400 hover:text-purple-300 underline"
        >
          console.anthropic.com
        </a>
        . Stored locally in your browser only.
      </p>
    </div>
  );
}
