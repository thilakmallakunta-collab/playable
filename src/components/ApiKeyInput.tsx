"use client";

import { useState, useEffect } from "react";

export type AIProvider = "groq" | "gemini" | "openai";

interface ApiKeyInputProps {
  onKeyChange: (key: string) => void;
  onProviderChange: (provider: AIProvider) => void;
}

const PROVIDERS = [
  {
    id: "groq" as AIProvider,
    name: "Groq",
    label: "Free",
    labelColor: "bg-green-900/50 text-green-400",
    placeholder: "gsk_...",
    helpUrl: "https://console.groq.com/keys",
    helpText: "Get a free key from Groq Console (generous free tier)",
  },
  {
    id: "gemini" as AIProvider,
    name: "Google Gemini",
    label: "Free",
    labelColor: "bg-green-900/50 text-green-400",
    placeholder: "AIza...",
    helpUrl: "https://aistudio.google.com/apikey",
    helpText: "Get a free key from Google AI Studio",
  },
  {
    id: "openai" as AIProvider,
    name: "OpenAI",
    label: "Paid",
    labelColor: "bg-yellow-900/50 text-yellow-400",
    placeholder: "sk-...",
    helpUrl: "https://platform.openai.com/api-keys",
    helpText: "Requires a paid OpenAI account",
  },
];

export default function ApiKeyInput({
  onKeyChange,
  onProviderChange,
}: ApiKeyInputProps) {
  const [provider, setProvider] = useState<AIProvider>("groq");
  const [apiKey, setApiKey] = useState("");
  const [isVisible, setIsVisible] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    const savedProvider =
      (localStorage.getItem("ai-provider") as AIProvider) || "groq";
    const savedKey = localStorage.getItem(`api-key-${savedProvider}`) || "";
    setProvider(savedProvider);
    onProviderChange(savedProvider);
    if (savedKey) {
      setApiKey(savedKey);
      onKeyChange(savedKey);
      setIsSaved(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const switchProvider = (newProvider: AIProvider) => {
    setProvider(newProvider);
    localStorage.setItem("ai-provider", newProvider);
    onProviderChange(newProvider);

    const savedKey = localStorage.getItem(`api-key-${newProvider}`) || "";
    setApiKey(savedKey);
    onKeyChange(savedKey);
    setIsSaved(!!savedKey);
  };

  const handleSave = () => {
    if (apiKey.trim()) {
      localStorage.setItem(`api-key-${provider}`, apiKey.trim());
      localStorage.setItem("ai-provider", provider);
      onKeyChange(apiKey.trim());
      setIsSaved(true);
    }
  };

  const handleClear = () => {
    localStorage.removeItem(`api-key-${provider}`);
    setApiKey("");
    onKeyChange("");
    setIsSaved(false);
  };

  const currentProvider = PROVIDERS.find((p) => p.id === provider)!;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      {/* Provider selector */}
      <div className="flex items-center gap-2 mb-3">
        <svg
          className="w-5 h-5 text-yellow-500"
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
        <h3 className="text-sm font-semibold text-gray-300">AI Provider</h3>
        {isSaved && (
          <span className="text-xs bg-green-900/50 text-green-400 px-2 py-0.5 rounded-full">
            Saved
          </span>
        )}
      </div>

      {/* Provider tabs */}
      <div className="flex gap-2 mb-3">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            onClick={() => switchProvider(p.id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
              provider === p.id
                ? "bg-purple-600/20 border border-purple-500/40 text-purple-300"
                : "bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-300 hover:border-gray-600"
            }`}
          >
            {p.name}
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full ${p.labelColor}`}
            >
              {p.label}
            </span>
          </button>
        ))}
      </div>

      {/* Key input */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={isVisible ? "text" : "password"}
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setIsSaved(false);
            }}
            placeholder={currentProvider.placeholder}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent pr-10"
          />
          <button
            type="button"
            onClick={() => setIsVisible(!isVisible)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
          >
            {isVisible ? (
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
                  d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21"
                />
              </svg>
            ) : (
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
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                />
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
        {currentProvider.helpText} &mdash;{" "}
        <a
          href={currentProvider.helpUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-purple-400 hover:text-purple-300 underline"
        >
          Get API Key
        </a>
        . Stored locally in your browser only.
      </p>
    </div>
  );
}
