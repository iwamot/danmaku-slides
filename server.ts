import fs from "node:fs/promises";
import path from "node:path";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

type Comment = { id: number; text: string; color: string | null };
type Feed = { comments: Comment[]; lastId: number };

/** The GAS Web App URL is a bearer secret, so it is never committed: it is read
 *  from the COMMENTS_FEED_URL environment variable (see .env.sample). */
function getFeedUrl(): string | null {
  return process.env.COMMENTS_FEED_URL?.trim() || null;
}

async function fetchFeed(url: string | null, since: number): Promise<Feed> {
  if (!url) return { comments: [], lastId: since };
  const res = await fetch(`${url}?mode=feed&since=${since}`);
  if (!res.ok) throw new Error(`feed responded ${res.status}`);
  const data = (await res.json()) as Feed;
  return { comments: data.comments ?? [], lastId: data.lastId ?? since };
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "Danmaku Slides MCP App Server",
    version: "0.1.0",
  });

  const resourceUri = "ui://danmaku-slides/mcp-app.html";

  /** UI metadata for the resource. Hosts read csp from the resources/read
   *  content item first and treat the resources/list entry as a fallback, so
   *  the same object is attached to both. */
  const resourceUiMeta = {
    prefersBorder: true,
    csp: {
      resourceDomains: ["https://cdn.jsdelivr.net"],
      connectDomains: ["https://cdn.jsdelivr.net"],
    },
  };

  registerAppTool(
    server,
    "present",
    {
      title: "Present",
      description:
        "Open the danmaku slides view: a PDF slide presenter that overlays live audience comments scrolling across the slide.",
      inputSchema: {},
      outputSchema: z.object({ ok: z.boolean() }),
      _meta: { ui: { resourceUri, visibility: ["model"] } },
    },
    async (): Promise<CallToolResult> => {
      return {
        content: [
          {
            type: "text",
            text: "Opened the danmaku slides presenter; the slide and live comment overlay render in the view, which requires an MCP Apps-capable host.",
          },
        ],
        structuredContent: { ok: true },
      };
    },
  );

  // App-only: the view polls this via callServerTool; the model never needs it.
  registerAppTool(
    server,
    "fetch_comments",
    {
      title: "Fetch comments",
      description:
        "Fetch new audience comments (those with id greater than `since`) for the presenter danmaku. " +
        "The view polls this and renders new comments itself; the model does not need to read them.",
      inputSchema: {
        since: z.number().int().nonnegative().optional(),
      },
      outputSchema: z.object({
        comments: z.array(
          z.object({
            id: z.number(),
            text: z.string(),
            color: z.string().nullable(),
          }),
        ),
        lastId: z.number(),
      }),
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ since }): Promise<CallToolResult> => {
      const sinceId = since ?? 0;
      const empty: Feed = { comments: [], lastId: sinceId };
      const url = getFeedUrl();
      const result = await fetchFeed(url, sinceId).catch((err: unknown) => {
        console.error("fetch_comments failed:", err);
        return empty;
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    {
      mimeType: RESOURCE_MIME_TYPE,
      _meta: { ui: resourceUiMeta },
    },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");

      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: { ui: resourceUiMeta },
          },
        ],
      };
    },
  );

  return server;
}
