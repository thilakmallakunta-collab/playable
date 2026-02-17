import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { apiKey, imageDataUri } = body;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Anthropic API key is required" },
        { status: 400 }
      );
    }

    if (!imageDataUri) {
      return NextResponse.json(
        { error: "Image data is required" },
        { status: 400 }
      );
    }

    // Extract base64 data and mime type from data URI
    const matches = imageDataUri.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!matches) {
      return NextResponse.json(
        { error: "Invalid image data format" },
        { status: 400 }
      );
    }
    const mediaType = matches[1] as "image/png" | "image/jpeg" | "image/gif" | "image/webp";
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
            {
              type: "text",
              text: USER_PROMPT,
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    const description = textBlock && "text" in textBlock
      ? textBlock.text
      : "No description could be generated.";

    return NextResponse.json({
      success: true,
      description,
      model: response.model,
      tokens: response.usage.input_tokens + response.usage.output_tokens,
    });
  } catch (error: unknown) {
    console.error("Description error:", error);

    const message =
      error instanceof Error ? error.message : "Failed to generate description";

    if (message.includes("authentication") || message.includes("api_key") || message.includes("401")) {
      return NextResponse.json(
        { error: "Invalid Anthropic API key. Please check your key and try again." },
        { status: 401 }
      );
    }

    if (message.includes("rate_limit") || message.includes("429")) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please wait a moment and try again." },
        { status: 429 }
      );
    }

    if (message.includes("overloaded") || message.includes("529")) {
      return NextResponse.json(
        { error: "Claude is currently overloaded. Please try again in a moment." },
        { status: 529 }
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
