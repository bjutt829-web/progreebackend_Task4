import { promises as fs } from "fs";
import path from "path";
import { jsonResponse } from "@/lib/services";

// GET /api/docs/docker-compose → returns the project's docker-compose.yml
// content so the dashboard can render the real, in-sync topology + compose file.
export async function GET() {
  try {
    const composePath = path.join(process.cwd(), "docker-compose.yml");
    const content = await fs.readFile(composePath, "utf-8");
    return jsonResponse({ content, path: "docker-compose.yml", bytes: content.length });
  } catch (e: unknown) {
    return jsonResponse(
      { error: "could not read docker-compose.yml", detail: e instanceof Error ? e.message : String(e) },
      404
    );
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
