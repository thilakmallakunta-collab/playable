# Playable Ads Image Extractor & Describer

A tool to extract and analyze images from playable ad HTML files using OpenAI's vision capabilities.

## Features

- **Upload playable ad HTML files** (drag & drop or file picker)
- **Automatic image extraction** from `<img>` tags, CSS styles, inline styles, and JavaScript/raw content
- **Image gallery** with thumbnails, file size, format, and source info
- **Download** any extracted image individually
- **AI-powered image description** using OpenAI GPT-4o Vision - provides detailed, elaborate analysis of each image
- **Client-side API key storage** - your OpenAI key never leaves your browser (except for describe calls)

## Getting Started

### Prerequisites

- Node.js 18+
- An OpenAI API key with GPT-4o access

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Production Build

```bash
npm run build
npm start
```

## How It Works

1. **Enter your OpenAI API key** in the settings panel
2. **Upload a playable ad HTML file** - the tool scans for embedded images
3. **Browse the image gallery** - see all extracted images with metadata
4. **Click any image** to open the detail view
5. **Download** the image or **Describe** it using AI

## Tech Stack

- **Next.js 14** (App Router)
- **TypeScript**
- **Tailwind CSS**
- **Cheerio** (HTML parsing)
- **OpenAI SDK** (GPT-4o Vision)
