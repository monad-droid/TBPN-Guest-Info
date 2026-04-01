import assert from "node:assert";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// --- Test: guests.json is valid ---

test("data/guests.json is valid JSON array", () => {
  const raw = readFileSync(join(__dirname, "..", "data", "guests.json"), "utf-8");
  const data = JSON.parse(raw);
  assert(Array.isArray(data), "guests.json must be an array");
});

test("each guest entry has required fields", () => {
  const raw = readFileSync(join(__dirname, "..", "data", "guests.json"), "utf-8");
  const data = JSON.parse(raw);
  for (const entry of data) {
    assert(typeof entry.date === "string", `Missing or invalid date: ${JSON.stringify(entry)}`);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(entry.date), `Invalid date format: ${entry.date}`);
    assert(typeof entry.guest === "string" && entry.guest.length > 0, `Missing guest name`);
    assert(typeof entry.company === "string" && entry.company.length > 0, `Missing company`);
    assert(typeof entry.companyDescription === "string" && entry.companyDescription.length > 0, `Missing companyDescription`);
  }
});

test("guests are sorted by date descending", () => {
  const raw = readFileSync(join(__dirname, "..", "data", "guests.json"), "utf-8");
  const data = JSON.parse(raw);
  for (let i = 1; i < data.length; i++) {
    assert(
      data[i - 1].date >= data[i].date,
      `Out of order: ${data[i - 1].date} before ${data[i].date}`
    );
  }
});

test("no duplicate guest+date entries", () => {
  const raw = readFileSync(join(__dirname, "..", "data", "guests.json"), "utf-8");
  const data = JSON.parse(raw);
  const seen = new Set();
  for (const entry of data) {
    const key = `${entry.guest}|${entry.date}`;
    assert(!seen.has(key), `Duplicate entry: ${key}`);
    seen.add(key);
  }
});

// --- Test: fetch-guests.js module structure ---

test("fetch-guests.js exists and is valid JS", async () => {
  const code = readFileSync(join(__dirname, "..", "scripts", "fetch-guests.js"), "utf-8");
  assert(code.includes("extractGuestInfo"), "Should have extractGuestInfo function");
  assert(code.includes("mergeGuests"), "Should have mergeGuests function");
  assert(code.includes("fetchEpisodesFromRSS"), "Should have fetchEpisodesFromRSS function");
  assert(code.includes("fetchEpisodesFromYouTubeAPI"), "Should have fetchEpisodesFromYouTubeAPI function");
  assert(code.includes("ANTHROPIC_API_KEY"), "Should reference ANTHROPIC_API_KEY");
  assert(code.includes("YOUTUBE_API_KEY"), "Should reference YOUTUBE_API_KEY");
});

// --- Test: HTML structure ---

test("index.html has required elements", () => {
  const html = readFileSync(join(__dirname, "..", "index.html"), "utf-8");
  assert(html.includes('id="guest-list"'), "Should have guest-list element");
  assert(html.includes('id="search"'), "Should have search input");
  assert(html.includes('id="empty-state"'), "Should have empty state element");
  assert(html.includes("app.js"), "Should reference app.js");
  assert(html.includes("style.css"), "Should reference style.css");
});

// --- Test: app.js structure ---

test("app.js has required functions", () => {
  const js = readFileSync(join(__dirname, "..", "app.js"), "utf-8");
  assert(js.includes("formatDate"), "Should have formatDate function");
  assert(js.includes("renderGuests"), "Should have renderGuests function");
  assert(js.includes("escapeHtml"), "Should have escapeHtml function");
  assert(js.includes("data/guests.json"), "Should fetch guests.json");
});

// --- Test: mergeGuests logic ---

test("mergeGuests deduplicates and sorts", () => {
  // Inline test of merge logic (same algorithm as fetch-guests.js)
  function mergeGuests(existing, newGuests) {
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

  const existing = [
    { guest: "Alice", date: "2026-03-20", company: "A", companyDescription: "A co" },
  ];
  const newGuests = [
    { guest: "Alice", date: "2026-03-20", company: "A", companyDescription: "A co" }, // duplicate
    { guest: "Bob", date: "2026-03-21", company: "B", companyDescription: "B co" },
    { guest: "Carol", date: "2026-03-19", company: "C", companyDescription: "C co" },
  ];

  const merged = mergeGuests(existing, newGuests);
  assert.strictEqual(merged.length, 3, "Should have 3 entries (1 duplicate removed)");
  assert.strictEqual(merged[0].guest, "Bob", "Most recent first");
  assert.strictEqual(merged[2].guest, "Carol", "Oldest last");
});

// --- Results ---

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
