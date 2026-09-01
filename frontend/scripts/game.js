// game.js  —— 纯函数 + 题库 + 状态机
export const QUESTIONS = [
  { type: "choice", scenario: "Client: I crashed my car and the cops are here!",
    options: ["Run and say nothing", "Don't touch anyone. Call me. NOW.",
              "Post about it first", "Was it on purpose?"],
    answer: 1, retort: "Now you're talking. Say nothing, call Saul." },
  { type: "choice", scenario: "Client: I found a bag of cash. Asking for a friend.",
    options: ["Spend it fast", "Return it, obviously", "Don't tell me where. Hide it.",
              "Donate it to charity"],
    answer: 2, retort: "I never heard a word. Neither did you." },
  { type: "choice", scenario: "Client: My boss caught me sleeping at my desk.",
    options: ["Sue him for harassment", "Say it was a medical episode",
              "Cry and apologize", "Frame the intern"],
    answer: 1, retort: "Worker's comp, baby. 'Exhaustion' is a diagnosis." },
  { type: "choice", scenario: "Client: The police want to search my trunk.",
    options: ["Let them, I'm clean", "Say no, lock it, call me",
              "Drive away fast", "Offer them coffee"],
    answer: 1, retort: "Warrant? What warrant? Now shut up and call me." },
  { type: "choice", scenario: "Client: My ex took the dog AND the boat.",
    options: ["Let it go", "Sue for the boat, dog's collateral",
              "Steal them back", "Call a hitman (kidding)"],
    answer: 1, retort: "We keep the boat. The dog was a rental, emotionally." },
  { type: "choice", scenario: "Client: I may have 'creatively' adjusted some invoices.",
    options: ["Burn the receipts", "It's not fraud, it's innovation. Call me",
              "Turn yourself in", "Blame the accountant"],
    answer: 1, retort: "That's the spirit. White-collar is just a color." },
  { type: "choice", scenario: "Client: I'm being audited by the IRS.",
    options: ["Cry", "Tell them you're a sovereign citizen",
              "Let me handle it. Say nothing to them", "Move to another country"],
    answer: 2, retort: "The only thing scarier than the IRS is my bill. Worth it." },
  { type: "judge", scenario: "Client wants to sue a coffee shop for 'hot coffee being hot'.",
    answer: true, retort: "A classic. We've won worse. Way worse." },
  { type: "judge", scenario: "Client wants me to represent their pet hamster in small claims.",
    answer: false, retort: "I have standards. The hamster can't pay my retainer." },
  { type: "judge", scenario: "Client is a mob boss who pays cash and asks no questions.",
    answer: true, retort: "My favorite kind of client: prompt, and quiet." },
  { type: "judge", scenario: "Client 'borrowed' a car and wants help returning it 'later'.",
    answer: false, retort: "I defend theft, I don't schedule it. Call me after." },
  { type: "judge", scenario: "Client slipped in a store and the manager apologized on camera.",
    answer: true, retort: "Cha-ching. That apology is a down payment." },
  { type: "choice", scenario: "Client: My landlord raised my rent 300%.",
    options: ["Pay it", "Sue. That's not rent, that's a robbery",
              "Sublet to strangers", "Stop paying and squat"],
    answer: 1, retort: "We'll negotiate. Aggressively. With a lawsuit." },
  { type: "choice", scenario: "Client: I got a ticket for 'excessive speeding'.",
    options: ["Pay the fine", "Fight it. The cop was emotional that day",
              "Bribe the judge", "Sell the car"],
    answer: 1, retort: "Speed limit is a suggestion. The ticket is not." },
  { type: "choice", scenario: "Client: My neighbor's dog won't stop barking.",
    options: ["Bark back", "Document it and sue for 'barking without a license'",
              "Move", "Poison the dog (DO NOT)"],
    answer: 1, retort: "There's a cause of action for everything. Everything." },
  { type: "judge", scenario: "Client wants to sue their reflection for 'looking at them funny'.",
    answer: false, retort: "Even I have limits. Also, your reflection pleads the Fifth." },
  { type: "judge", scenario: "Client 'found' a briefcase full of bearer bonds.",
    answer: true, retort: "Found, lost, found again. I love a good story." },
  { type: "choice", scenario: "Client: The Feds left a voicemail asking to 'chat'.",
    options: ["Call them back", "Talk to them, you're innocent",
              "Delete the voicemail and call me first", "Change your name"],
    answer: 2, retort: "You have the right to remain silent. USE IT. Then call me." },
  { type: "judge", scenario: "Client is a teacher who wants to sue the whole school district.",
    answer: true, retort: "David vs Goliath? I like David. He pays better." },
  { type: "judge", scenario: "Client wants to represent themselves in court.",
    answer: false, retort: "A lawyer who represents himself has a fool for a client. So do you." },
];

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function drawRound(questions, used, n) {
  const pool = shuffle(questions.filter((q) => !used.has(q.scenario)));
  const picked = pool.slice(0, n);
  picked.forEach((q) => used.add(q.scenario));
  return picked;
}

export function scoreAnswer(correct, secondsLeft, streakBefore) {
  if (!correct) return [0, 0, 0];
  const base = 100;
  const speed = Math.min(Math.floor(secondsLeft) * 10, 100);
  const combo = 20 * streakBefore;
  return [base, speed, combo];
}

export function computeWinIndex(total) {
  return Math.min(100, Math.round((total / 5100) * 100));
}

export function rankLabel(winIndex) {
  if (winIndex >= 90) return "Saul-certified: Supreme Chicanery";
  if (winIndex >= 70) return "Worthy of answering Saul's phones";
  if (winIndex >= 50) return "Consult a lawyer... about consulting";
  return "Turn yourself in";
}

const ROUNDS = 3;
const PER_ROUND = 5;
const TIME_LIMIT = 10;

export class Game {
  constructor(area) {
    this.area = area;
    this.used = new Set();
    this.round = 0;
    this.total = 0;
    this.streak = 0;
    this.secondsLeft = TIME_LIMIT;
    this.timerId = null;
    this.current = null;
  }

  start() {
    this.round = 0;
    this.total = 0;
    this.streak = 0;
    this.used = new Set();
    this._nextQuestion();
  }

  _nextQuestion() {
    if (this.used.size >= ROUNDS * PER_ROUND) { this._finish(); return; }
    this.round = Math.floor(this.used.size / PER_ROUND) + 1;
    this.current = drawRound(QUESTIONS, this.used, 1)[0];
    this.secondsLeft = TIME_LIMIT;
    this._renderQuestion();
    this._startTimer();
  }

  _startTimer() {
    clearInterval(this.timerId);
    this.timerId = setInterval(() => {
      this.secondsLeft -= 1;
      const t = this.area.querySelector(".timer");
      if (t) t.textContent = `${this.secondsLeft}s`;
      if (this.secondsLeft <= 0) this.answer(-1);
    }, 1000);
  }

  _renderQuestion() {
    const q = this.current;
    let html = `<div class="q-box"><p class="phone-ring">☎ RING RING — ROUND ${this.round}</p>`
      + `<p class="q-scenario">"${q.scenario}"</p>`
      + `<p class="timer">${this.secondsLeft}s</p>`;
    if (q.type === "choice") {
      html += '<div class="q-options">';
      q.options.forEach((opt, i) => {
        html += `<button data-i="${i}">${String.fromCharCode(65 + i)}. ${opt}</button>`;
      });
      html += "</div>";
    } else {
      html += '<div class="q-options">'
        + '<button data-i="true">YES, I\'ll take this case</button>'
        + '<button data-i="false">NO, even I won\'t</button>'
        + "</div>";
    }
    html += "</div>";
    this.area.innerHTML = html;
    this.area.querySelectorAll(".q-options button").forEach((b) => {
      b.addEventListener("click", () => this.answer(b.dataset.i));
    });
  }

  answer(choice) {
    clearInterval(this.timerId);
    const q = this.current;
    let correct;
    if (q.type === "choice") correct = Number(choice) === q.answer;
    else correct = (choice === "true") === q.answer;

    const [base, speed, combo] = scoreAnswer(correct, this.secondsLeft, this.streak);
    if (correct) this.streak += 1; else this.streak = 0;
    this.total += base + speed + combo;

    this.area.innerHTML = `<div class="q-box"><p class="retort">Saul: "${q.retort}"</p>`
      + `<p>${correct ? "+" : "0"} points (base ${base}, speed ${speed}, combo ${combo})</p>`
      + `<button id="next" class="btn">NEXT CALL</button></div>`;
    this.area.querySelector("#next").addEventListener("click", () => this._nextQuestion());
  }

  async _finish() {
    clearInterval(this.timerId);
    const winIndex = computeWinIndex(this.total);
    const label = rankLabel(winIndex);
    let html = `<div class="result"><p>That's a wrap.</p>`
      + `<p class="index">${winIndex} / 100</p>`
      + `<p>${label}</p><p>Total: ${this.total}</p>`
      + `<button id="replay" class="btn">TAKE ANOTHER CALL</button></div>`;

    if (window.playerId) {
      const res = await fetch("/api/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: window.playerId, win_index: winIndex, score: this.total }),
      });
      const data = await res.json();
      html += `<p>You rank #${data.rank} of ${data.total_players} snakes.</p>`;
    } else {
      html += "<p>(Sign up to get on the board, pal.)</p>";
    }
    this.area.innerHTML = html;
    this.area.querySelector("#replay").addEventListener("click", () => this.start());
    if (window.__saul) window.__saul.refreshLeaderboard();
  }
}

// DOM 初始化仅在浏览器执行；Node 单测导入 game.js 时 document 不存在，须 guard。
if (typeof document !== "undefined") {
  const game = new Game(document.getElementById("game-area"));
  const startBtn = document.getElementById("start-game");
  if (startBtn) {
    startBtn.addEventListener("click", () => {
      document.getElementById("game-area").classList.remove("hidden");
      game.start();
    });
  }
}
