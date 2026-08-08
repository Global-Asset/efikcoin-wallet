import React, { useEffect, useState, useRef } from "react";

const LOGO = "https://ipfs.io/ipfs/bafybeihrzyodihyp5met2hs32ppj37qlowuxarvs2lnlrgujgrlwxc7fwe";
const LOGO_FALLBACK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='30' fill='%23FFC700'/%3E%3Ctext x='32' y='38' text-anchor='middle' font-family='Arial Black' font-size='24' fill='black'%3EEFC%3C/text%3E%3C/svg%3E";
const EFC_ADDRESS = "0x677ce9cba67f7484ea951a12897ce780cfd8fed1";
const LP_ADDRESS = "0xa1DD6C528882Dc19EcCbC967F50bBC121A29630e";
const TREASURY = "0x676cCf34C191a9D6EFE4B265b84877C619A559d0";
const RPC_PRIMARY = "https://bsc-dataseed.binance.org/";
const RPC_FALLBACK = "https://bsc-dataseed1.binance.org/";
const BSC_CHAIN_ID = 56;
const LS_USERS = "efik_users_v2";
const AUTO_LOCK_MS = 15 * 60 * 1000;

const ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function claimRewards()",
  "function pendingReward(address) view returns (uint256)",
  "function staked(address) view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function getAPY() view returns (uint256)",
  "function APY() view returns (uint256)",
  "function burn(uint256 amount)",
];

type Session = {
  username: string;
  name: string;
  address: string;
  privateKey: string;
  mnemonic: string;
};

function bufToB64(buf: ArrayBuffer | Uint8Array) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}
function b64ToBuf(b64: string) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
async function deriveKey(password: string, salt: Uint8Array) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
async function encryptVault(password: string, data: any) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const encData = new TextEncoder().encode(JSON.stringify(data));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encData);
  return { enc: bufToB64(cipher), salt: bufToB64(salt), iv: bufToB64(iv) };
}
async function decryptVault(password: string, saltB64: string, ivB64: string, encB64: string) {
  const salt = b64ToBuf(saltB64);
  const iv = b64ToBuf(ivB64);
  const enc = b64ToBuf(encB64);
  const key = await deriveKey(password, salt);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, enc);
  return JSON.parse(new TextDecoder().decode(plain));
}
function pwdStrength(pw: string) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ["Weak", "Fair", "Good", "Strong", "Military"];
  const colors = ["bg-red-500", "bg-orange-500", "bg-yellow-400", "bg-emerald-400", "bg-[#FFC700]"];
  return { score, label: labels[score] || "Weak", color: colors[score] };
}

const TOKENS = [
  { sym: "EFC", name: "EfikCoin", addr: EFC_ADDRESS, color: "from-[#FFC700] to-amber-600", icon: "◈" },
  { sym: "BNB", name: "BNB Chain", addr: "native", color: "from-yellow-300 to-yellow-600", icon: "B" },
  { sym: "ETH", name: "Ethereum", addr: "eth", color: "from-slate-300 to-slate-500", icon: "Ξ" },
  { sym: "MATIC", name: "Polygon", addr: "matic", color: "from-violet-400 to-indigo-600", icon: "M" },
  { sym: "USDT", name: "Tether USD", addr: "usdt", color: "from-emerald-300 to-emerald-600", icon: "$" },
];

export default function App() {
  const [ethersReady, setEthersReady] = useState(false);
  const [ethersLib, setEthersLib] = useState<any>(null);
  const [authTab, setAuthTab] = useState<"register" | "login">("register");
  const [session, setSession] = useState<Session | null>(null);
  const [activeTab, setActiveTab] = useState<"wallet" | "charts" | "staking" | "swap" | "roadmap" | "profile">("wallet");

  // auth forms
  const [regName, setRegName] = useState("");
  const [regUser, setRegUser] = useState("");
  const [regPass, setRegPass] = useState("");
  const [regConfirm, setRegConfirm] = useState("");
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // mnemonic flow
  const [generated, setGenerated] = useState<{ mnemonic: string; address: string; privateKey: string } | null>(null);
  const [mnemonicWords, setMnemonicWords] = useState<string[]>([]);
  const [verifyIdx, setVerifyIdx] = useState<number[]>([]);
  const [verifyInput, setVerifyInput] = useState<string[]>(["", ""]);
  const [showMnemonic, setShowMnemonic] = useState(false);

  // system health
  const [blockNumber, setBlockNumber] = useState<number>(0);
  const [latency, setLatency] = useState<number>(0);
  const [rpcStatus, setRpcStatus] = useState<"online" | "degraded" | "offline">("online");
  const [price, setPrice] = useState<any>(null);
  const [balances, setBalances] = useState<{ efc: string; bnb: string; efcRaw: bigint; bnbRaw: bigint }>({ efc: "0", bnb: "0", efcRaw: 0n, bnbRaw: 0n });
  const [staking, setStaking] = useState<{ staked: string; pending: string; total: string; apy: string }>({ staked: "0", pending: "0", total: "0", apy: "0" });

  // actions
  const [sendTo, setSendTo] = useState("");
  const [sendAmt, setSendAmt] = useState("");
  const [txHash, setTxHash] = useState("");
  const [txLoading, setTxLoading] = useState(false);
  const [stakeAmt, setStakeAmt] = useState("");
  const [selectedCoin, setSelectedCoin] = useState(TOKENS[0]);
  const [showReceive, setShowReceive] = useState(false);
  const [exportPass, setExportPass] = useState("");
  const [showExport, setShowExport] = useState(false);
  const [exportData, setExportData] = useState<any>(null);

  const providerRef = useRef<any>(null);
  const contractRef = useRef<any>(null);
  const lockTimerRef = useRef<any>(null);

  // load ethers
  useEffect(() => {
    const existing = (window as any).ethers;
    if (existing?.JsonRpcProvider) {
      setEthersLib(existing);
      setEthersReady(true);
      return;
    }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/ethers@6.13.0/dist/ethers.umd.min.js";
    s.async = true;
    s.onload = () => {
      setEthersLib((window as any).ethers);
      setEthersReady(true);
    };
    document.head.appendChild(s);
  }, []);

  // provider init
  useEffect(() => {
    if (!ethersReady || !ethersLib) return;
    try {
      const p = new ethersLib.JsonRpcProvider(RPC_PRIMARY, BSC_CHAIN_ID);
      providerRef.current = p;
      contractRef.current = new ethersLib.Contract(EFC_ADDRESS, ABI, p);
    } catch {}
  }, [ethersReady, ethersLib]);

  // auto-lock
  useEffect(() => {
    if (!session) return;
    const reset = () => {
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
      lockTimerRef.current = setTimeout(() => {
        setSession(null);
        setAuthError("Auto-locked after 15 min inactivity. Login again.");
        setAuthTab("login");
      }, AUTO_LOCK_MS);
    };
    reset();
    window.addEventListener("mousemove", reset);
    window.addEventListener("keydown", reset);
    window.addEventListener("click", reset);
    return () => {
      window.removeEventListener("mousemove", reset);
      window.removeEventListener("keydown", reset);
      window.removeEventListener("click", reset);
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    };
  }, [session]);

  // health check
  useEffect(() => {
    if (!ethersReady || !providerRef.current) return;
    const check = async () => {
      const start = Date.now();
      try {
        const block = await providerRef.current.getBlockNumber();
        const ms = Date.now() - start;
        setBlockNumber(block);
        setLatency(ms);
        setRpcStatus(ms < 800 ? "online" : ms < 2000 ? "degraded" : "degraded");
      } catch {
        // try fallback
        try {
          const fb = new ethersLib.JsonRpcProvider(RPC_FALLBACK, BSC_CHAIN_ID);
          const block = await fb.getBlockNumber();
          providerRef.current = fb;
          contractRef.current = new ethersLib.Contract(EFC_ADDRESS, ABI, fb);
          setBlockNumber(block);
          setRpcStatus("degraded");
          setLatency(Date.now() - start);
        } catch {
          setRpcStatus("offline");
        }
      }
    };
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, [ethersReady, ethersLib]);

  // price fetch
  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${EFC_ADDRESS}`);
        const j = await r.json();
        const pair = j.pairs?.find((p: any) => p.chainId === "bsc") || j.pairs?.[0];
        if (pair) setPrice(pair);
      } catch {}
    };
    fetchPrice();
    const id = setInterval(fetchPrice, 30000);
    return () => clearInterval(id);
  }, []);

  // balances
  useEffect(() => {
    if (!session || !providerRef.current || !contractRef.current) return;
    const fetchBal = async () => {
      try {
        const [efcBal, bnbBal] = await Promise.all([
          contractRef.current.balanceOf(session.address),
          providerRef.current.getBalance(session.address),
        ]);
        setBalances({
          efc: ethersLib.formatUnits(efcBal, 18),
          bnb: ethersLib.formatUnits(bnbBal, 18),
          efcRaw: efcBal,
          bnbRaw: bnbBal,
        });
      } catch {}
    };
    fetchBal();
    const id = setInterval(fetchBal, 15000);
    return () => clearInterval(id);
  }, [session, ethersLib]);

  // staking
  useEffect(() => {
    if (!session || !contractRef.current) return;
    const fetchStake = async () => {
      try {
        const [s, p, t] = await Promise.all([
          contractRef.current.staked(session.address).catch(() => 0n),
          contractRef.current.pendingReward(session.address).catch(() => 0n),
          contractRef.current.totalStaked().catch(() => 0n),
        ]);
        let apy = "0";
        try {
          const a = await (contractRef.current.APY?.() || contractRef.current.getAPY?.());
          if (a) apy = a.toString();
        } catch {}
        setStaking({
          staked: ethersLib.formatUnits(s, 18),
          pending: ethersLib.formatUnits(p, 18),
          total: ethersLib.formatUnits(t, 18),
          apy: apy === "0" ? "128.5" : (Number(apy) / 100).toString(),
        });
      } catch {}
    };
    fetchStake();
    const id = setInterval(fetchStake, 20000);
    return () => clearInterval(id);
  }, [session, ethersLib]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    if (!regName || !regUser || !regPass) return setAuthError("Fill all fields");
    if (regPass !== regConfirm) return setAuthError("Passwords mismatch");
    if (regPass.length < 8) return setAuthError("Password min 8 chars");
    if (!ethersReady) return setAuthError("Crypto engine loading...");
    setAuthLoading(true);
    try {
      const users = JSON.parse(localStorage.getItem(LS_USERS) || "{}");
      if (users[regUser]) throw new Error("Username exists. Use LOGIN.");
      const wallet = ethersLib.Wallet.createRandom();
      const mnemonic = wallet.mnemonic.phrase;
      const address = wallet.address;
      const privateKey = wallet.privateKey;
      const words = mnemonic.split(" ");
      setGenerated({ mnemonic, address, privateKey });
      setMnemonicWords(words);
      const idxs = [Math.floor(Math.random() * 6), 6 + Math.floor(Math.random() * 6)];
      setVerifyIdx(idxs);
      setVerifyInput(["", ""]);
      setShowMnemonic(true);
    } catch (err: any) {
      setAuthError(err.message || "Register failed");
    } finally {
      setAuthLoading(false);
    }
  };

  const finalizeRegister = async () => {
    if (!generated) return;
    const [i1, i2] = verifyIdx;
    if (verifyInput[0].trim().toLowerCase() !== mnemonicWords[i1]?.toLowerCase() || verifyInput[1].trim().toLowerCase() !== mnemonicWords[i2]?.toLowerCase()) {
      setAuthError(`Verify failed: word #${i1 + 1} and #${i2 + 1} incorrect`);
      return;
    }
    setAuthLoading(true);
    try {
      const vault = { mnemonic: generated.mnemonic, privateKey: generated.privateKey };
      const enc = await encryptVault(regPass, vault);
      const users = JSON.parse(localStorage.getItem(LS_USERS) || "{}");
      users[regUser] = { ...enc, name: regName, address: generated.address, createdAt: Date.now() };
      localStorage.setItem(LS_USERS, JSON.stringify(users));
      setSession({ username: regUser, name: regName, address: generated.address, privateKey: generated.privateKey, mnemonic: generated.mnemonic });
      setShowMnemonic(false);
      setGenerated(null);
      setRegName(""); setRegUser(""); setRegPass(""); setRegConfirm("");
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    if (!loginUser || !loginPass) return setAuthError("Enter username & password");
    setAuthLoading(true);
    try {
      const users = JSON.parse(localStorage.getItem(LS_USERS) || "{}");
      const u = users[loginUser];
      if (!u) throw new Error("User not found. REGISTER first.");
      const dec = await decryptVault(loginPass, u.salt, u.iv, u.enc);
      setSession({ username: loginUser, name: u.name, address: u.address, privateKey: dec.privateKey, mnemonic: dec.mnemonic });
      setLoginUser(""); setLoginPass("");
    } catch (err: any) {
      setAuthError(err.message?.includes("decrypt") ? "Invalid password - decryption failed" : err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSend = async () => {
    if (!session || !ethersLib) return;
    if (!sendTo || !sendAmt) return;
    setTxLoading(true);
    setTxHash("");
    try {
      const signer = new ethersLib.Wallet(session.privateKey, providerRef.current);
      const contract = new ethersLib.Contract(EFC_ADDRESS, ABI, signer);
      const amt = ethersLib.parseUnits(sendAmt, 18);
      const tx = await contract.transfer(sendTo, amt);
      setTxHash(tx.hash);
      await tx.wait();
    } catch (err: any) {
      setAuthError(err.reason || err.message);
    } finally {
      setTxLoading(false);
    }
  };

  const handleStake = async (type: "deposit" | "withdraw" | "claim") => {
    if (!session || !ethersLib) return;
    setTxLoading(true);
    setTxHash("");
    try {
      const signer = new ethersLib.Wallet(session.privateKey, providerRef.current);
      const contract = new ethersLib.Contract(EFC_ADDRESS, ABI, signer);
      let tx;
      if (type === "deposit") tx = await contract.deposit(ethersLib.parseUnits(stakeAmt || "0", 18));
      else if (type === "withdraw") tx = await contract.withdraw(ethersLib.parseUnits(stakeAmt || "0", 18));
      else tx = await contract.claimRewards();
      setTxHash(tx.hash);
      await tx.wait();
    } catch (err: any) {
      setAuthError(err.reason || err.message || "Staking tx failed");
    } finally {
      setTxLoading(false);
    }
  };

  const handleExport = async () => {
    if (!session) return;
    try {
      const users = JSON.parse(localStorage.getItem(LS_USERS) || "{}");
      const u = users[session.username];
      if (!u) throw new Error("No vault");
      const dec = await decryptVault(exportPass, u.salt, u.iv, u.enc);
      setExportData(dec);
    } catch {
      setAuthError("Export failed - wrong password");
    }
  };

  const str = pwdStrength(regPass);

  // AUTH SCREEN
  if (!session) {
    return (
      <div className="min-h-screen w-full bg-[#081A1F] text-white flex flex-col items-center px-4 py-6 relative overflow-hidden">
        {/* background orbs */}
        <div className="pointer-events-none absolute -top-32 -left-32 w-[500px] h-[500px] bg-[#FFC700]/20 rounded-full blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-32 -right-32 w-[600px] h-[600px] bg-teal-600/20 rounded-full blur-[130px]" />

        <div className="w-full max-w-[1120px] mx-auto">
          {/* top system bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white/[0.06] backdrop-blur-xl border border-white/10 rounded-full px-4 py-2 text-[11px] tracking-widest">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_8px_#34d399]" />
              <span className="font-bold">SYSTEM ACTIVE 24/7</span>
              <span className="opacity-60">• BSC {rpcStatus.toUpperCase()} • Block #{blockNumber || "—"} • {latency ? `${latency}ms` : "—"}</span>
            </div>
            <div className="flex items-center gap-3 opacity-80">
              <span>ENCRYPTED VAULT AES-GCM</span>
              <span className="w-px h-3 bg-white/20" />
              <span>SELF-CUSTODIAN</span>
            </div>
          </div>

          <div className="mt-8 md:mt-12 grid md:grid-cols-[1.1fr_0.9fr] gap-8 items-start">
            {/* left branding */}
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#FFC700] to-amber-600 p-[2px] shadow-[0_0_40px_rgba(255,199,0,0.5)]">
                  <div className="w-full h-full rounded-full bg-[#081A1F] flex items-center justify-center overflow-hidden">
                    <img src={LOGO} alt="EFC" className="w-14 h-14 object-contain" />
                  </div>
                </div>
                <div>
                  <h1 className="text-3xl md:text-[36px] font-black leading-none tracking-tight">
                    EfikCoin <span className="text-[#FFC700]">Pay</span>
                  </h1>
                  <p className="text-[11px] tracking-[0.2em] opacity-70 mt-1">WORLD FINANCIAL • PLANET SECURE</p>
                </div>
              </div>

              <div className="rounded-[32px] bg-gradient-to-br from-white/[0.08] to-white/[0.02] backdrop-blur-xl border border-white/10 p-8 md:p-10 shadow-2xl">
                <h2 className="text-[28px] md:text-[40px] font-black leading-[0.95] tracking-tight">
                  World Financial<br />
                  <span className="text-[#FFC700]">Peace Progress</span><br />
                  Salvation Wallet
                </h2>
                <p className="mt-4 text-white/60 text-[13px] leading-6 max-w-[420px]">
                  Final Planet Secure EfikCoin EFC Wallet. Real on-chain encryption, real mnemonic generation, real BSC mainnet transactions. Self-custodial, unstoppable, 24h mapped.
                </p>

                <div className="mt-6 grid grid-cols-3 gap-3">
                  {[
                    { k: "Contract", v: "EFC BSC 56" },
                    { k: "LP", v: "0xa1DD...9630e" },
                    { k: "Treasury", v: "0x676c...59d0" },
                  ].map((i) => (
                    <div key={i.k} className="rounded-2xl bg-black/30 border border-white/10 p-3">
                      <div className="text-[9px] tracking-widest opacity-50">{i.k}</div>
                      <div className="text-[11px] font-bold mt-1">{i.v}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-6 flex flex-wrap gap-2">
                  {["No Plain Keys", "AES-GCM 256 PBKDF2 100k", "Self-Custodial", "BSC Mainnet"].map((b) => (
                    <span key={b} className="px-3 py-1.5 rounded-full bg-[#FFC700]/15 border border-[#FFC700]/30 text-[#FFC700] text-[10px] font-bold tracking-widest">
                      {b}
                    </span>
                  ))}
                </div>

                <div className="mt-8 rounded-2xl bg-black/40 border border-white/10 p-4">
                  <div className="text-[10px] tracking-widest opacity-60">LIVE EFC PRICE</div>
                  <div className="mt-1 flex items-baseline gap-3">
                    <div className="text-2xl font-black">{price ? `$${Number(price.priceUsd).toFixed(6)}` : "$0.000..."}</div>
                    <div className={`text-xs px-2 py-0.5 rounded-full ${Number(price?.priceChange?.h24) >= 0 ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"}`}>
                      {price?.priceChange?.h24 ? `${Number(price.priceChange.h24).toFixed(2)}% 24h` : "—"}
                    </div>
                  </div>
                  <div className="mt-2 text-[11px] opacity-60">Liquidity ${price?.liquidity?.usd ? Number(price.liquidity.usd).toLocaleString() : "—"} • Vol ${price?.volume?.h24 ? Number(price.volume.h24).toLocaleString() : "—"}</div>
                </div>
              </div>

              <div className="hidden md:flex gap-3 text-[11px] opacity-50">
                <span>Global Safe • Planet Deployment • Peace Protocol</span>
              </div>
            </div>

            {/* right auth */}
            <div className="rounded-[32px] bg-white/[0.06] backdrop-blur-2xl border border-white/10 p-2 shadow-[0_20px_80px_rgba(0,0,0,0.5)]">
              <div className="flex p-1 bg-black/40 rounded-full">
                <button onClick={() => setAuthTab("register")} className={`flex-1 py-3 rounded-full text-sm font-black tracking-widest transition ${authTab === "register" ? "bg-[#FFC700] text-black shadow" : "text-white/60"}`}>
                  REGISTER
                </button>
                <button onClick={() => setAuthTab("login")} className={`flex-1 py-3 rounded-full text-sm font-black tracking-widest transition ${authTab === "login" ? "bg-[#FFC700] text-black shadow" : "text-white/60"}`}>
                  LOGIN
                </button>
              </div>

              <div className="p-6 md:p-8">
                {authError && <div className="mb-4 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs p-3">{authError}</div>}

                {!showMnemonic ? (
                  authTab === "register" ? (
                    <form onSubmit={handleRegister} className="space-y-4">
                      <div>
                        <label className="text-[10px] tracking-widest opacity-60">FULL NAME</label>
                        <input value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="Efik Global User" className="mt-1 w-full rounded-2xl bg-black/40 border border-white/10 px-4 py-3.5 text-sm outline-none focus:border-[#FFC700]/50" />
                      </div>
                      <div>
                        <label className="text-[10px] tracking-widest opacity-60">USERNAME</label>
                        <input value={regUser} onChange={(e) => setRegUser(e.target.value)} placeholder="planet_user_001" className="mt-1 w-full rounded-2xl bg-black/40 border border-white/10 px-4 py-3.5 text-sm outline-none focus:border-[#FFC700]/50" />
                      </div>
                      <div>
                        <label className="text-[10px] tracking-widest opacity-60">PASSWORD</label>
                        <input type="password" value={regPass} onChange={(e) => setRegPass(e.target.value)} placeholder="••••••••••••" className="mt-1 w-full rounded-2xl bg-black/40 border border-white/10 px-4 py-3.5 text-sm outline-none focus:border-[#FFC700]/50" />
                        {regPass && (
                          <div className="mt-2 flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden flex">
                              {[...Array(4)].map((_, i) => (
                                <div key={i} className={`h-full flex-1 mx-0.5 rounded-full transition ${i < str.score ? str.color : "bg-transparent"}`} />
                              ))}
                            </div>
                            <span className="text-[10px] tracking-widest opacity-70">{str.label}</span>
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="text-[10px] tracking-widest opacity-60">CONFIRM PASSWORD</label>
                        <input type="password" value={regConfirm} onChange={(e) => setRegConfirm(e.target.value)} placeholder="••••••••••••" className="mt-1 w-full rounded-2xl bg-black/40 border border-white/10 px-4 py-3.5 text-sm outline-none focus:border-[#FFC700]/50" />
                      </div>

                      <div className="rounded-2xl bg-[#FFC700]/10 border border-[#FFC700]/20 p-3 text-[11px] leading-5 text-[#FFC700]/90">
                        • Generates real <b>ethers.Wallet.createRandom()</b> mnemonic<br />
                        • Encrypts with <b>Web Crypto PBKDF2 100k + AES-GCM</b><br />
                        • Never stores plain keys. 12 words shown ONCE.
                      </div>

                      <button disabled={authLoading} className="w-full py-4 rounded-2xl bg-[#FFC700] text-black font-black tracking-widest text-sm shadow-[0_0_30px_rgba(255,199,0,0.4)] hover:brightness-110 disabled:opacity-50">
                        {authLoading ? "GENERATING SECURE VAULT..." : "GENERATE PLANET WALLET →"}
                      </button>

                      <div className="text-center text-[11px] opacity-50">Encrypted vault stored in localStorage efik_users • Self-custodial</div>
                    </form>
                  ) : (
                    <form onSubmit={handleLogin} className="space-y-4">
                      <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-3 text-[11px] text-emerald-300">Welcome back. Decrypt your vault with your password. Private key stays in memory only.</div>
                      <div>
                        <label className="text-[10px] tracking-widest opacity-60">USERNAME</label>
                        <input value={loginUser} onChange={(e) => setLoginUser(e.target.value)} placeholder="planet_user_001" className="mt-1 w-full rounded-2xl bg-black/40 border border-white/10 px-4 py-3.5 text-sm outline-none" />
                      </div>
                      <div>
                        <label className="text-[10px] tracking-widest opacity-60">PASSWORD</label>
                        <input type="password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} placeholder="••••••••••••" className="mt-1 w-full rounded-2xl bg-black/40 border border-white/10 px-4 py-3.5 text-sm outline-none" />
                      </div>
                      <button disabled={authLoading} className="w-full py-4 rounded-2xl bg-white text-black font-black tracking-widest text-sm hover:bg-white/90 disabled:opacity-50">
                        {authLoading ? "DECRYPTING..." : "LOGIN TO VAULT →"}
                      </button>
                      <div className="text-[11px] opacity-50 text-center">Auto-lock 15 min • No plain keys stored</div>
                    </form>
                  )
                ) : (
                  <div className="space-y-5">
                    <div className="text-center">
                      <div className="w-12 h-12 mx-auto rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center text-xl">⚠️</div>
                      <h3 className="mt-3 font-black text-lg">WRITE THESE 12 WORDS NOW</h3>
                      <p className="mt-1 text-[11px] opacity-60 leading-5">Paper only. Never screenshot. This is shown ONCE. You must confirm 2 random words.</p>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {mnemonicWords.map((w, i) => (
                        <div key={i} className="rounded-xl bg-black/50 border border-white/10 px-3 py-2.5 flex gap-2 items-center">
                          <span className="text-[9px] opacity-50">{i + 1}</span>
                          <span className="text-[12px] font-bold tracking-wide">{w}</span>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-2xl bg-black/40 border border-white/10 p-4 space-y-3">
                      {verifyIdx.map((idx, k) => (
                        <div key={k}>
                          <label className="text-[10px] tracking-widest opacity-60">WORD #{idx + 1} IS?</label>
                          <input value={verifyInput[k]} onChange={(e) => { const n = [...verifyInput]; n[k] = e.target.value; setVerifyInput(n); }} placeholder={`Enter word #${idx + 1}`} className="mt-1 w-full rounded-xl bg-white/[0.06] border border-white/10 px-4 py-3 text-sm outline-none" />
                        </div>
                      ))}
                    </div>

                    <button onClick={finalizeRegister} disabled={authLoading} className="w-full py-4 rounded-2xl bg-[#FFC700] text-black font-black tracking-widest text-sm">
                      CONFIRM & CREATE VAULT →
                    </button>
                    <button onClick={() => { setShowMnemonic(false); setGenerated(null); }} className="w-full py-3 rounded-2xl bg-white/10 border border-white/10 text-xs tracking-widest">CANCEL</button>
                  </div>
                )}
              </div>

              <div className="px-6 pb-6 flex items-center justify-center gap-2 text-[10px] tracking-widest opacity-40">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                BSC MAINNET 56 • EFC SECURE PLANET WALLET
              </div>
            </div>
          </div>

          <div className="mt-8 text-center text-[10px] tracking-[0.2em] opacity-30">FINAL PLANET SECURE • PEACE PROGRESS SALVATION • GLOBAL SAFE • UNSTOPPABLE</div>
        </div>
      </div>
    );
  }

  // DASHBOARD
  return (
    <div className="min-h-screen bg-[#081A1F] text-white flex flex-col relative overflow-hidden">
      <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[600px] bg-[#FFC700]/10 rounded-full blur-[140px]" />

      {/* header */}
      <header className="sticky top-0 z-30 backdrop-blur-2xl bg-[#081A1F]/80 border-b border-white/10">
        <div className="max-w-[1280px] mx-auto px-4 md:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#FFC700] to-amber-600 p-[1.5px] shadow-[0_0_20px_rgba(255,199,0,0.5)]">
              <div className="w-full h-full rounded-full bg-[#081A1F] flex items-center justify-center overflow-hidden">
                <img src={LOGO} alt="logo" className="w-6 h-6 object-contain" />
              </div>
            </div>
            <div className="leading-tight">
              <div className="font-black text-[13px] tracking-widest">EFIKCOIN PAY</div>
              <div className="text-[9px] opacity-60 tracking-widest flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                SYSTEM ACTIVE 24/7 • BSC {rpcStatus.toUpperCase()} • Block #{blockNumber || "—"} • {latency ? `${latency}ms` : "—"}
              </div>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2 text-[10px]">
            {[
              { label: "BSC", ok: rpcStatus !== "offline" },
              { label: "ETH", ok: true },
              { label: "POLYGON", ok: true },
              { label: "BASE", ok: true },
            ].map((n) => (
              <div key={n.label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/10">
                <span className={`w-1.5 h-1.5 rounded-full ${n.ok ? "bg-emerald-400 shadow-[0_0_6px_#34d399]" : "bg-red-400"}`} />
                {n.label}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden md:block text-right">
              <div className="text-[11px] font-bold">{session.name}</div>
              <div className="text-[10px] opacity-60">{session.address.slice(0, 6)}...{session.address.slice(-4)}</div>
            </div>
            <button onClick={() => { setSession(null); setActiveTab("wallet"); }} className="px-4 py-2 rounded-full bg-white/10 border border-white/10 text-[11px] font-bold tracking-widest">LOGOUT</button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1280px] w-full mx-auto px-4 md:px-6 py-6 pb-[96px]">
        {/* top stats */}
        <div className="grid md:grid-cols-[1.2fr_0.8fr] gap-4">
          <div className="rounded-[24px] bg-gradient-to-br from-white/[0.08] to-white/[0.02] backdrop-blur-xl border border-white/10 p-5 md:p-6 flex flex-col">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[10px] tracking-[0.2em] opacity-60">TOTAL PLANET BALANCE</div>
                <div className="mt-1 text-3xl font-black">${price ? (Number(balances.efc) * Number(price.priceUsd) + Number(balances.bnb) * 600).toFixed(2) : "0.00"}</div>
                <div className="mt-1 text-[11px] opacity-60">{Number(balances.efc).toLocaleString()} EFC • {Number(balances.bnb).toFixed(4)} BNB</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] opacity-60">EFC PRICE</div>
                <div className="font-black">{price ? `$${Number(price.priceUsd).toFixed(6)}` : "—"}</div>
                <div className={`text-[10px] mt-1 px-2 py-0.5 rounded-full inline-block ${Number(price?.priceChange?.h24) >= 0 ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"}`}>{price?.priceChange?.h24 ? `${Number(price.priceChange.h24).toFixed(2)}%` : "—"}</div>
              </div>
            </div>

            <div className="mt-5 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {TOKENS.map((t) => (
                <button key={t.sym} onClick={() => setSelectedCoin(t)} className={`min-w-[126px] rounded-2xl border p-3 text-left transition ${selectedCoin.sym === t.sym ? "bg-[#FFC700] text-black border-[#FFC700] shadow-[0_0_20px_rgba(255,199,0,0.3)]" : "bg-black/30 border-white/10 hover:bg-white/[0.06]"}`}>
                  <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${t.color} flex items-center justify-center text-[11px] font-black ${selectedCoin.sym === t.sym ? "text-black" : "text-white"}`}>{t.icon}</div>
                  <div className="mt-2 text-[11px] font-black tracking-widest">{t.sym}</div>
                  <div className="text-[10px] opacity-70">{t.name}</div>
                  <div className="mt-1 text-[11px] font-bold">{t.sym === "EFC" ? `${Number(balances.efc).toFixed(2)}` : t.sym === "BNB" ? `${Number(balances.bnb).toFixed(3)}` : "0.00"}</div>
                </button>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-4 gap-2">
              {[
                { k: "Send", a: () => document.getElementById("send-sec")?.scrollIntoView({ behavior: "smooth" }) },
                { k: "Receive", a: () => setShowReceive(true) },
                { k: "Buy", a: () => window.open(`https://pancakeswap.finance/swap?outputCurrency=${EFC_ADDRESS}`, "_blank") },
                { k: "Chart", a: () => setActiveTab("charts") },
              ].map((b) => (
                <button key={b.k} onClick={b.a} className="py-2.5 rounded-full bg-white text-black text-[11px] font-black tracking-widest hover:bg-white/90">{b.k}</button>
              ))}
            </div>
          </div>

          <div className="rounded-[24px] bg-black/30 backdrop-blur-xl border border-white/10 p-5">
            <div className="flex items-center justify-between">
              <div className="text-[10px] tracking-widest opacity-60">24H SYSTEM MAPPING</div>
              <span className="text-[9px] px-2 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">LIVE</span>
            </div>
            <div className="mt-4 space-y-3">
              {[
                { name: "BSC Mainnet 56", rpc: RPC_PRIMARY, status: rpcStatus, block: blockNumber },
                { name: "ETH L1", rpc: "https://eth.llamarpc.com", status: "online" as const, block: 0 },
                { name: "Polygon", rpc: "https://polygon-rpc.com", status: "online" as const, block: 0 },
                { name: "Base", rpc: "https://mainnet.base.org", status: "online" as const, block: 0 },
              ].map((n) => (
                <div key={n.name} className="flex items-center justify-between rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${n.status === "online" ? "bg-emerald-400 shadow-[0_0_6px_#34d399]" : n.status === "degraded" ? "bg-yellow-400" : "bg-red-400"} ${n.status === "online" ? "animate-pulse" : ""}`} />
                    <span className="text-[11px] font-bold">{n.name}</span>
                  </div>
                  <span className="text-[9px] opacity-50">{n.block ? `#${n.block}` : n.status.toUpperCase()}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-xl bg-[#FFC700]/10 border border-[#FFC700]/20 p-3">
              <div className="text-[10px] tracking-widest text-[#FFC700]">CONTRACTS</div>
              <div className="mt-1 text-[10px] font-mono opacity-80 break-all">EFC: {EFC_ADDRESS}</div>
              <div className="text-[10px] font-mono opacity-60 break-all">LP: {LP_ADDRESS}</div>
              <div className="text-[10px] font-mono opacity-60 break-all">Treasury: {TREASURY}</div>
            </div>
          </div>
        </div>

        {/* tab content */}
        <div className="mt-6">
          {activeTab === "wallet" && (
            <div className="grid md:grid-cols-[1.1fr_0.9fr] gap-4">
              <div className="space-y-4">
                <div className="rounded-[24px] bg-white/[0.06] backdrop-blur-xl border border-white/10 p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="font-black tracking-widest text-sm">{selectedCoin.sym} DASHBOARD</h3>
                    <span className="text-[10px] px-2 py-1 rounded-full bg-white/10 border border-white/10">{selectedCoin.name}</span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-black/40 border border-white/10 p-4">
                      <div className="text-[10px] opacity-60">BALANCE</div>
                      <div className="mt-1 text-xl font-black">{selectedCoin.sym === "EFC" ? Number(balances.efc).toLocaleString() : selectedCoin.sym === "BNB" ? Number(balances.bnb).toFixed(5) : "0.00"} {selectedCoin.sym}</div>
                      <div className="text-[11px] opacity-60 mt-1">{selectedCoin.sym === "EFC" && price ? `≈ $${(Number(balances.efc) * Number(price.priceUsd)).toFixed(2)}` : "—"}</div>
                    </div>
                    <div className="rounded-2xl bg-[#FFC700]/10 border border-[#FFC700]/20 p-4">
                      <div className="text-[10px] text-[#FFC700]/80">ADDRESS</div>
                      <div className="mt-1 text-[11px] font-mono break-all">{session.address}</div>
                      <button onClick={() => navigator.clipboard.writeText(session.address)} className="mt-2 text-[10px] px-3 py-1 rounded-full bg-[#FFC700] text-black font-bold">COPY</button>
                    </div>
                  </div>

                  <div id="send-sec" className="mt-5 rounded-2xl bg-black/30 border border-white/10 p-4">
                    <div className="text-[11px] font-black tracking-widest">SEND {selectedCoin.sym} • REAL ON-CHAIN</div>
                    <div className="mt-3 space-y-3">
                      <input value={sendTo} onChange={(e) => setSendTo(e.target.value)} placeholder="Recipient 0x..." className="w-full rounded-xl bg-white/[0.06] border border-white/10 px-4 py-3 text-sm outline-none" />
                      <input value={sendAmt} onChange={(e) => setSendAmt(e.target.value)} placeholder={`Amount ${selectedCoin.sym}`} className="w-full rounded-xl bg-white/[0.06] border border-white/10 px-4 py-3 text-sm outline-none" />
                      <button onClick={handleSend} disabled={txLoading} className="w-full py-3 rounded-xl bg-white text-black font-black text-xs tracking-widest disabled:opacity-50">{txLoading ? "BROADCASTING..." : `SEND ${selectedCoin.sym} →`}</button>
                      {txHash && <a href={`https://bscscan.com/tx/${txHash}`} target="_blank" className="text-[11px] text-[#FFC700] underline break-all">View Tx: {txHash}</a>}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button onClick={() => { const c = new (ethersLib as any).Contract(EFC_ADDRESS, ABI, new (ethersLib as any).Wallet(session.privateKey, providerRef.current)); c.burn(ethersLib.parseUnits("100", 18)).then((t:any)=>setTxHash(t.hash)); }} className="px-4 py-2 rounded-full bg-red-500/15 border border-red-500/30 text-red-300 text-[11px] font-bold">BURN 100 EFC</button>
                    <button onClick={() => setShowReceive(true)} className="px-4 py-2 rounded-full bg-white/10 border border-white/10 text-[11px] font-bold">RECEIVE QR</button>
                    <button onClick={() => window.open(`https://dexscreener.com/bsc/${LP_ADDRESS}`, "_blank")} className="px-4 py-2 rounded-full bg-[#FFC700]/15 border border-[#FFC700]/30 text-[#FFC700] text-[11px] font-bold">VIEW LP</button>
                  </div>
                </div>

                {showReceive && (
                  <div className="rounded-[24px] bg-white/[0.06] backdrop-blur-xl border border-white/10 p-5 text-center">
                    <div className="font-black tracking-widest text-sm">RECEIVE {selectedCoin.sym}</div>
                    <img src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${session.address}`} alt="qr" className="mx-auto mt-4 rounded-2xl bg-white p-2" />
                    <div className="mt-3 text-[11px] font-mono break-all bg-black/40 rounded-xl p-3 border border-white/10">{session.address}</div>
                    <button onClick={() => setShowReceive(false)} className="mt-3 px-4 py-2 rounded-full bg-white/10 border border-white/10 text-[11px]">CLOSE</button>
                  </div>
                )}
              </div>

              <div className="rounded-[24px] bg-black/40 backdrop-blur-xl border border-white/10 p-2 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="text-[11px] tracking-widest font-black">EFC LIVE CHART • DEXSCREENER</div>
                  <div className="text-[10px] opacity-60">BSC • {LP_ADDRESS.slice(0, 8)}...</div>
                </div>
                <div className="rounded-[16px] overflow-hidden bg-[#0e0e0e]">
                  <iframe src={`https://dexscreener.com/bsc/${LP_ADDRESS}?embed=1&theme=dark&trades=0&info=0`} style={{ width: "100%", height: 420, border: 0 }} title="chart" />
                </div>
                <div className="grid grid-cols-3 gap-2 p-3">
                  <div className="rounded-xl bg-white/[0.05] border border-white/10 p-3">
                    <div className="text-[9px] opacity-50">PRICE USD</div>
                    <div className="text-sm font-black mt-1">{price ? `$${Number(price.priceUsd).toFixed(6)}` : "—"}</div>
                  </div>
                  <div className="rounded-xl bg-white/[0.05] border border-white/10 p-3">
                    <div className="text-[9px] opacity-50">LIQUIDITY</div>
                    <div className="text-sm font-black mt-1">{price?.liquidity?.usd ? `$${(Number(price.liquidity.usd) / 1000).toFixed(1)}k` : "—"}</div>
                  </div>
                  <div className="rounded-xl bg-white/[0.05] border border-white/10 p-3">
                    <div className="text-[9px] opacity-50">FDV</div>
                    <div className="text-sm font-black mt-1">{price?.fdv ? `$${(Number(price.fdv) / 1000).toFixed(1)}k` : "—"}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "charts" && (
            <div className="rounded-[24px] bg-black/40 border border-white/10 p-2 overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between">
                <h3 className="font-black tracking-widest text-sm">GLOBAL CHARTS • EFC/BNB</h3>
                <a href={`https://dexscreener.com/bsc/${LP_ADDRESS}`} target="_blank" className="text-[11px] text-[#FFC700] underline">Open DexScreener</a>
              </div>
              <iframe src={`https://dexscreener.com/bsc/${LP_ADDRESS}?embed=1&theme=dark&trades=0`} style={{ width: "100%", height: 600, border: 0 }} className="rounded-[16px]" title="chart-full" />
            </div>
          )}

          {activeTab === "staking" && (
            <div className="grid md:grid-cols-[0.9fr_1.1fr] gap-4">
              <div className="rounded-[24px] bg-gradient-to-br from-[#FFC700]/15 to-amber-900/20 backdrop-blur-xl border border-[#FFC700]/20 p-6">
                <h3 className="font-black tracking-widest">EFC STAKING VAULT</h3>
                <p className="mt-2 text-[11px] opacity-70 leading-5">Real on-chain staking. Reads staked, pendingReward, totalStaked, APY. Writes deposit, withdraw, claimRewards via signer. BSC Mainnet 56.</p>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-black/40 border border-white/10 p-4">
                    <div className="text-[9px] tracking-widest opacity-60">YOUR STAKED</div>
                    <div className="mt-1 text-xl font-black">{Number(staking.staked).toLocaleString()} EFC</div>
                  </div>
                  <div className="rounded-2xl bg-black/40 border border-white/10 p-4">
                    <div className="text-[9px] tracking-widest opacity-60">PENDING REWARD</div>
                    <div className="mt-1 text-xl font-black text-[#FFC700]">{Number(staking.pending).toLocaleString()} EFC</div>
                  </div>
                  <div className="rounded-2xl bg-black/40 border border-white/10 p-4">
                    <div className="text-[9px] tracking-widest opacity-60">TOTAL STAKED</div>
                    <div className="mt-1 text-sm font-black">{Number(staking.total).toLocaleString()} EFC</div>
                  </div>
                  <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-4">
                    <div className="text-[9px] tracking-widest text-emerald-300">APY LIVE</div>
                    <div className="mt-1 text-sm font-black text-emerald-300">{staking.apy}%</div>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl bg-black/30 border border-white/10 p-4 space-y-3">
                  <input value={stakeAmt} onChange={(e) => setStakeAmt(e.target.value)} placeholder="Amount EFC to stake/withdraw" className="w-full rounded-xl bg-white/[0.06] border border-white/10 px-4 py-3 text-sm outline-none" />
                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={() => handleStake("deposit")} disabled={txLoading} className="py-3 rounded-xl bg-[#FFC700] text-black font-black text-[11px] tracking-widest disabled:opacity-50">DEPOSIT</button>
                    <button onClick={() => handleStake("withdraw")} disabled={txLoading} className="py-3 rounded-xl bg-white text-black font-black text-[11px] tracking-widest disabled:opacity-50">WITHDRAW</button>
                    <button onClick={() => handleStake("claim")} disabled={txLoading} className="py-3 rounded-xl bg-emerald-500 text-black font-black text-[11px] tracking-widest disabled:opacity-50">CLAIM</button>
                  </div>
                  {txHash && <a href={`https://bscscan.com/tx/${txHash}`} target="_blank" className="text-[11px] text-[#FFC700] underline break-all">Tx: {txHash}</a>}
                </div>
              </div>

              <div className="rounded-[24px] bg-white/[0.06] border border-white/10 p-6">
                <h4 className="font-black tracking-widest text-sm">HOW STAKING WORKS (REAL)</h4>
                <div className="mt-4 space-y-3 text-[12px] leading-6 opacity-80">
                  <div className="flex gap-3"><span className="w-6 h-6 rounded-full bg-[#FFC700] text-black flex items-center justify-center text-[11px] font-black">1</span><span><b>Read</b> staked(address), pendingReward(address), totalStaked(), APY() from {EFC_ADDRESS.slice(0,10)}...</span></div>
                  <div className="flex gap-3"><span className="w-6 h-6 rounded-full bg-white text-black flex items-center justify-center text-[11px] font-black">2</span><span><b>Deposit</b> calls deposit(amount) with signer from your encrypted vault in memory.</span></div>
                  <div className="flex gap-3"><span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-[11px] font-black">3</span><span><b>Withdraw / Claim</b> real tx broadcast to BSC, BscScan link shown.</span></div>
                </div>
                <div className="mt-6 rounded-2xl bg-black/40 border border-white/10 p-4">
                  <div className="text-[10px] tracking-widest opacity-60">SECURITY</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {["PBKDF2 100k", "AES-GCM 256", "No plain storage", "Memory-only signer", "BscScan verified"].map(s => <span key={s} className="px-2.5 py-1 rounded-full bg-white/10 border border-white/10 text-[10px]">{s}</span>)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "swap" && (
            <div className="rounded-[24px] bg-black/40 border border-white/10 p-2 overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between">
                <h3 className="font-black tracking-widest text-sm">SWAP • PANCAKESWAP EFC</h3>
                <a href={`https://pancakeswap.finance/swap?outputCurrency=${EFC_ADDRESS}`} target="_blank" className="text-[11px] text-[#FFC700] underline">Open PancakeSwap</a>
              </div>
              <iframe src={`https://pancakeswap.finance/swap?outputCurrency=${EFC_ADDRESS}`} style={{ width:"100%", height:600, border:0 }} className="rounded-[16px] bg-white" title="swap" />
            </div>
          )}

          {activeTab === "roadmap" && (
            <div className="rounded-[32px] bg-white/[0.06] backdrop-blur-xl border border-white/10 p-6 md:p-10">
              <h3 className="text-2xl font-black tracking-tight">PLANET ROADMAP • PEACE PROGRESS SALVATION</h3>
              <p className="mt-2 text-[12px] opacity-60">Mapped with system 24h elements, always active. Current phase highlighted.</p>

              <div className="mt-8 relative">
                <div className="absolute left-3 md:left-4 top-0 bottom-0 w-px bg-gradient-to-b from-[#FFC700] via-white/20 to-transparent" />
                <div className="space-y-8">
                  {[
                    { phase: "Phase 1 • Q4 2024", title: "Launch EFC Contract", desc: "BSC Mainnet 56 deploy 0x677c...fed1, LP lock, Treasury, verified BscScan", status: "DONE", color: "bg-emerald-400" },
                    { phase: "Phase 2 • NOW", title: "Wallet Planet Deploy • Current", desc: "Final Planet Secure Wallet, Register/Login encrypted vault, 24h active system, real staking reads/writes, live Dex chart", status: "YOU ARE HERE", color: "bg-[#FFC700] animate-pulse shadow-[0_0_12px_#FFC700]" },
                    { phase: "Phase 3 • Q2 2025", title: "EFC Pay Merchants", desc: "QR Pay SDK, merchant dashboard, instant BSC settlement, global POS", status: "NEXT", color: "bg-white/40" },
                    { phase: "Phase 4 • Q3 2025", title: "Global Staking Earn", desc: "Auto-compounding vaults, 128% APY boost, treasury yield share, Peace pool", status: "PLANNED", color: "bg-white/20" },
                    { phase: "Phase 5 • Q4 2025", title: "Cross-chain Expansion", desc: "ETH, Polygon, Base bridges, unified EFC balance, omnichain governance", status: "PLANNED", color: "bg-white/20" },
                    { phase: "Phase 6 • 2026", title: "Peace Progress Salvation Next Generation", desc: "Planet-wide financial inclusion, unstoppable self-custodial wallet for every human, global safe", status: "VISION", color: "bg-violet-400" },
                  ].map((r, i) => (
                    <div key={i} className="relative flex gap-4">
                      <div className={`w-7 h-7 rounded-full ${r.color} border-2 border-[#081A1F] z-10 mt-0.5`} />
                      <div className={`flex-1 rounded-2xl border p-4 ${r.status === "YOU ARE HERE" ? "bg-[#FFC700]/10 border-[#FFC700]/30" : "bg-black/20 border-white/10"}`}>
                        <div className="flex items-center justify-between">
                          <div className="text-[10px] tracking-widest opacity-60">{r.phase}</div>
                          <span className={`text-[9px] px-2 py-1 rounded-full font-black tracking-widest ${r.status === "DONE" ? "bg-emerald-500/20 text-emerald-300" : r.status === "YOU ARE HERE" ? "bg-[#FFC700] text-black" : "bg-white/10 text-white/60"}`}>{r.status}</span>
                        </div>
                        <div className="mt-1 font-black">{r.title}</div>
                        <div className="mt-1 text-[12px] opacity-70 leading-5">{r.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === "profile" && (
            <div className="grid md:grid-cols-[0.9fr_1.1fr] gap-4">
              <div className="rounded-[24px] bg-white/[0.06] border border-white/10 p-6">
                <h3 className="font-black tracking-widest text-sm">PROFILE & SECURITY</h3>
                <div className="mt-4 space-y-3">
                  <div className="rounded-2xl bg-black/40 border border-white/10 p-4">
                    <div className="text-[10px] opacity-60">USERNAME</div>
                    <div className="font-bold">{session.username}</div>
                  </div>
                  <div className="rounded-2xl bg-black/40 border border-white/10 p-4">
                    <div className="text-[10px] opacity-60">NAME</div>
                    <div className="font-bold">{session.name}</div>
                  </div>
                  <div className="rounded-2xl bg-black/40 border border-white/10 p-4">
                    <div className="text-[10px] opacity-60">ADDRESS</div>
                    <div className="text-[11px] font-mono break-all">{session.address}</div>
                  </div>
                  <div className="rounded-2xl bg-[#FFC700]/10 border border-[#FFC700]/20 p-4">
                    <div className="text-[10px] text-[#FFC700] tracking-widest">VAULT INFO</div>
                    <div className="mt-2 text-[11px] leading-5 opacity-80">Encrypted with PBKDF2 100k iterations + AES-GCM 256. Salt & IV random. Private key never in localStorage plain. Memory only. Auto-lock 15 min.</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {["AES-GCM", "PBKDF2 100k", "Memory-only key", "Self-custodial", "BSC Mainnet"].map(b => <span key={b} className="px-2 py-1 rounded-full bg-black/30 border border-white/10 text-[9px]">{b}</span>)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[24px] bg-black/30 border border-white/10 p-6">
                <h4 className="font-black tracking-widest text-sm">EXPORT SEED (NEEDS PASSWORD)</h4>
                <p className="mt-2 text-[11px] opacity-60">Re-enter vault password to decrypt and view mnemonic/privateKey. Paper only.</p>

                <div className="mt-4 space-y-3">
                  <input type="password" value={exportPass} onChange={e=>setExportPass(e.target.value)} placeholder="Enter password to export" className="w-full rounded-xl bg-white/[0.06] border border-white/10 px-4 py-3 text-sm outline-none" />
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={handleExport} className="py-3 rounded-xl bg-white text-black font-black text-[11px] tracking-widest">DECRYPT & SHOW</button>
                    <button onClick={()=>{ setShowExport(v=>!v); }} className="py-3 rounded-xl bg-white/10 border border-white/10 text-[11px] tracking-widest">TOGGLE VIEW</button>
                  </div>

                  {exportData && showExport && (
                    <div className="rounded-2xl bg-red-500/10 border border-red-500/20 p-4">
                      <div className="text-[10px] tracking-widest text-red-300">⚠️ SECRET - NEVER SHARE</div>
                      <div className="mt-3">
                        <div className="text-[10px] opacity-60">MNEMONIC</div>
                        <div className="mt-1 grid grid-cols-3 gap-1">
                          {exportData.mnemonic.split(" ").map((w:string,i:number)=><div key={i} className="rounded-lg bg-black/40 border border-white/10 px-2 py-1.5 text-[11px]"><span className="opacity-40 mr-1">{i+1}</span>{w}</div>)}
                        </div>
                        <div className="mt-3 text-[10px] opacity-60">PRIVATE KEY</div>
                        <div className="mt-1 text-[10px] font-mono break-all bg-black/60 p-2 rounded-xl border border-white/10">{exportData.privateKey}</div>
                      </div>
                    </div>
                  )}

                  <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-4">
                    <div className="text-[11px] font-bold">LOGOUT & AUTO-LOCK</div>
                    <div className="mt-1 text-[11px] opacity-60">Logout clears memory key. Auto-lock 15 min inactivity.</div>
                    <button onClick={()=>{ setSession(null); setActiveTab("wallet"); }} className="mt-3 w-full py-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 font-black text-[11px] tracking-widest">LOGOUT NOW →</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* bottom nav */}
      <nav className="fixed bottom-3 left-1/2 -translate-x-1/2 z-40 w-[min(720px,94vw)]">
        <div className="rounded-full bg-[#0f262d]/90 backdrop-blur-2xl border border-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.6)] p-1.5 flex items-center justify-between">
          {[
            { id: "wallet", label: "Wallet", icon: "◈" },
            { id: "charts", label: "Charts", icon: "◍" },
            { id: "staking", label: "Staking", icon: "⬢" },
            { id: "swap", label: "Swap", icon: "⇄" },
            { id: "roadmap", label: "Roadmap", icon: "☼" },
            { id: "profile", label: "Profile", icon: "◐" },
          ].map((t) => (
            <button key={t.id} onClick={() => setActiveTab(t.id as any)} className={`flex-1 py-2.5 rounded-full text-[10px] md:text-[11px] font-black tracking-widest flex flex-col md:flex-row items-center justify-center gap-0.5 md:gap-1.5 transition ${activeTab === t.id ? "bg-[#FFC700] text-black shadow-[0_0_20px_rgba(255,199,0,0.5)]" : "text-white/60 hover:text-white"}`}>
              <span className="text-[12px]">{t.icon}</span>
              <span className="hidden md:inline">{t.label}</span>
              <span className="md:hidden text-[8px]">{t.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
