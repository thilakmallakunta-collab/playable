import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { apiKey, imageDataUri } = body;

    if (!apiKey) {
      return NextResponse.json(
        { error: "OpenAI API key is required" },
        { status: 400 }
      );
    }

    if (!imageDataUri) {
      return NextResponse.json(
        { error: "Image data is required" },
        { status: 400 }
      );
    }

    const openai = new OpenAI({ apiKey });

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 4096,
      messages: [
        {
          role: "system",
          content: `You are an expert image analyst specializing in advertising creative assets, specifically playable ad graphics. 
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

Be extremely thorough and descriptive. Write in clear, professional language.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Please provide the most detailed and elaborate description possible of this image from a playable ad:",
            },
            {
              type: "image_url",
              image_url: {
                url: imageDataUri,
                detail: "high",
              },
            },
          ],
        },
      ],
    });

    const description =
      response.choices[0]?.message?.content ||
      "No description could be generated.";

    return NextResponse.json({
      success: true,
      description,
      model: response.model,
      tokens: response.usage?.total_tokens,
    });
  } catch (error: unknown) {
    console.error("Description error:", error);

    if (error instanceof OpenAI.AuthenticationError) {
      return NextResponse.json(
        { error: "Invalid OpenAI API key. Please check your key and try again." },
        { status: 401 }
      );
    }

    if (error instanceof OpenAI.RateLimitError) {
      return NextResponse.json(
        { error: "OpenAI rate limit exceeded. Please wait a moment and try again." },
        { status: 429 }
      );
    }

    const message =
      error instanceof Error ? error.message : "Failed to generate description";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
