import Anthropic from "@anthropic-ai/sdk";
import { parseStringPromise } from "xml2js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, "..", "data", "guests.json");

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const TBPN_CHANNEL_HANDLE = "@TBPNLive";

// --- YouTube Data Fetching ---

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
    videoId: item.snippet.resourceId.videoId,
    title: item.snippet.title,
    description: item.snippet.description,
    publishedAt: item.snippet.publishedAt,
  }));
}

async function fetchVideosFromYouTubeAPI() {
  if (!YOUTUBE_API_KEY) {
    throw new Error("YOUTUBE_API_KEY is required");
  }
  const channelId = await resolveChannelId();
  const uploadsPlaylistId = await getUploadsPlaylistId(channelId);
  return fetchRecentVideos(uploadsPlaylistId);
}

// --- RSS Feed Fallback ---

async function fetchVideosFromRSS(channelId) {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`RSS feed fetch failed: ${res.status}`);
  const xml = await res.text();
  const parsed = await parseStringPromise(xml);
  const entries = parsed.feed.entry || [];
  return entries.map((entry) => ({
    videoId: entry["yt:videoId"][0],
    title: entry.title[0],
    description: entry["media:group"]?.[0]?.["media:description"]?.[0] || "",
    publishedAt: entry.published[0],
  }));
}

// --- Claude API: Extract Guest Info ---

async function extractGuestInfo(videos) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required");
  }

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const videosText = videos
    .map(
      (v) =>
        `=== Video (${v.publishedAt}) ===\nTitle: ${v.title}\nDescription: ${v.description.slice(0, 1500)}`
    )
    .join("\n\n");

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are analyzing TBPN (Technology Business Programming Network) YouTube video data to extract guest interview information.

TBPN is a daily live tech show that interviews startup founders, CEOs, and tech figures. Each episode may feature multiple guest call-ins.

For each video below, extract ALL guests who were interviewed. For each guest, provide:
- guest: Full name of the guest
- company: The company they represent
- companyDescription: A brief (1-2 sentence) description of what the company does. If you don't know, write "Unknown - not enough info in video data."
- date: The date of the episode (YYYY-MM-DD format, from the publishedAt)
- videoId: The YouTube video ID

IMPORTANT:
- Skip hosts John Coogan and Jordi Hays - they are NOT guests
- Skip episodes that are just news commentary with no guest interviews
- If a video title says "Full Interview" with a specific person, that's definitely a guest
- Guest names often appear in video titles or descriptions

Return ONLY a valid JSON array. No markdown, no explanation. If no guests are found, return [].

Example output:
[
  {
    "guest": "Travis Kalanick",
    "company": "Atoms",
    "companyDescription": "Infrastructure company focused on mining and transportation, formerly known as CloudKitchens.",
    "date": "2026-03-13",
    "videoId": "abc123"
  }
]

Here are the videos to analyze:

${videosText}`,
      },
    ],
  });

  const text = response.content[0].text.trim();
  return JSON.parse(text);
}

// --- Data Management ---

function loadExistingGuests() {
  if (!existsSync(DATA_FILE)) return [];
  const raw = readFileSync(DATA_FILE, "utf-8");
  return JSON.parse(raw);
}

function mergeGuests(existing, newGuests) {
  const seen = new Set(
    existing.map((g) => `${g.guest}|${g.date}`)
  );

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

function saveGuests(guests) {
  writeFileSync(DATA_FILE, JSON.stringify(guests, null, 2) + "\n");
}

// --- Main ---

async function main() {
  console.log("Fetching recent TBPN videos...");

  let videos;
  try {
    videos = await fetchVideosFromYouTubeAPI();
    console.log(`Fetched ${videos.length} videos from YouTube API`);
  } catch (err) {
    console.warn(`YouTube API failed (${err.message}), this method requires YOUTUBE_API_KEY`);
    throw err;
  }

  if (videos.length === 0) {
    console.log("No videos found.");
    return;
  }

  console.log("Extracting guest info with Claude...");
  const newGuests = await extractGuestInfo(videos);
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
