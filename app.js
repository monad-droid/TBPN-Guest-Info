const guestList = document.getElementById("guest-list");
const searchInput = document.getElementById("search");
const emptyState = document.getElementById("empty-state");

let guests = [];

function formatDate(dateStr) {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderGuests(filter = "") {
  const query = filter.toLowerCase();
  const filtered = guests.filter(
    (g) =>
      g.guest.toLowerCase().includes(query) ||
      g.company.toLowerCase().includes(query) ||
      g.companyDescription.toLowerCase().includes(query)
  );

  guestList.innerHTML = filtered
    .map((g) => {
      const linkUrl = g.videoId
        ? `https://www.youtube.com/watch?v=${encodeURIComponent(g.videoId)}`
        : g.episodeLink || "";
      const episodeLink = linkUrl
        ? `<a class="video-link" href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener">Listen/Watch</a>`
        : "";
      return `
    <div class="guest-card">
      <div class="card-header">
        <div class="date">${escapeHtml(formatDate(g.date))}</div>
        ${episodeLink}
      </div>
      <div class="guest-name">${escapeHtml(g.guest)}</div>
      <div class="company-name">${escapeHtml(g.company)}</div>
      <div class="company-desc">${escapeHtml(g.companyDescription)}</div>
    </div>`;
    })
    .join("");

  emptyState.hidden = filtered.length > 0;
}

async function init() {
  const res = await fetch("data/guests.json");
  guests = await res.json();
  guests.sort((a, b) => b.date.localeCompare(a.date));

  if (guests.length === 0) {
    emptyState.textContent =
      'No guests yet. Run "npm run fetch" to pull the latest TBPN interviews.';
    emptyState.hidden = false;
  } else {
    renderGuests();
  }
}

searchInput.addEventListener("input", (e) => renderGuests(e.target.value));

init();
