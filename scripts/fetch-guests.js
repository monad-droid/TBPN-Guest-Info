import Anthropic from "@anthropic-ai/sdk";
import { parseStringPromise } from "xml2js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, "..", "data", "guests.json");

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const TBPN_RSS_URL = "https://feeds.transistor.fm/technology-brother";

// --- RSS Feed (Primary — no API key needed) ---

export async function fetchEpisodesFromRSS() {
  const res = await fetch(TBPN_RSS_URL);
  if (!res.ok) throw new Error(`RSS feed fetch failed: ${res.status}`);
  const xml = await res.text();
  const parsed = await parseStringPromise(xml);
  const items = parsed.rss?.channel?.[0]?.item || [];

  return items.slice(0, 15).map((item) => ({
    title: item.title?.[0] || "",
    description: (item.description?.[0] || "").replace(/<[^>]*>/g, "").slice(0, 2000),
    publishedAt: item.pubDate?.[0] || "",
    link: item.link?.[0] || "",
  }));
}

// --- YouTube Data API (Optional — richer data, needs API key) ---

async function resolveChannelId() {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=TBPN+Live&key=${YOUTUBE_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube search failed: ${res.status}`);
  const data = await res.json();
  const channel = data.items?.find(
    (item) =>
      item.snippet.channelTitle.toLowerCase().includes("tbpn") ||
      item.snippet.title.toLowerCase().includes("tbpn")
  );
  if (!channel) throw new Error("Could not find TBPN channel");
  return channel.snippet.channelId;
}

async function getUploadsPlaylistId(channelId) {
  const url = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${YOUTUBE_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube channels API failed: ${res.status}`);
  const data = await res.json();
  return data.items[0].contentDetails.relatedPlaylists.uploads;
}

async function fetchRecentVideos(uploadsPlaylistId, maxResults = 15) {
  const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=${maxResults}&key=${YOUTUBE_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube playlistItems API failed: ${res.status}`);
  const data = await res.json();

  return data.items.map((item) => ({
    title: item.snippet.title,
    description: item.snippet.description,
    publishedAt: item.snippet.publishedAt,
    videoId: item.snippet.resourceId.videoId,
    link: `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`,
  }));
}

async function fetchEpisodesFromYouTubeAPI() {
  if (!YOUTUBE_API_KEY) {
    throw new Error("YOUTUBE_API_KEY is required");
  }
  const channelId = await resolveChannelId();
  const uploadsPlaylistId = await getUploadsPlaylistId(channelId);
  return fetchRecentVideos(uploadsPlaylistId);
}

// --- Claude API: Extract Guest Info ---

export async function extractGuestInfo(episodes) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required");
  }

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const episodesText = episodes
    .map(
      (e) =>
        `=== Episode (${e.publishedAt}) ===\nTitle: ${e.title}\nLink: ${e.link || "N/A"}\nDescription: ${e.description.slice(0, 1500)}`
    )
    .join("\n\n");

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are analyzing TBPN (Technology Business Programming Network) episode data to extract guest interview information.

TBPN is a daily live tech show hosted by John Coogan and Jordi Hays that interviews startup founders, CEOs, and tech figures. Each episode may feature multiple guest call-ins.

TBPN episode titles follow this format:
  "Topic 1, Topic 2, Topic 3 | Guest Name 1, Guest Name 2, Guest Name 3"

The part AFTER the pipe (|) contains comma-separated guest names.
Episodes titled "Diet TBPN" are highlight reels with no new guest info — skip them.

For each episode below, extract ALL guests who were interviewed. For each guest, provide:
- guest: Full name of the guest
- company: The company they represent (use your knowledge of the tech/business world)
- companyDescription: Exactly ONE sentence describing what the company does. Keep it short and clear. Use your knowledge. If you truly don't know, write "Company description not available."
- date: The date of the episode (YYYY-MM-DD format)
- episodeLink: The link to the episode

IMPORTANT:
- Skip hosts John Coogan and Jordi Hays — they are NOT guests
- Skip "Diet TBPN" episodes
- Guest names are usually listed after the "|" in the title
- Some high-profile guests appear in the topic portion (e.g., "Travis Kalanick Joins...")
- Use your knowledge to identify the company for well-known founders/CEOs

Return ONLY a valid JSON array. No markdown, no explanation. If no guests are found, return [].

Example output:
[
  {
    "guest": "Travis Kalanick",
    "company": "Atoms",
    "companyDescription": "Infrastructure company focused on mining and transportation, formerly known as CloudKitchens.",
    "date": "2026-03-13",
    "episodeLink": "https://example.com/episode"
  }
]

Here are the episodes to analyze:

${episodesText}`,
      },
    ],
  });

  const text = response.content[0].text.trim();
  return JSON.parse(text);
}

// --- Data Management ---

export function loadExistingGuests() {
  if (!existsSync(DATA_FILE)) return [];
  const raw = readFileSync(DATA_FILE, "utf-8");
  return JSON.parse(raw);
}

export function mergeGuests(existing, newGuests) {
  const seen = new Set(existing.map((g) => `${g.guest}|${g.date}`));

  const merged = [...existing];
  for (const guest of newGuests) {
    const key = `${guest.guest}|${guest.date}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(guest);
    }
  }

  merged.sort((a, b) => b.date.localeCompare(a.date));
  return merged;
}

export function saveGuests(guests) {
  writeFileSync(DATA_FILE, JSON.stringify(guests, null, 2) + "\n");
}

// --- Main ---

async function main() {
  console.log("Fetching recent TBPN episodes...");

  let episodes;

  // Try RSS feed first (no API key needed), fall back to YouTube API
  try {
    episodes = await fetchEpisodesFromRSS();
    console.log(`Fetched ${episodes.length} episodes from RSS feed`);
  } catch (rssErr) {
    console.warn(`RSS feed failed (${rssErr.message}), trying YouTube API...`);
    try {
      episodes = await fetchEpisodesFromYouTubeAPI();
      console.log(`Fetched ${episodes.length} episodes from YouTube API`);
    } catch (ytErr) {
      console.error(`YouTube API also failed: ${ytErr.message}`);
      console.error("Set YOUTUBE_API_KEY for YouTube API fallback.");
      throw rssErr;
    }
  }

  if (episodes.length === 0) {
    console.log("No episodes found.");
    return;
  }

  console.log("Extracting guest info with Claude...");
  const newGuests = await extractGuestInfo(episodes);
  console.log(`Extracted ${newGuests.length} guest appearances`);

  const existing = loadExistingGuests();
  const merged = mergeGuests(existing, newGuests);
  const added = merged.length - existing.length;

  saveGuests(merged);
  console.log(
    `Done. ${added} new guest(s) added. Total: ${merged.length} guests in database.`
  );
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
