// main.js
const REVIEWS = [
  "Saul got my charges dropped AND my money back. I'm still not sure how. — Anonymous Client",
  "He's not a lawyer, he's a magician with a briefcase. — A Very Satisfied Criminal",
  "Better call Saul? Better call your mom and tell her it's handled. — Grateful Client",
  "I called about a parking ticket. I left owning the parking lot. — Confused but Happy",
];

const API = "/api";

async function register(username, email) {
  const res = await fetch(`${API}/players`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email: email || null }),
  });
  if (res.status === 409) throw new Error("That name's taken. Pick a pseudonym, pal.");
  if (!res.ok) throw new Error("Couldn't sign you up. Try again.");
  const data = await res.json();
  return data.player_id;
}

async function fetchLeaderboard() {
  const res = await fetch(`${API}/leaderboard`);
  const data = await res.json();
  return data.players;
}

function initRegisterModal() {
  const modal = document.getElementById("register-modal");
  const form = document.getElementById("register-form");
  const err = document.getElementById("register-error");

  if (window.playerId) { modal.classList.add("hidden"); return; }

  modal.classList.remove("hidden");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.classList.add("hidden");
    const username = document.getElementById("username").value.trim();
    const email = document.getElementById("email").value.trim();
    try {
      const id = await register(username, email);
      window.playerId = id;
      localStorage.setItem("playerId", String(id));
      modal.classList.add("hidden");
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove("hidden");
    }
  });
}

function initReviews() {
  const el = document.getElementById("review-carousel");
  let i = 0;
  const show = () => { el.textContent = REVIEWS[i % REVIEWS.length]; i += 1; };
  show();
  setInterval(show, 3500);
}

async function refreshLeaderboard() {
  const list = document.getElementById("leaderboard-list");
  list.innerHTML = "";
  const players = await fetchLeaderboard();
  for (const p of players) {
    const li = document.createElement("li");
    li.textContent = `#${p.rank}  ${p.username}  —  ${p.win_index} win index`;
    list.appendChild(li);
  }
}

window.playerId = Number(localStorage.getItem("playerId")) || null;

initRegisterModal();
initReviews();
refreshLeaderboard();

window.__saul = { register, fetchLeaderboard, refreshLeaderboard };
