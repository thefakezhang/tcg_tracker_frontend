import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth }) }));

const fetchImage = vi.fn();
const request = (url: string) => new NextRequest(`https://app.example/api/proxy-image?url=${encodeURIComponent(url)}`);
const imageResponse = () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } });

beforeEach(() => {
  auth.getUser.mockResolvedValue({ data: { user: { id: "operator" } } });
  fetchImage.mockReset();
  vi.stubGlobal("fetch", fetchImage);
});
afterEach(() => vi.unstubAllGlobals());

describe("image export proxy route", () => {
  it("requires a session before making an upstream request", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null } });
    expect((await GET(request("https://images.example/card.png"))).status).toBe(401);
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it.each(["http://[fd00::1]/x", "http://[::ffff:127.0.0.1]/x", "http://foo.local/x", "https://user:pw@example.com/x"])("applies the shared policy to %s", async (url) => {
    fetchImage.mockResolvedValue(imageResponse());
    expect((await GET(request(url))).status).toBe(400);
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it("returns a public image with private caching", async () => {
    fetchImage.mockResolvedValue(imageResponse());
    const response = await GET(request("https://images.example/card.png"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("validates redirect destinations before following them", async () => {
    fetchImage.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://[fd00::1]/secret" } }));
    expect((await GET(request("https://images.example/card.png"))).status).toBe(400);
    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect(fetchImage.mock.calls[0][1].redirect).toBe("manual");
  });

  it("supports relative public redirects within the same deadline", async () => {
    fetchImage.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/new.png" } })).mockResolvedValueOnce(imageResponse());
    expect((await GET(request("https://images.example/card.png"))).status).toBe(200);
    expect(String(fetchImage.mock.calls[1][0])).toBe("https://images.example/new.png");
    expect(fetchImage.mock.calls[1][1].signal).toBe(fetchImage.mock.calls[0][1].signal);
  });

  it("bounds redirect loops", async () => {
    fetchImage.mockImplementation(async () => new Response(null, { status: 302, headers: { location: "/again.png" } }));
    expect((await GET(request("https://images.example/card.png"))).status).toBe(502);
    expect(fetchImage).toHaveBeenCalledTimes(6);
  });
});
