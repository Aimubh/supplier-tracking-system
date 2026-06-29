// AI Q&A for the Telegram bot — answers free-text questions about the data by
// letting Claude call READ-ONLY database tools (src/lib/bot-db-tools.ts).
//
// Safety: Claude can only invoke the curated tools below, every one of which
// READS. It cannot run raw SQL, write, or reach anything outside these functions.
// Requires ANTHROPIC_API_KEY. Uses the SDK tool runner so the agentic loop
// (call tool → feed result → answer) is handled automatically.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import {
  listProducts, getProduct, financialSummary, pipelineOverview, searchManufacturers,
} from "./bot-db-tools";

export function qaConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const PHASE = z.enum(["pre-order", "on-working", "post-order", "done"]);

// Read-only tools Claude may call. Each wraps a function from bot-db-tools.
const tools = [
  betaZodTool({
    name: "list_products",
    description:
      "List/count active products in the sourcing pipeline. Optionally filter by phase " +
      "(pre-order, on-working, post-order, done) or category. Use for questions like " +
      "'how many products are in QC', 'what's in post-order', 'list electronics products'.",
    inputSchema: z.object({
      phase: PHASE.optional().describe("Filter to one pipeline phase"),
      category: z.string().optional().describe("Filter by product category (partial match)"),
      includeFiled: z.boolean().optional().describe("Include archived/filed products (default false)"),
    }),
    run: async (input) => JSON.stringify(await listProducts(input)),
  }),
  betaZodTool({
    name: "get_product",
    description:
      "Get full detail for ONE product by name (partial, case-insensitive) or id: phase, " +
      "progress %, supplier, HS code, compliance, quantity, order value, advance paid, " +
      "expenses, ETA, arrival status. Use for 'tell me about the X product', 'status of Y'.",
    inputSchema: z.object({
      nameOrId: z.string().describe("Product name (partial ok) or exact id"),
    }),
    run: async (input) => JSON.stringify(await getProduct(input.nameOrId)),
  }),
  betaZodTool({
    name: "pipeline_overview",
    description:
      "Counts of active products in each pipeline phase (pre-order / on-working / post-order / done). " +
      "Use for 'how's the pipeline', 'where are all my products', overview questions.",
    inputSchema: z.object({}),
    run: async () => JSON.stringify(await pipelineOverview()),
  }),
  betaZodTool({
    name: "financial_summary",
    description:
      "Portfolio financial totals across active products, grouped by currency: total order value, " +
      "advance paid, expenses, product count. Use for 'total order value', 'how much have we paid', " +
      "'total expenses'. Note: totals are per-currency (not converted).",
    inputSchema: z.object({}),
    run: async () => JSON.stringify(await financialSummary()),
  }),
  betaZodTool({
    name: "search_manufacturers",
    description:
      "Search the manufacturer/supplier directory by name, city, type, or product lines. Returns " +
      "name, type, verification, city, rep contact, rating, MOQ, notes. Use for 'find suppliers in " +
      "Shenzhen', 'which manufacturers make bottles', 'is supplier X verified'.",
    inputSchema: z.object({
      query: z.string().describe("Search text — supplier name, city, product, etc. Empty = list all."),
    }),
    run: async (input) => JSON.stringify(await searchManufacturers(input.query)),
  }),
];

const SYSTEM = `You are the assistant for Lazer Believe's Supplier Tracking System — an internal app that tracks products sourced from China through a gated pipeline (Pre-Order → On-Working → Post-Order).

Answer the user's question using ONLY the database tools provided. Rules:
- Call tools to get real data; never invent products, numbers, or suppliers.
- Be concise and use plain language — this is a Telegram reply. Use short lines, not long paragraphs.
- Money: show the currency (₹/$/¥) the data uses; don't convert between currencies unless asked.
- If the tools return nothing relevant, say so plainly and suggest what they could ask instead.
- You can READ data only. If asked to change/add/delete anything, explain you can only answer questions, not modify data.
- Format for Telegram: short, scannable, emoji sparingly. No markdown tables.`;

// Answer a free-text question. Returns the reply text (already Telegram-friendly).
export async function answerQuestion(question: string): Promise<string> {
  if (!qaConfigured()) {
    return "🤖 Q&A isn't configured yet (missing ANTHROPIC_API_KEY).";
  }
  const client = new Anthropic();
  try {
    const final = await client.beta.messages.toolRunner({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      system: SYSTEM,
      tools,
      messages: [{ role: "user", content: question }],
    });
    // Collect the text blocks from the final assistant message.
    const text = final.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return text || "I couldn't find an answer for that. Try asking about products, suppliers, or totals.";
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return `⚠️ Couldn't answer that right now (${msg}).`;
  }
}
