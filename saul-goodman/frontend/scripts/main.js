// main.js
const REVIEWS = [
  "Saul got my charges dropped AND my money back. I'm still not sure how. — Anonymous Client",
  "He's not a lawyer, he's a magician with a briefcase. — A Very Satisfied Criminal",
  "Better call Saul? Better call your mom and tell her it's handled. — Grateful Client",
  "I called about a parking ticket. I left owning the parking lot. — Confused but Happy",
];

const API = "/api";

// ===== 打赏地址配置：把各链钱包地址填到引号里，空着则该链显示"待配置" =====
const DONATE = {
  evm: "0xf94f9e268e5fa24cb7e5b5e3171f6dda384dfafe",      // 0x 开头，ETH / BSC / Arbitrum / Polygon / Base 共用一个地址
  solana: "",   // Solana base58 地址
  tron: "",     // T 开头的 Tron 地址
  ton: "",      // UQ 开头的 TON 地址
};

const DONATE_CHAINS = [
  { name: "Ethereum", coins: "USDT / USDC", key: "evm" },
  { name: "BSC", coins: "USDT / USDC", key: "evm" },
  { name: "Arbitrum", coins: "USDT / USDC", key: "evm" },
  { name: "Polygon", coins: "USDT / USDC", key: "evm" },
  { name: "Base", coins: "USDT / USDC", key: "evm" },
  { name: "Solana", coins: "USDT / USDC", key: "solana" },
  { name: "Tron", coins: "USDT", key: "tron" },
  { name: "TON", coins: "USDT", key: "ton" },
];

// ===== 钱包打赏（腿 A：连接钱包 + 一键转 USDT/USDC）=====
const DONATE_ADDRESS = "0xf94f9e268e5fa24cb7e5b5e3171f6dda384dfafe";
const BSC_CHAIN_ID = "0x38"; // 56 的十六进制
const BSC_PARAMS = {
  chainId: "0x38",
  chainName: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: ["https://bsc-dataseed.binance.org/"],
  blockExplorerUrls: ["https://bscscan.com/"],
};
const TOKENS = {
  USDT: { address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
  USDC: { address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
};
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];

let walletAddress = null;
let selectedToken = "USDT";

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
  const poolInfo = document.getElementById("pool-info");
  list.innerHTML = "";
  const res = await fetch(`${API}/rewards`);
  const data = await res.json();
  if (poolInfo) poolInfo.textContent = `Today's pool: ${data.pool.toLocaleString()} tokens. Top 10 split it.`;
  for (const w of data.winners) {
    const li = document.createElement("li");
    li.textContent = `#${w.rank}  ${w.username}  —  ${w.win_index} pts  —  ${w.reward.toLocaleString()} tokens`;
    list.appendChild(li);
  }
}

async function renderClients() {
  const list = document.getElementById("client-list");
  if (!list) return;
  list.innerHTML = "";
  const res = await fetch(`${API}/clients`);
  const data = await res.json();
  for (const c of data.clients) {
    const li = document.createElement("li");
    li.textContent = `#${c.rank}  ${c.username}  —  ${c.total} total`;
    list.appendChild(li);
  }
}

window.playerId = Number(localStorage.getItem("playerId")) || null;

function initAudio() {
  const audio = document.getElementById("ad-audio");
  if (!audio) return;
  audio.loop = true;
  const tryPlay = () => audio.play().catch(() => {});
  tryPlay();
  // autoplay 被浏览器阻止时，第一次用户交互后开始循环播放
  if (audio.paused) {
    const start = () => {
      audio.play().catch(() => {});
      document.removeEventListener("click", start);
      document.removeEventListener("keydown", start);
      document.removeEventListener("touchstart", start);
    };
    document.addEventListener("click", start);
    document.addEventListener("keydown", start);
    document.addEventListener("touchstart", start);
  }
}

function qrUrl(addr) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(addr)}`;
}

function initDonate() {
  const grid = document.getElementById("donate-grid");
  if (!grid) return;
  const saulImgs = ["saul-hero", "saul-1", "saul-2", "saul-3", "saul-4"];
  for (const [i, chain] of DONATE_CHAINS.entries()) {
    const addr = DONATE[chain.key];
    const hasAddr = addr && addr.trim() !== "";
    const img = saulImgs[i % saulImgs.length];
    const card = document.createElement("div");
    card.className = "donate-card";
    card.innerHTML = `
      <h3>${chain.name}</h3>
      <p class="donate-coins">${chain.coins}</p>
      <img class="donate-img" src="images/${img}.jpg" alt="${chain.name}">
      <p class="donate-addr">${hasAddr ? addr : "ADDRESS PENDING"}</p>
      <button class="copy-btn" ${hasAddr ? "" : "disabled"}>COPY</button>
    `;
    card.querySelector(".copy-btn").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(addr);
        card.querySelector(".copy-btn").textContent = "COPIED!";
      } catch {
        card.querySelector(".copy-btn").textContent = "COPY FAILED";
      }
      setTimeout(() => { card.querySelector(".copy-btn").textContent = "COPY"; }, 1500);
    });
    grid.appendChild(card);
  }
}

function initWalletDonate() {
  const connectBtn = document.getElementById("connect-wallet");
  const donateBtn = document.getElementById("donate-btn");
  const amountInput = document.getElementById("donate-amount");
  const statusEl = document.getElementById("wallet-status");
  const msgEl = document.getElementById("donate-msg");
  if (!connectBtn || !donateBtn) return;

  connectBtn.addEventListener("click", async () => {
    const eth = window.ethereum;
    if (!eth) { statusEl.textContent = "No wallet found. Install MetaMask."; return; }
    try {
      const accounts = await eth.request({ method: "eth_requestAccounts" });
      walletAddress = accounts[0];
      let chainId = await eth.request({ method: "eth_chainId" });
      if (chainId !== BSC_CHAIN_ID) {
        try {
          await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BSC_CHAIN_ID }] });
        } catch {
          await eth.request({ method: "wallet_addEthereumChain", params: [BSC_PARAMS] });
        }
        chainId = await eth.request({ method: "eth_chainId" });
      }
      const onBsc = chainId === BSC_CHAIN_ID;
      const short = walletAddress.slice(0, 6) + "..." + walletAddress.slice(-4);
      statusEl.textContent = onBsc
        ? `Connected: ${short} (BSC)`
        : `Connected: ${short} — please switch to BSC in your wallet.`;
      connectBtn.textContent = "SWITCH WALLET";
    } catch {
      statusEl.textContent = "Connection cancelled.";
    }
  });

  document.querySelectorAll(".token-btn").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".token-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      selectedToken = b.dataset.token;
    });
  });

  document.querySelectorAll(".amount-btn").forEach((b) => {
    b.addEventListener("click", () => { amountInput.value = b.dataset.amt; });
  });

  donateBtn.addEventListener("click", async () => {
    const ethersLib = window.ethers;
    if (!ethersLib) { msgEl.textContent = "Web3 library failed to load. Refresh and retry."; return; }
    if (!walletAddress) { msgEl.textContent = "Connect your wallet first."; return; }
    const amount = parseFloat(amountInput.value);
    if (!amount || amount <= 0) { msgEl.textContent = "Enter a valid amount."; return; }
    const token = TOKENS[selectedToken];
    try {
      const provider = new ethersLib.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new ethersLib.Contract(token.address, ERC20_ABI, signer);
      const amountWei = ethersLib.parseUnits(String(amount), token.decimals);
      const balance = await contract.balanceOf(walletAddress);
      if (balance < amountWei) {
        msgEl.textContent = `Insufficient ${selectedToken} balance.`;
        return;
      }
      msgEl.textContent = "Confirm the transaction in your wallet...";
      const tx = await contract.transfer(DONATE_ADDRESS, amountWei);
      msgEl.textContent = `Pending: ${tx.hash.slice(0, 12)}...`;
      await tx.wait();
      msgEl.textContent = `Fee received! Saul will call you back. Tx: ${tx.hash.slice(0, 12)}...`;
      amountInput.value = "";
      if (window.playerId) {
        try {
          await fetch(`${API}/fees`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ player_id: window.playerId, amount }),
          });
        } catch {}
      }
      renderClients();
    } catch {
      msgEl.textContent = "Transaction failed or was rejected.";
    }
  });
}

initRegisterModal();
initReviews();
initAudio();
initDonate();
initWalletDonate();
refreshLeaderboard();
renderClients();

window.__saul = { register, fetchLeaderboard, refreshLeaderboard };
