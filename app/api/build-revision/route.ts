import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ revision: process.env.VERCEL_GIT_COMMIT_SHA ?? null });
}
