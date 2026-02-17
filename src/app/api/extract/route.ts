import { NextRequest, NextResponse } from "next/server";
import { extractImages } from "@/lib/extractImages";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!file.name.endsWith(".html") && !file.name.endsWith(".htm")) {
      return NextResponse.json(
        { error: "Please upload an HTML file (.html or .htm)" },
        { status: 400 }
      );
    }

    const htmlContent = await file.text();

    if (htmlContent.length === 0) {
      return NextResponse.json(
        { error: "The uploaded file is empty" },
        { status: 400 }
      );
    }

    const images = extractImages(htmlContent);

    return NextResponse.json({
      success: true,
      fileName: file.name,
      fileSize: file.size,
      imageCount: images.length,
      images,
      originalHtml: htmlContent,
    });
  } catch (error) {
    console.error("Extraction error:", error);
    return NextResponse.json(
      { error: "Failed to process the file. Please try again." },
      { status: 500 }
    );
  }
}
