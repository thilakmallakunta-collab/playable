import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are an expert image analyst specializing in advertising creative assets, specifically playable ad graphics. 
Your task is to provide the most detailed, elaborate, and descriptive analysis possible of the given image.

Your description should cover ALL of the following aspects when applicable:

1. **Overall Composition**: Layout, visual hierarchy, focal points, and spatial arrangement
2. **Subject Matter**: What is depicted - characters, objects, scenes, UI elements, text
3. **Colors & Palette**: Dominant colors, color scheme, gradients, contrasts
4. **Typography**: Any text visible, font styles, sizes, emphasis
5. **Art Style**: Illustration style (flat, 3D, cartoon, realistic, pixel art, etc.)
6. **UI Elements**: Buttons, progress bars, indicators, game UI components
7. **Mood & Tone**: The emotional feel, energy level, target audience impression
8. **Branding**: Any logos, brand colors, brand-specific elements
9. **Technical Details**: Approximate dimensions feel, transparency, quality assessment
10. **Purpose in Ad**: What role this image likely plays in the playable ad (background, character sprite, button, icon, etc.)

Be extremely thorough and descriptive. Write in clear, professional language.`;

const USER_PROMPT =
  "Please provide the most detailed and elaborate description possible of this image from a playable ad:";

async function describeWithOpenAI(apiKey: string, imageDataUri: string) {
  const openai = new OpenAI({ apiKey });

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 4096,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: USER_PROMPT },
          { type: "image_url", image_url: { url: imageDataUri, detail: "high" } },
        ],
      },
    ],
  });

  return {
    description:
      response.choices[0]?.message?.content ||
      "No description could be generated.",
    model: response.model,
    tokens: response.usage?.total_tokens,
  };
}

async function describeWithGemini(apiKey: string, imageDataUri: string) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  // Extract base64 data and mime type from data URI
  const matches = imageDataUri.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!matches) {
    throw new Error("Invalid image data URI format");
  }
  const mimeType = matches[1];
  const base64Data = matches[2];

  const result = await model.generateContent([
    { text: SYSTEM_PROMPT + "\n\n" + USER_PROMPT },
    {
      inlineData: {
        mimeType,
        data: base64Data,
      },
    },
  ]);

  const response = result.response;
  const description = response.text() || "No description could be generated.";
  const tokens = response.usageMetadata?.totalTokenCount;

  return {
    description,
    model: "gemini-2.0-flash",
    tokens,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { apiKey, imageDataUri, provider = "gemini" } = body;

    if (!apiKey) {
      return NextResponse.json(
        { error: `${provider === "gemini" ? "Google Gemini" : "OpenAI"} API key is required` },
        { status: 400 }
      );
    }

    if (!imageDataUri) {
      return NextResponse.json(
        { error: "Image data is required" },
        { status: 400 }
      );
    }

    let result;

    if (provider === "openai") {
      result = await describeWithOpenAI(apiKey, imageDataUri);
    } else {
      result = await describeWithGemini(apiKey, imageDataUri);
    }

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: unknown) {
    console.error("Description error:", error);

    // OpenAI-specific errors
    if (error instanceof OpenAI.AuthenticationError) {
      return NextResponse.json(
        { error: "Invalid API key. Please check your key and try again." },
        { status: 401 }
      );
    }

    if (error instanceof OpenAI.RateLimitError) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please wait a moment and try again." },
        { status: 429 }
      );
    }

    const message =
      error instanceof Error ? error.message : "Failed to generate description";

    // Check for common Gemini errors
    if (message.includes("API_KEY_INVALID") || message.includes("API key not valid")) {
      return NextResponse.json(
        { error: "Invalid API key. Please check your key and try again." },
        { status: 401 }
      );
    }

    if (message.includes("RESOURCE_EXHAUSTED") || message.includes("quota")) {
      return NextResponse.json(
        { error: "Rate limit / quota exceeded. Please wait a moment and try again." },
        { status: 429 }
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
