import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

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

async function describeWithGroq(apiKey: string, imageDataUri: string) {
  const groq = new OpenAI({
    apiKey,
    baseURL: "https://api.groq.com/openai/v1",
  });

  const response = await groq.chat.completions.create({
    model: "llama-3.2-90b-vision-preview",
    max_tokens: 4096,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: USER_PROMPT },
          { type: "image_url", image_url: { url: imageDataUri } },
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

async function describeWithClaude(apiKey: string, imageDataUri: string) {
  const matches = imageDataUri.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!matches) {
    throw new Error("Invalid image data format");
  }
  const mediaType = matches[1] as
    | "image/png"
    | "image/jpeg"
    | "image/gif"
    | "image/webp";
  const base64Data = matches[2];

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: base64Data,
            },
          },
          { type: "text", text: USER_PROMPT },
        ],
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  const description =
    textBlock && "text" in textBlock
      ? textBlock.text
      : "No description could be generated.";

  return {
    description,
    model: response.model,
    tokens: response.usage.input_tokens + response.usage.output_tokens,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { apiKey, imageDataUri, provider = "groq" } = body;

    const providerNames: Record<string, string> = {
      groq: "Groq",
      claude: "Claude (Anthropic)",
    };

    if (!apiKey) {
      return NextResponse.json(
        {
          error: `${providerNames[provider] || provider} API key is required`,
        },
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

    if (provider === "claude") {
      result = await describeWithClaude(apiKey, imageDataUri);
    } else {
      result = await describeWithGroq(apiKey, imageDataUri);
    }

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: unknown) {
    console.error("Description error:", error);

    if (error instanceof OpenAI.AuthenticationError) {
      return NextResponse.json(
        { error: "Invalid API key. Please check your key and try again." },
        { status: 401 }
      );
    }

    if (error instanceof OpenAI.RateLimitError) {
      return NextResponse.json(
        {
          error: "Rate limit exceeded. Please wait a moment and try again.",
        },
        { status: 429 }
      );
    }

    const message =
      error instanceof Error
        ? error.message
        : "Failed to generate description";

    if (
      message.includes("authentication") ||
      message.includes("api_key") ||
      message.includes("401") ||
      message.includes("API_KEY_INVALID")
    ) {
      return NextResponse.json(
        { error: "Invalid API key. Please check your key and try again." },
        { status: 401 }
      );
    }

    if (
      message.includes("rate_limit") ||
      message.includes("429") ||
      message.includes("quota") ||
      message.includes("credit balance")
    ) {
      return NextResponse.json(
        {
          error:
            "Rate limit or billing issue. Please check your account or wait and try again.",
        },
        { status: 429 }
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
