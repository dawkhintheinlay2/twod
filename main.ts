import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { crypto } from "https://deno.land/std@0.177.0/crypto/mod.ts";

const kv = await Deno.openKv();

// ==========================================
// 1. HELPER FUNCTIONS (အကူအညီပေးမည့် လုပ်ဆောင်ချက်များ)
// ==========================================

async function hashPassword(p: string, s: string) {
  const data = new TextEncoder().encode(p + s);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateId() { return crypto.randomUUID(); }

// --- FORMULA 1: 5/10 Difference ---
function calculateFormula5_10(twod: string) {
    try {
        if(!twod) return null;
        const digits = twod.split('').map(Number);
        let results = [];
        let originalSums = [];
        for (let n of digits) {
            if(isNaN(n)) continue;
            // Logic: 5 ဖြစ်ဖို့လိုတာ၊ 10 ဖြစ်ဖို့လိုတာ + 1
            let diff5 = (5 - (n % 5));
            let diff10 = (10 - (n % 10));
            if(diff10===10) diff10=0;
            
            let to5 = (diff5 + 1) % 10;
            let to10 = (diff10 + 1) % 10;
            
            originalSums.push(diff5); originalSums.push(diff10);
            results.push(to5); results.push(to10);
        }
        let finalSet = new Set(results);
        // ၃ လုံးမပြည့်ရင် မူရင်းပေါင်းလဒ် ပြန်ထည့်
        if (finalSet.size < 3) { 
            for (let n of originalSums) { finalSet.add(n); if (finalSet.size >= 3) break; } 
        }
        return Array.from(finalSet).join(", ");
    } catch (e) { return "Error"; }
}

// --- FORMULA 2: Set/Value ---
function calculateFormulaSetVal(setStr: string, valStr: string) {
    try {
        if (!setStr || !valStr) return null;
        const s = setStr.replace(/,/g, ""); 
        const v = valStr.replace(/,/g, ""); 
        
        // ဒသမရှေ့က ဂဏန်းများယူမယ်
        const sInt = s.split('.')[0];
        const vInt = v.split('.')[0];

        // နောက်ဆုံး ၃ လုံးစီ ဖြတ်ယူ
        const sDigits = sInt.slice(-3).split('').map(Number); 
        const vDigits = vInt.slice(-3).split('').map(Number);
        
        let incremented = []; 
        let originalSums = [];

        for (let i = 0; i < sDigits.length; i++) {
            let sum = (sDigits[i] + (vDigits[i] || 0)) % 10;
            let inc = (sum + 1) % 10;
            originalSums.push(sum); 
            incremented.push(inc);
        }
        
        let finalSet = new Set(incremented);
        if (finalSet.size < 3) { 
            for (let num of originalSums) { finalSet.add(num); if (finalSet.size >= 3) break; } 
        }
        return Array.from(finalSet).join(", ");
    } catch (e) { return null; }
}

// ==========================================
// 2. CRON JOB (History Auto Save)
// ==========================================
Deno.cron("Save History", "*/5 * * * *", async () => {
  try {
    const res = await fetch("https://api.thaistock2d.com/live");
    const data = await res.json();
    const now = new Date();
    const mmDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Yangon" }));
    const dateKey = mmDate.getFullYear() + "-" + String(mmDate.getMonth() + 1).padStart(2, '0') + "-" + String(mmDate.getDate()).padStart(2, '0');
    
    // စနေ၊ တနင်္ဂနွေ ပိတ်
    if (mmDate.getDay() === 0 || mmDate.getDay() === 6) return; 

    let m = "--", e = "--";
    if (data.result) {
        if (data.result[1] && data.result[1].twod) m = data.result[1].twod;
        const ev = data.result[3] || data.result[2];
        if (ev && ev.twod) e = ev.twod;
    }
    
    // Update Database
    if (m !== "--" || e !== "--") {
        const ex = await kv.get(["history", dateKey]);
        const old = ex.value as any || { morning: "--", evening: "--" };
        await kv.set(["history", dateKey], { 
            morning: m !== "--" ? m : old.morning, 
            evening: e !== "--" ? e : old.evening, 
            date: dateKey 
        });
    }
  } catch (e) {}
});

// ==========================================
// 3. SERVER HANDLER (Main Logic)
// ==========================================
serve(async (req) => {
  const url = new URL(req.url);

  // --- EMERGENCY ADMIN RESET ---
  if (url.pathname === "/reset_admin") {
      await kv.delete(["users", "admin"]);
      return new Response("Admin Account Deleted. Register again as 'admin'.", {status: 200});
  }

  // --- PWA FILES ---
  if (url.pathname === "/manifest.json") {
      return new Response(JSON.stringify({
          name: "VIP 2D", short_name: "VIP 2D", start_url: "/", display: "standalone",
          background_color: "#0f172a", theme_color: "#0f172a",
          icons: [{ src: "https://img.icons8.com/color/192/shop.png", sizes: "192x192", type: "image/png" }]
      }), { headers: { "content-type": "application/json" } });
  }
  if (url.pathname === "/sw.js") {
      return new Response(`
        const CACHE_NAME = 'v2d-static-v2';
        self.addEventListener('install', e => e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(['/', '/manifest.json']))));
        self.addEventListener('fetch', e => e.respondWith(fetch(e.request).catch(() => caches.match(e.request))));
      `, { headers: { "content-type": "application/javascript" } });
  }

  // --- AUTH CHECK ---
  const cookies = req.headers.get("Cookie") || "";
  const userCookie = cookies.split(";").find(c => c.trim().startsWith("user="));
  const currentUser = userCookie ? decodeURIComponent(userCookie.split("=")[1].trim()) : null;
  const isAdmin = currentUser === "admin"; 

  // --- BOT PREDICTION API (MANUAL DATA SOURCE) ---
  if (req.method === "POST" && url.pathname === "/bot_predict") {
      try {
          const { type } = await req.json();
          
          // Admin ထည့်ထားသော Manual Data ကို ဆွဲထုတ်မည်
          const entry = await kv.get(["system", "manual_data"]);
          const manualData = entry.value as any || {};
          
          let resultHtml = "";
          let title = "";

          if (type === 'morning') {
              title = `Morning Prediction`;
              // မနက်အတွက် -> ညနေဂဏန်းဟောင်း လိုအပ်သည်
              const baseNum = manualData.evening_result;

              if (baseNum && baseNum.trim() !== "") {
                  const pred = calculateFormula5_10(baseNum);
                  resultHtml = `
                  <div class="text-center space-y-4 animate-[fadeIn_0.5s]">
                     <div class="text-xs text-gray-400">တွက်ချက်ရန် အခြေခံဂဏန်း: <b class="text-white">${baseNum}</b></div>
                     <div class="bg-yellow-500/10 p-4 rounded-xl border border-yellow-500/50 shadow-lg shadow-yellow-500/10">
                         <div class="text-yellow-500 font-bold text-sm mb-1 uppercase">Formula 1 (5/10 Diff)</div>
                         <div class="text-3xl font-bold text-white tracking-[5px]">${pred}</div>
                     </div>
                     <div class="text-[10px] text-gray-500 mt-2">For Next Morning (မနက်ဖြန် မနက်အတွက်)</div>
                  </div>`;
              } else {
                  resultHtml = `<div class="text-center py-8"><div class="text-2xl text-gray-300 font-bold mb-2"><i class="fas fa-clock mb-2 block"></i>Come back later</div><div class="text-xs text-gray-500">Admin hasn't updated the data yet.</div></div>`;
              }

          } else {
              title = `Evening Prediction`;
              // ညနေအတွက် -> မနက်ဂဏန်း လိုအပ်သည်
              const baseNum = manualData.morning_result;
              const set = manualData.morning_set;
              const val = manualData.morning_val;

              if (baseNum && baseNum.trim() !== "") {
                  const pred1 = calculateFormula5_10(baseNum);
                  const pred2 = (set && val) ? calculateFormulaSetVal(set, val) : null;
                  
                  resultHtml = `
                  <div class="text-center space-y-4 animate-[fadeIn_0.5s]">
                    <div class="text-xs text-gray-400">တွက်ချက်ရန် အခြေခံဂဏန်း: <b class="text-white">${baseNum}</b></div>
                    
                    <div class="bg-yellow-500/10 p-3 rounded-xl border border-yellow-500/50 shadow">
                        <div class="text-yellow-500 font-bold text-xs mb-1">FORMULA 1</div>
                        <div class="text-2xl font-bold text-white tracking-[3px]">${pred1 || "Error"}</div>
                    </div>

                    ${pred2 ? `
                    <div class="bg-blue-500/10 p-3 rounded-xl border border-blue-500/50 shadow">
                        <div class="text-blue-400 font-bold text-xs mb-1">FORMULA 2 (Set/Value)</div>
                        <div class="text-2xl font-bold text-white tracking-[3px]">${pred2}</div>
                    </div>` : `<div class="text-xs text-gray-500 italic p-2 border border-dashed border-gray-700 rounded">Set/Value data waiting...</div>`}
                    
                    <div class="text-[10px] text-gray-500 mt-2">For This Evening (ဒီညနေ အတွက်)</div>
                  </div>`;
              } else {
                  resultHtml = `<div class="text-center py-8"><div class="text-2xl text-gray-300 font-bold mb-2"><i class="fas fa-clock mb-2 block"></i>Come back later</div><div class="text-xs text-gray-500">Morning result not released yet.</div></div>`;
              }
          }
          return new Response(JSON.stringify({ html: resultHtml, title }), { headers: { "Content-Type": "application/json" } });
      } catch (e) { return new Response(JSON.stringify({ error: "System Error" }), { headers: { "Content-Type": "application/json" } }); }
  }

  // --- ADMIN DATA SAVE (Manual Entry) ---
  if (isAdmin && req.method === "POST" && url.pathname === "/admin/save_data") {
      const form = await req.formData();
      const data = {
          date_display: form.get("date_display")?.toString(),
          morning_result: form.get("m_res")?.toString(),
          morning_set: form.get("m_set")?.toString(),
          morning_val: form.get("m_val")?.toString(),
          evening_result: form.get("e_res")?.toString()
      };
      await kv.set(["system", "manual_data"], data);
      return new Response(null, { status: 303, headers: { "Location": "/" } });
  }

  // ==========================================
  // 4. COMMON UI (HTML HEAD)
  // ==========================================
  const commonHead = `
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#0f172a">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
  <script src="https://html2canvas.hertzen.com/dist/html2canvas.min.js"></script>
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;700&family=Roboto+Mono:wght@500&display=swap" rel="stylesheet">
  
  <style>
    body { font-family: 'Poppins', sans-serif; background: #0f172a; color: #e2e8f0; -webkit-tap-highlight-color: transparent; padding-bottom: 80px; }
    .font-mono { font-family: 'Roboto Mono', monospace; }
    .glass { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.05); }
    .gold-text { background: linear-gradient(to right, #bf953f, #fcf6ba, #b38728, #fbf5b7, #aa771c); -webkit-background-clip: text; color: transparent; }
    .gold-bg { background: linear-gradient(to bottom right, #bf953f, #aa771c); color: #000; }
    .input-dark { background: #1e293b; border: 1px solid #334155; color: white; border-radius: 0.5rem; padding: 0.5rem; width: 100%; transition: all 0.3s; }
    .input-dark:focus { outline: none; border-color: #eab308; box-shadow: 0 0 0 2px rgba(234, 179, 8, 0.2); }
    
    .loader { border: 3px solid #f3f3f3; border-top: 3px solid #eab308; border-radius: 50%; width: 30px; height: 30px; animation: spin 1s linear infinite; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    
    .slide-up { animation: slideUp 0.3s ease-out; }
    @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
    
    .nav-item.active { color: #eab308; }
    .nav-item.active i { transform: translateY(-5px); transition: 0.3s; }
    
    .btn-box { background: linear-gradient(135deg, #1e293b, #0f172a); border: 1px solid #334155; border-radius: 20px; padding: 20px; text-align: center; box-shadow: 0 4px 15px rgba(0,0,0,0.3); transition: all 0.2s; cursor: pointer; position: relative; overflow: hidden; }
    .btn-box:active { transform: scale(0.98); }
    .btn-box::after { content: ''; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(to bottom, rgba(255,255,255,0.05), transparent); pointer-events: none; }
  </style>
  <script>
    if ('serviceWorker' in navigator) { window.addEventListener('load', ()=>navigator.serviceWorker.register('/sw.js')); }
    function showLoad() { document.getElementById('loader').classList.remove('hidden'); }
    function hideLoad() { document.getElementById('loader').classList.add('hidden'); }
    function doLogout() { showLoad(); setTimeout(() => window.location.href = '/logout', 800); }
    
    window.addEventListener('beforeunload', () => showLoad()); // Refresh Loading Effect

    async function adminSubmit(e) {
        e.preventDefault(); showLoad(); const f = e.target, fd = new FormData(f), u = f.getAttribute('action');
        try { const r = await fetch(u, {method:'POST', body:fd}); const d = await r.json(); hideLoad();
            if(d.status === 'success') {
                if(d.winners) Swal.fire({title:'Winners', html: d.winners.length ? d.winners.map(w => \`<div>\${w.user}: \${w.amount}</div>\`).join('') : 'No Winners', icon:'info', background:'#1e293b', color:'#fff'}).then(()=>location.reload());
                else Swal.fire({icon:'success', title:'Success', timer:1000, showConfirmButton:false, background:'#1e293b', color:'#fff'}).then(()=>location.reload());
            } else Swal.fire({icon:'error', title:'Failed', background:'#1e293b', color:'#fff'});
        } catch(e) { hideLoad(); Swal.fire({icon:'error', title:'Error', background:'#1e293b', color:'#fff'}); }
    }
    function delBet(id) { 
        Swal.fire({title:'Delete Bet?', icon:'warning', showCancelButton:true, confirmButtonColor:'#d33', background:'#1e293b', color:'#fff'}).then(r => { 
            if(r.isConfirmed) { showLoad(); const fd = new FormData(); fd.append('id', id); fetch('/admin/delete_bet', {method:'POST', body:fd}).then(res=>res.json()).then(d=>{ hideLoad(); location.reload(); }); } 
        }); 
    }
  </script>`;

  const loaderHTML = `<div id="loader" class="fixed inset-0 bg-black/90 z-[9999] hidden flex items-center justify-center backdrop-blur-sm"><div class="loader"></div></div>`;
  
  // ==========================================
  // 5. LOGIN / REGISTER PAGE
  // ==========================================
  if (!currentUser) {
     if (req.method === "POST") {
          const form = await req.formData();
          const u = form.get("username")?.toString().trim(); 
          const p = form.get("password")?.toString();
          const remember = form.get("remember");

          if (url.pathname === "/register") {
              if(await kv.get(["users", u]).then(r=>r.value)) return Response.redirect("/?error=exists");
              const salt = generateId(); const hash = await hashPassword(p, salt);
              await kv.set(["users", u], { passwordHash: hash, salt, balance: 0, joined: new Date().toISOString() });
          } else {
              const uD = (await kv.get(["users", u])).value as any;
              if(!uD || uD.passwordHash !== await hashPassword(p, uD.salt)) return Response.redirect("/?error=invalid");
          }
          const h = new Headers({"Location":"/"}); 
          let cookieStr = `user=${encodeURIComponent(u)}; Path=/; HttpOnly; SameSite=Lax`;
          if(remember) cookieStr += "; Max-Age=1296000";
          h.set("Set-Cookie", cookieStr);
          return new Response(null, { status: 303, headers: h });
      }
      return new Response(`<!DOCTYPE html><html><head><title>Login</title>${commonHead}</head><body class="flex items-center justify-center min-h-screen"><div class="p-6 w-full max-w-sm text-center"><h1 class="text-4xl font-bold text-white mb-2 tracking-widest">VIP 2D</h1><p class="text-gray-400 text-xs mb-8 uppercase tracking-[3px]">Premium Betting App</p><div class="glass rounded-2xl p-6 shadow-2xl border-t border-white/10"><div class="flex mb-6 bg-slate-800/50 rounded-lg p-1"><button onclick="switchTab('login')" id="tabLogin" class="flex-1 py-2 text-sm font-bold rounded-md bg-slate-700 text-white transition-all shadow">LOGIN</button><button onclick="switchTab('reg')" id="tabReg" class="flex-1 py-2 text-sm font-bold rounded-md text-gray-400 hover:text-white transition-all">REGISTER</button></div><form id="loginForm" action="/login" method="POST" onsubmit="showLoad()"><div class="space-y-4"><div class="relative"><i class="fas fa-user absolute left-3 top-3.5 text-gray-500"></i><input name="username" placeholder="Username" class="w-full pl-10 p-3 rounded-xl input-dark" required></div><div class="relative"><i class="fas fa-lock absolute left-3 top-3.5 text-gray-500"></i><input name="password" type="password" placeholder="Password" class="w-full pl-10 p-3 rounded-xl input-dark" required></div><label class="flex items-center text-xs text-gray-400 cursor-pointer"><input type="checkbox" name="remember" class="mr-2 w-4 h-4 rounded border-gray-600 bg-slate-700 text-yellow-500 focus:ring-yellow-500" checked> Remember Me (15 Days)</label><button class="w-full py-3 rounded-xl gold-bg font-bold shadow-lg text-black hover:scale-[1.02] transition-transform">LOGIN NOW</button></div></form><form id="regForm" action="/register" method="POST" class="hidden" onsubmit="showLoad()"><div class="space-y-4"><div class="relative"><i class="fas fa-user-plus absolute left-3 top-3.5 text-gray-500"></i><input name="username" placeholder="Create Username" class="w-full pl-10 p-3 rounded-xl input-dark" required></div><div class="relative"><i class="fas fa-key absolute left-3 top-3.5 text-gray-500"></i><input name="password" type="password" placeholder="Create Password" class="w-full pl-10 p-3 rounded-xl input-dark" required></div><label class="flex items-center text-xs text-gray-400 cursor-pointer"><input type="checkbox" name="remember" class="mr-2 w-4 h-4 rounded border-gray-600 bg-slate-700 text-yellow-500 focus:ring-yellow-500" checked> Remember Me (15 Days)</label><button class="w-full py-3 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 transition-colors shadow-lg">CREATE ACCOUNT</button></div></form></div></div><script> function switchTab(t) { const l=document.getElementById('loginForm'),r=document.getElementById('regForm'),tl=document.getElementById('tabLogin'),tr=document.getElementById('tabReg'); if(t==='login'){l.classList.remove('hidden');r.classList.add('hidden');tl.className="flex-1 py-2 text-sm font-bold rounded-md bg-slate-700 text-white shadow";tr.className="flex-1 py-2 text-sm font-bold rounded-md text-gray-400 hover:text-white";}else{l.classList.add('hidden');r.classList.remove('hidden');tr.className="flex-1 py-2 text-sm font-bold rounded-md bg-slate-700 text-white shadow";tl.className="flex-1 py-2 text-sm font-bold rounded-md text-gray-400 hover:text-white";} } const u=new URLSearchParams(location.search); if(u.get('error')) Swal.fire({icon:'error',title:'Error',text:'Invalid Login or User Exists',background:'#1e293b',color:'#fff'}); </script></body></html>`, { headers: {"content-type": "text/html"} });
  }
  if(url.pathname==="/logout") return new Response(null,{status:303,headers:{"Location":"/","Set-Cookie":"user=;Path=/;Max-Age=0"}});

  // --- AUTHENTICATED USER DATA ---
  const uEntry = await kv.get(["users", currentUser]);
  const uData = uEntry.value as any;
  if (!uData) return Response.redirect(url.origin + "/logout"); // Session invalid check

  const manualDataEntry = await kv.get(["system", "manual_data"]);
  const mData = manualDataEntry.value as any || { date_display: "No Data", morning_result: "", morning_set: "", morning_val: "", evening_result: "" };

  // ==========================================
  // 6. BOT PAGE (Standalone)
  // ==========================================
  if(url.pathname==="/bot") {
      return new Response(`<!DOCTYPE html><html><head><title>Prediction Bot</title>${commonHead}</head><body class="flex flex-col h-screen">
      <div class="bg-slate-900 p-4 shadow-xl border-b border-slate-800 z-10 flex items-center gap-3">
         <a href="/" class="text-gray-400 hover:text-white transition"><i class="fas fa-arrow-left text-xl"></i></a>
         <h1 class="font-bold text-lg text-white tracking-wide">Auto Prediction</h1>
      </div>
      <div class="p-6 space-y-6 overflow-y-auto flex-1 flex flex-col justify-center">
         <div class="text-center mb-4 animate-[fadeIn_0.5s]">
            <div class="w-20 h-20 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-3 shadow-[0_0_20px_rgba(59,130,246,0.3)]">
                <i class="fas fa-robot text-4xl text-blue-500"></i>
            </div>
            <h2 class="text-xl font-bold text-white">Smart Calculator</h2>
            <p class="text-gray-400 text-sm mt-1">Target: <span class="text-yellow-400 font-bold">${mData.date_display}</span></p>
         </div>
         
         <div onclick="getPredict('morning')" class="btn-box group hover:border-yellow-500/50">
             <div class="w-12 h-12 rounded-full bg-yellow-500/20 flex items-center justify-center mx-auto mb-2 group-hover:scale-110 transition"><i class="fas fa-sun text-yellow-500 text-xl"></i></div>
             <h2 class="font-bold text-lg text-white">Morning Prediction</h2>
             <p class="text-xs text-gray-500 mt-1">Uses Formula 1</p>
         </div>

         <div onclick="getPredict('evening')" class="btn-box group hover:border-purple-500/50">
             <div class="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center mx-auto mb-2 group-hover:scale-110 transition"><i class="fas fa-moon text-purple-500 text-xl"></i></div>
             <h2 class="font-bold text-lg text-white">Evening Prediction</h2>
             <p class="text-xs text-gray-500 mt-1">Uses Formula 1 & 2</p>
         </div>
      </div>
      <script>
        async function getPredict(type) {
            showLoad();
            try {
                const res = await fetch('/bot_predict', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({type}) });
                const data = await res.json(); hideLoad();
                if(data.html) Swal.fire({ title: data.title, html: data.html, background: '#1e293b', color: '#fff', confirmButtonColor: '#3b82f6' });
                else Swal.fire({icon:'error', title:'No Data', text:'Please wait for admin update.', background:'#1e293b', color:'#fff'});
            } catch(e) { hideLoad(); Swal.fire({icon:'error', title:'Error', text:'Connection Failed', background:'#1e293b', color:'#fff'}); }
        }
      </script>${loaderHTML}</body></html>`, { headers: {"content-type": "text/html"} });
  }

  // ==========================================
  // 7. HOME PAGE & DASHBOARD
  // ==========================================
  const balance = uData.balance || 0;
  const avatar = uData.avatar || "";
  const dateStr = new Date().toLocaleString("en-US", {timeZone:"Asia/Yangon", day:'numeric', month:'short', year:'numeric'});
  const sys = { rate: (await kv.get(["system", "rate"])).value || 80, tip: (await kv.get(["system", "tip"])).value || "" };
  const bets = [];
  const bIter = kv.list({ prefix: ["bets"] }, { reverse: true, limit: isAdmin ? 100 : 50 });
  for await (const e of bIter) { const val = e.value as any; val.id = e.key[1]; if (isAdmin || val.user === currentUser) bets.push(val); }
  const blocks = []; for await (const e of kv.list({ prefix: ["blocks"] })) blocks.push(e.key[1]);
  let stats = { sale: 0, payout: 0 };
  if (isAdmin) {
      const all = kv.list({ prefix: ["bets"] });
      for await (const e of all) { const b = e.value as any; const d = new Date(parseInt(e.key[1])).toLocaleString("en-US", { timeZone: "Asia/Yangon", day: 'numeric', month: 'short', year: 'numeric' }); if (d === dateStr) { stats.sale += b.amount; if(b.status==="WIN") stats.payout += b.winAmount; } }
  }

  // Nav Bar HTML
  const navHTML = `
  <div class="fixed bottom-0 w-full glass border-t border-white/10 pb-safe flex justify-around items-center h-16 z-40">
      <a href="/" onclick="showLoad()" class="nav-item ${url.pathname==='/'?'active':''} flex flex-col items-center text-gray-400 hover:text-yellow-500"><i class="fas fa-home text-lg"></i><span class="text-[10px] mt-1">Home</span></a>
      <a href="/history" onclick="showLoad()" class="nav-item ${url.pathname==='/history'?'active':''} flex flex-col items-center text-gray-400 hover:text-yellow-500"><i class="fas fa-calendar-alt text-lg"></i><span class="text-[10px] mt-1">History</span></a>
      <a href="/profile" onclick="showLoad()" class="nav-item ${url.pathname==='/profile'?'active':''} flex flex-col items-center text-gray-400 hover:text-yellow-500"><i class="fas fa-user-circle text-lg"></i><span class="text-[10px] mt-1">Profile</span></a>
  </div>`;

  if (url.pathname === "/") {
  return new Response(`<!DOCTYPE html><html><head><title>Home</title>${commonHead}</head><body>${loaderHTML}
    <nav class="glass fixed top-0 w-full z-50 px-4 py-3 flex justify-between items-center shadow-lg">
        <div class="flex items-center gap-2">
           <div class="w-8 h-8 rounded-full gold-bg flex items-center justify-center font-bold text-black text-sm border-2 border-white overflow-hidden">${avatar ? `<img src="${avatar}" class="w-full h-full object-cover">` : currentUser[0].toUpperCase()}</div>
           <div><div class="text-[10px] text-gray-400 uppercase">Balance</div><div class="text-sm font-bold text-white font-mono">${balance.toLocaleString()} Ks</div></div>
        </div>
        ${isAdmin ? '<span class="bg-red-600 text-[10px] px-2 py-1 rounded font-bold animate-pulse">ADMIN</span>' : ''}
    </nav>

    <div class="pt-20 px-4 pb-24 max-w-md mx-auto space-y-6">
        <div class="glass rounded-3xl p-6 text-center relative overflow-hidden group">
            <div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-yellow-500 to-transparent opacity-50"></div>
            <div class="flex justify-between text-xs text-gray-400 mb-2 font-mono"><span id="live_date">--</span><span class="text-red-500 animate-pulse font-bold">● LIVE</span></div>
            <div class="py-2"><div id="live_twod" class="text-7xl font-bold gold-text font-mono drop-shadow-lg tracking-tighter">--</div><div class="text-xs text-gray-500 mt-2 font-mono">Updated: <span id="live_time">--:--:--</span></div></div>
            <div class="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-white/5"><div class="bg-black/20 rounded-lg p-2"><div class="text-[10px] text-gray-500">12:01 PM</div><div class="font-bold text-lg" id="res_12">--</div></div><div class="bg-black/20 rounded-lg p-2"><div class="text-[10px] text-gray-500">04:30 PM</div><div class="font-bold text-lg" id="res_430">--</div></div></div>
        </div>

        ${sys.tip ? `<div class="glass p-4 rounded-xl border-l-4 border-yellow-500 flex items-center gap-3"><div class="bg-yellow-500/20 p-2 rounded-full"><i class="fas fa-lightbulb text-yellow-500"></i></div><div class="flex-1"><div class="flex justify-between items-center text-[10px] text-gray-400 uppercase font-bold"><span>Daily Tip</span><span>${dateStr}</span></div><div class="font-bold text-sm text-white">${sys.tip}</div></div></div>` : ''}
        
        <a href="/bot" onclick="showLoad()" class="block w-full bg-gradient-to-r from-blue-600 to-blue-800 p-4 rounded-xl shadow-lg shadow-blue-600/20 text-center font-bold text-white active:scale-95 transition-transform flex items-center justify-center gap-2">
            <i class="fas fa-robot text-xl"></i> Auto Prediction Bot
        </a>

        ${isAdmin ? `
        <div class="bg-white p-4 rounded-xl shadow-lg border-l-4 border-red-500">
            <h3 class="font-bold text-red-600 mb-3 text-sm uppercase flex items-center gap-2"><i class="fas fa-user-shield"></i> Admin: Manual Data Entry</h3>
            <p class="text-[10px] text-gray-500 mb-2">Enter data here to update the Bot.</p>
            <form action="/admin/save_data" method="POST" onsubmit="adminSubmit(event)" class="space-y-3">
                <div><label class="text-[10px] font-bold text-gray-500 uppercase">Date (Display)</label><input name="date_display" value="${mData.date_display||''}" placeholder="e.g 24 Nov 2025" class="w-full border rounded p-2 text-xs bg-gray-50 text-black font-bold"></div>
                <div class="grid grid-cols-2 gap-2">
                    <div><label class="text-[10px] font-bold text-gray-500 uppercase">Morning (12:01)</label><input name="m_res" value="${mData.morning_result||''}" placeholder="41" class="w-full border rounded p-2 text-center font-bold text-black"></div>
                    <div><label class="text-[10px] font-bold text-gray-500 uppercase">Evening (04:30)</label><input name="e_res" value="${mData.evening_result||''}" placeholder="00" class="w-full border rounded p-2 text-center font-bold text-black"></div>
                </div>
                <div class="grid grid-cols-2 gap-2">
                    <div><label class="text-[10px] font-bold text-gray-500 uppercase">Set</label><input name="m_set" value="${mData.morning_set||''}" placeholder="1313.06" class="w-full border rounded p-2 text-xs text-black"></div>
                    <div><label class="text-[10px] font-bold text-gray-500 uppercase">Value</label><input name="m_val" value="${mData.morning_val||''}" placeholder="15716.28" class="w-full border rounded p-2 text-xs text-black"></div>
                </div>
                <button class="w-full bg-red-600 text-white text-xs font-bold py-3 rounded hover:bg-red-700 transition shadow-lg">UPDATE BOT DATA</button>
            </form>
        </div>
        
        <div class="glass p-4 rounded-xl space-y-4 border border-white/5">
            <h3 class="text-xs font-bold text-gray-400 uppercase mb-2">System Management</h3>
            
            <form action="/admin/payout" method="POST" onsubmit="adminSubmit(event)" class="flex gap-2 items-end">
                <div class="flex-1"><label class="text-[10px] text-gray-500">Win No</label><input name="win_number" placeholder="00" class="input-dark text-center font-bold text-yellow-500"></div>
                <div class="flex-1"><label class="text-[10px] text-gray-500">Session</label><select name="session" class="input-dark text-xs h-10"><option value="MORNING">12:01</option><option value="EVENING">04:30</option></select></div>
                <button class="bg-red-600 text-white text-xs px-4 py-3 rounded font-bold h-10">PAY</button>
            </form>

            <form action="/admin/topup" method="POST" onsubmit="adminSubmit(event)" class="flex gap-2 pt-2 border-t border-gray-700">
                <input name="username" placeholder="User" class="input-dark text-xs flex-1">
                <input name="amount" type="number" placeholder="Amount" class="input-dark w-24 text-xs">
                <button class="bg-green-600 text-white text-xs px-3 rounded font-bold">TOP</button>
            </form>

            <form action="/admin/settings" method="POST" onsubmit="adminSubmit(event)" class="pt-2 border-t border-gray-700 space-y-2">
                <div class="flex gap-2"><input name="rate" placeholder="Rate (80)" class="input-dark text-xs"><input name="tip" placeholder="Daily Tip" class="input-dark text-xs"></div>
                <div class="flex gap-2"><input name="kpay_no" placeholder="Kpay" class="input-dark text-xs"><input name="wave_no" placeholder="Wave" class="input-dark text-xs"></div>
                <button class="w-full bg-blue-600 text-white text-xs py-2 rounded font-bold">UPDATE SETTINGS</button>
            </form>
        </div>` : ''}

        ${!isAdmin ? `<button onclick="document.getElementById('betModal').classList.remove('hidden')" class="w-full gold-bg p-4 rounded-2xl shadow-lg shadow-yellow-600/20 font-bold text-black flex items-center justify-center gap-2 active:scale-95 transition"><i class="fas fa-plus-circle text-xl"></i> BET NOW (ထိုးမည်)</button>` : ''}

        <div class="glass rounded-xl p-4">
             <div class="flex justify-between items-center mb-3">
                <h3 class="font-bold text-gray-300 text-sm uppercase">Betting History</h3>
                <div class="flex gap-2"><input id="searchBet" onkeyup="filterBets()" placeholder="Search..." class="bg-black/30 border border-gray-600 text-white text-xs rounded px-2 py-1 w-24 focus:outline-none focus:border-yellow-500">${!isAdmin?`<button onclick="clrH()" class="text-xs text-red-400 px-2 border border-red-400/30 rounded hover:bg-red-500/10"><i class="fas fa-trash"></i></button>`:''}</div>
             </div>
             <div class="space-y-2 max-h-60 overflow-y-auto pr-1 custom-scroll" id="betListContainer">
                 ${bets.length === 0 ? '<div class="text-center text-gray-500 text-xs py-4">No history found</div>' : ''}
                 ${bets.map(b => `<div class="bet-item flex justify-between items-center p-3 rounded-lg bg-black/20 border-l-2 ${b.status==='WIN'?'border-green-500':b.status==='LOSE'?'border-red-500':'border-yellow-500'}" data-num="${b.number}" data-id="${b.id}" data-date="${b.date}" data-status="${b.status}" data-win="${b.winAmount||0}" data-user="${b.user}"><div><div class="font-mono font-bold text-lg text-white">${b.number}</div><div class="text-[10px] text-gray-500">${b.time} • ${b.user}</div></div><div class="flex items-center gap-3"><div class="text-right"><div class="font-mono text-sm font-bold text-gray-300">${b.amount.toLocaleString()}</div><div class="text-[10px] font-bold ${b.status==='WIN'?'text-green-500':b.status==='LOSE'?'text-red-500':'text-yellow-500'}">${b.status}</div></div>${isAdmin?`<button onclick="delBet('${b.id}')" class="text-red-500 text-xs bg-red-500/10 p-2 rounded hover:bg-red-500 hover:text-white transition"><i class="fas fa-trash"></i></button>`:''}</div></div>`).join('')}
             </div>
        </div>
    </div>
    ${navHTML}
    
    <div id="betModal" class="fixed inset-0 z-[100] hidden"><div class="absolute inset-0 bg-black/80 backdrop-blur-sm" onclick="document.getElementById('betModal').classList.add('hidden')"></div><div class="absolute bottom-0 w-full bg-[#1e293b] rounded-t-3xl p-6 slide-up shadow-2xl border-t border-yellow-500/30"><div class="flex justify-between items-center mb-4"><h2 class="text-xl font-bold text-white">Place Bet</h2><button onclick="document.getElementById('betModal').classList.add('hidden')" class="text-gray-400 text-2xl">&times;</button></div><div class="flex gap-2 mb-4 overflow-x-auto pb-2 no-scrollbar"><button onclick="setMode('direct')" class="px-4 py-1 bg-yellow-500 text-black text-xs font-bold rounded-full whitespace-nowrap">Direct</button><button onclick="quickInput('brake')" class="px-4 py-1 bg-slate-700 text-white text-xs font-bold rounded-full border border-slate-600">Brake</button><button onclick="quickInput('round')" class="px-4 py-1 bg-slate-700 text-white text-xs font-bold rounded-full border border-slate-600">Double</button><button onclick="quickInput('head')" class="px-4 py-1 bg-slate-700 text-white text-xs font-bold rounded-full border border-slate-600">Head</button><button onclick="quickInput('tail')" class="px-4 py-1 bg-slate-700 text-white text-xs font-bold rounded-full border border-slate-600">Tail</button></div><form onsubmit="confirmBet(event)"><div class="bg-black/30 p-3 rounded-xl border border-white/5 mb-4"><textarea id="betNums" name="number" class="w-full bg-transparent text-lg font-mono font-bold text-white placeholder-gray-600 focus:outline-none resize-none h-20" placeholder="12, 34, 56..."></textarea></div><div class="mb-6"><label class="text-xs text-gray-400 uppercase font-bold">Amount</label><input type="number" name="amount" id="betAmt" class="w-full p-3 bg-black/30 text-white font-bold focus:outline-none rounded-xl mt-2 border border-white/5" placeholder="Min 50" required></div><button class="w-full py-4 rounded-xl gold-bg text-black font-bold text-lg shadow-lg">CONFIRM BET</button></form></div></div>

    <div id="voucherModal" class="fixed inset-0 z-[110] hidden flex items-center justify-center p-6"><div class="absolute inset-0 bg-black/90" onclick="closeVoucher()"></div><div class="relative w-full max-w-xs bg-white text-slate-900 rounded-lg overflow-hidden shadow-2xl slide-up"><div id="voucherCapture" class="bg-white"><div class="bg-slate-900 text-white p-4 text-center font-bold uppercase text-sm border-b-4 border-yellow-500 tracking-widest">Bet Slip</div><div class="p-4 font-mono text-sm" id="voucherContent"></div></div><div class="p-3 bg-gray-100 text-center flex gap-2"><button onclick="saveVoucher()" class="flex-1 bg-blue-600 text-white text-xs font-bold py-2 rounded shadow hover:bg-blue-700">Save Image</button><button onclick="closeVoucher()" class="flex-1 text-xs font-bold text-slate-500 uppercase tracking-wide border border-slate-300 rounded py-2 hover:bg-gray-200">Close</button></div></div></div>

    <script>
        const API="https://api.thaistock2d.com/live";
        async function upL(){try{const r=await fetch(API);const d=await r.json();if(d.live){document.getElementById('live_twod').innerText=d.live.twod||"--";document.getElementById('live_time').innerText=d.live.time||"--:--:--";document.getElementById('live_date').innerText=d.live.date||"Today";}if(d.result){if(d.result[1])document.getElementById('res_12').innerText=d.result[1].twod||"--";const ev=d.result[3]||d.result[2];if(ev)document.getElementById('res_430').innerText=ev.twod||"--";}}catch(e){}}setInterval(upL,2000);upL();
        
        function filterBets() { const v = document.getElementById('searchBet').value.trim(); document.querySelectorAll('.bet-item').forEach(i => { i.style.display = i.getAttribute('data-num').includes(v) ? 'flex' : 'none'; }); }
        function closeVoucher() { showLoad(); setTimeout(() => location.reload(), 100); }
        function openBet(){document.getElementById('betModal').classList.remove('hidden');}
        function quickInput(m){Swal.fire({title:m.toUpperCase(),input:'number',background:'#1e293b',color:'#fff',confirmButtonColor:'#eab308'}).then(r=>{if(r.isConfirmed&&r.value){const v=r.value;let a=[];if(m==='round')for(let i=0;i<10;i++)a.push(i+""+i);if(m==='head')for(let i=0;i<10;i++)a.push(v+i);if(m==='tail')for(let i=0;i<10;i++)a.push(i+v);if(m==='brake'){if(v.length===2)a=v[0]===v[1]?[v]:[v,v[1]+v[0]];}const t=document.getElementById('betNums');let c=t.value.trim();if(c&&!c.endsWith(','))c+=',';t.value=c+a.join(',');}});}
        
        function confirmBet(e) { e.preventDefault(); const n = document.getElementById('betNums').value; const a = document.getElementById('betAmt').value; const count = n.split(',').filter(x=>x.trim()).length; const total = count * parseInt(a); Swal.fire({title: 'Confirm Bet?', html: \`Numbers: <b>\${count}</b><br>Amount: <b>\${a}</b><br>Total: <b class="text-yellow-400">\${total.toLocaleString()} Ks</b>\`, icon: 'question', showCancelButton: true, confirmButtonText: 'Submit', confirmButtonColor: '#eab308', background: '#1e293b', color: '#fff'}).then((result) => { if (result.isConfirmed) { submitBetData(e.target); } }); }
        
        async function submitBetData(form) { showLoad(); const fd=new FormData(form); try { const r=await fetch('/bet',{method:'POST',body:fd}); const d=await r.json(); hideLoad(); if(d.status==='success'){ document.getElementById('betModal').classList.add('hidden'); const v=d.voucher; document.getElementById('voucherContent').innerHTML=\`<div class="text-center mb-4 border-b border-dashed border-gray-300 pb-2"><div class="font-bold text-lg">\${v.user}</div><div class="text-xs text-gray-500">\${v.date} \${v.time}</div><div class="text-[10px] text-gray-400">ID: \${v.id}</div></div><div class="border-b border-dashed border-gray-300 pb-2 mb-2 space-y-1 max-h-40 overflow-y-auto custom-scroll font-mono text-sm">\${v.nums.map(n=>\`<div class="flex justify-between"><span>\${n}</span><span>\${v.amt}</span></div>\`).join('')}</div><div class="flex justify-between font-bold text-xl mt-2"><span>Total</span><span>\${v.total}</span></div><div class="text-center text-xs font-bold text-yellow-600 mt-4 uppercase tracking-wide">ကံကောင်းပါစေ (Good Luck)</div>\`; document.getElementById('voucherModal').classList.remove('hidden'); } else Swal.fire('Error',d.status,'error'); } catch(e){ hideLoad(); } }
        
        function saveVoucher() { const el = document.getElementById('voucherCapture'); html2canvas(el).then(canvas => { const link = document.createElement('a'); link.download = '2d_voucher_' + Date.now() + '.png'; link.href = canvas.toDataURL(); link.click(); }); }
        function clrH(){ Swal.fire({title:'Clear History?',text:'Only completed bets will be removed.',icon:'warning',showCancelButton:true,confirmButtonColor:'#d33',background:'#1e293b',color:'#fff'}).then(r=>{if(r.isConfirmed){showLoad();fetch('/clear_history',{method:'POST'}).then(res=>res.json()).then(d=>{hideLoad();Swal.fire({title:'Deleted!',icon:'success',timer:1500,showConfirmButton:false,background:'#1e293b',color:'#fff'}).then(()=>location.reload());});}}) }
        function delBet(id) { Swal.fire({title:'Delete Bet?', icon:'warning', showCancelButton:true, confirmButtonColor:'#d33', background:'#1e293b', color:'#fff'}).then(r => { if(r.isConfirmed) { showLoad(); const fd = new FormData(); fd.append('id', id); fetch('/admin/delete_bet', {method:'POST', body:fd}).then(res=>res.json()).then(d=>{ hideLoad(); if(d.status==='success') location.reload(); else Swal.fire('Error','Failed','error'); }); } }); }
        
        // WINNER ALERT
        window.onload = function() {
            const today = "${dateStr}"; const currentUser = "${currentUser}"; const bets = document.querySelectorAll('.bet-item'); let totalWin = 0;
            bets.forEach(b => { if(b.dataset.status === "WIN" && b.dataset.date === today && b.dataset.user === currentUser) { const id = b.dataset.id; if(!localStorage.getItem('seen_win_'+id)) { totalWin += parseInt(b.dataset.win); localStorage.setItem('seen_win_'+id, 'true'); } } });
            if(totalWin > 0) { Swal.fire({ title: 'CONGRATULATIONS!', text: 'You won ' + totalWin.toLocaleString() + ' Ks today!', icon: 'success', background: '#1e293b', color: '#fff', confirmButtonColor: '#eab308', backdrop: \`rgba(0,0,123,0.4) url("https://media.tenor.com/Confetti/confetti.gif") left top no-repeat\` }); }
        };
    </script></body></html>`, { headers: {"content-type": "text/html"} });
  }

  // ==========================================
  // 8. OTHER PAGES (Profile / History)
  // ==========================================
  if (url.pathname === "/profile") {
      const txs = [];
      for await (const e of kv.list({prefix:["transactions"]}, {reverse:true, limit:50})) { if(e.value.user===currentUser) { const t = e.value; t.id=e.key[1]; txs.push(t); } }
      const contact = (await kv.get(["system", "contact"])).value as any || {};
      return new Response(`<!DOCTYPE html><html><head><title>Profile</title>${commonHead}</head><body>${loaderHTML}${navHTML}
      <div class="p-6 max-w-md mx-auto space-y-4 pb-24">
         <div class="glass p-6 rounded-3xl text-center relative mt-4"><div class="relative w-24 h-24 mx-auto mb-3"><div class="w-24 h-24 rounded-full border-4 border-yellow-500 overflow-hidden relative bg-slate-800 flex items-center justify-center">${avatar ? `<img src="${avatar}" class="w-full h-full object-cover">` : `<i class="fas fa-user text-4xl text-gray-500"></i>`}</div><button onclick="document.getElementById('fIn').click()" class="absolute bottom-0 right-0 bg-white text-black rounded-full p-2 border-2 border-slate-900"><i class="fas fa-camera text-xs"></i></button><input type="file" id="fIn" hidden accept="image/*" onchange="upAv(this)"></div><h1 class="text-xl font-bold text-white uppercase">${currentUser}</h1><div class="text-yellow-500 font-mono font-bold text-lg">${balance.toLocaleString()} Ks</div></div>
         <div class="glass p-4 rounded-xl space-y-3"><h3 class="text-xs font-bold text-gray-400 uppercase">Contact Admin</h3><div class="grid grid-cols-2 gap-2"><div class="bg-blue-900/40 p-2 rounded border border-blue-500/30 text-center"><div class="text-blue-400 text-xs">KPay</div><div class="font-bold select-all text-sm">${contact.kpay_no||'-'}</div><div class="text-[10px] text-gray-500">${contact.kpay_name||''}</div></div><div class="bg-yellow-900/40 p-2 rounded border border-yellow-500/30 text-center"><div class="text-yellow-400 text-xs">Wave</div><div class="font-bold select-all text-sm">${contact.wave_no||'-'}</div><div class="text-[10px] text-gray-500">${contact.wave_name||''}</div></div></div><a href="${contact.tele_link||'#'}" target="_blank" class="block w-full bg-blue-600 text-white text-center py-2 rounded font-bold"><i class="fab fa-telegram"></i> Telegram Channel</a></div>
         <form action="/change_password" method="POST" class="glass p-4 rounded-xl flex gap-2" onsubmit="showLoad()"><input type="password" name="new_password" placeholder="New Password" class="input-dark text-sm" required><button class="bg-yellow-600 text-white px-4 rounded font-bold text-xs">CHANGE</button></form>
         <div class="glass rounded-xl p-4"><h3 class="text-xs font-bold text-gray-400 uppercase mb-3">Transaction History</h3><div class="space-y-2 h-48 overflow-y-auto">${txs.length?txs.map(t=>`<div class="flex justify-between items-center p-2 bg-slate-800 rounded border-l-2 border-green-500"><div><span class="text-xs text-gray-400 block">${t.time}</span><span class="text-[10px] text-blue-400 font-bold">${t.type}</span></div><div class="flex items-center gap-2"><span class="font-bold text-green-400">+${t.amount}</span><button onclick="delTx(event, '${t.id}')" class="text-gray-600 hover:text-red-500"><i class="fas fa-trash text-xs"></i></button></div></div>`).join(''):'<div class="text-center text-xs text-gray-500">No transactions</div>'}</div></div>
         <button onclick="doLogout()" class="block w-full text-center text-red-400 text-sm font-bold py-4">LOGOUT</button>
      </div>
      <script>
        function upAv(i){ if(i.files&&i.files[0]){ const r=new FileReader(); r.onload=function(e){ const im=new Image(); im.src=e.target.result; im.onload=function(){ const c=document.createElement('canvas'); const x=c.getContext('2d'); c.width=150;c.height=150; x.drawImage(im,0,0,150,150); showLoad(); const fd=new FormData(); fd.append('avatar',c.toDataURL('image/jpeg',0.7)); fetch('/update_avatar',{method:'POST',body:fd}).then(res=>res.json()).then(d=>{hideLoad();location.reload();}); }}; r.readAsDataURL(i.files[0]); }}
        const u=new URLSearchParams(location.search); if(u.get('msg')==='pass_ok') Swal.fire({icon:'success',title:'Password Changed',background:'#1e293b',color:'#fff'});
        function delTx(e, id) { e.stopPropagation(); Swal.fire({title:'Delete?', icon:'warning', showCancelButton:true, confirmButtonColor:'#d33', background:'#1e293b', color:'#fff'}).then(r => { if(r.isConfirmed) { const fd = new FormData(); fd.append('id', id); fetch('/delete_transaction', {method:'POST', body:fd}).then(res=>res.json()).then(d=>{ if(d.status==='ok') location.reload(); }); } }); }
      </script></body></html>`, { headers: {"content-type": "text/html"} });
  }

  if (url.pathname === "/history") {
      const hList = [];
      for await (const e of kv.list({prefix:["history"]}, {reverse:true, limit:31})) hList.push(e.value);
      return new Response(`<!DOCTYPE html><html><head><title>History</title>${commonHead}</head><body>${loaderHTML}${navHTML}
      <div class="p-4 max-w-md mx-auto pt-4 pb-20">
         <h2 class="text-xl font-bold text-white mb-4 text-center">Past Results</h2>
         <div class="glass rounded-xl overflow-hidden">
            <div class="grid grid-cols-3 bg-slate-800 p-3 text-xs font-bold text-gray-400 text-center uppercase"><div>Date</div><div>12:01</div><div>04:30</div></div>
            <div class="divide-y divide-gray-700">${hList.map(h=>`<div class="grid grid-cols-3 p-3 text-center items-center"><div class="text-xs text-gray-400">${h.date}</div><div class="font-bold text-lg text-white">${h.morning}</div><div class="font-bold text-lg text-yellow-500">${h.evening}</div></div>`).join('')}</div>
         </div>
      </div></body></html>`, { headers: {"content-type": "text/html"} });
  }

  return new Response("404 Not Found", { status: 404 });
});
