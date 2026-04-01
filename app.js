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

function renderGuests(filter = "") {
  const query = filter.toLowerCase();
  const filtered = guests.filter(
    (g) =>
      g.guest.toLowerCase().includes(query) ||
      g.company.toLowerCase().includes(query) ||
      g.companyDescription.toLowerCase().includes(query)
  );

  guestList.innerHTML = filtered
    .map(
      (g) => `
    <div class="guest-card">
      <div class="date">${formatDate(g.date)}</div>
      <div class="guest-name">${g.guest}</div>
      <div class="company-name">${g.company}</div>
      <div class="company-desc">${g.companyDescription}</div>
    </div>
  `
    )
    .join("");

  emptyState.hidden = filtered.length > 0;
}

async function init() {
  const res = await fetch("data/guests.json");
  guests = await res.json();
  guests.sort((a, b) => b.date.localeCompare(a.date));
  renderGuests();
}

searchInput.addEventListener("input", (e) => renderGuests(e.target.value));

init();
