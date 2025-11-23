import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { crypto } from "https://deno.land/std@0.177.0/crypto/mod.ts";

const kv = await Deno.openKv();

// --- 1. LOGIC & FORMULAS ---
async function hashPassword(p: string, s: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(p + s));
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function generateId() { return crypto.randomUUID(); }

function calcF1(n: string) { // 5/10 Diff Formula
    if(!n) return "No Data";
    const d = n.split('').map(Number);
    let res = new Set();
    for (let x of d) {
        if(isNaN(x)) continue;
        let d5 = 5-(x%5), d10 = 10-(x%10); if(d10===10) d10=0;
        res.add((d5+1)%10); res.add((d10+1)%10);
    }
    if(res.size < 3 && d.length > 0) { // Fill if needed
        let d5=5-(d[0]%5), d10=10-(d[0]%10); if(d10===10) d10=0;
        res.add(d5); if(res.size<3) res.add(d10);
    }
    return Array.from(res).join(", ");
}

function calcF2(s: string, v: string) { // Set/Val Formula
    if(!s || !v) return "Waiting";
    try {
        const sd = s.replace(/,/g,'').split('.')[0].slice(-3).split('').map(Number);
        const vd = v.replace(/,/g,'').split('.')[0].slice(-3).split('').map(Number);
        let res = new Set(); let sums = [];
        for(let i=0; i<sd.length; i++) {
            let sum = (sd[i] + (vd[i]||0)) % 10;
            sums.push(sum); res.add((sum+1)%10);
        }
        if(res.size<3) { for(let x of sums) { res.add(x); if(res.size>=3) break; } }
        return Array.from(res).join(", ");
    } catch(e) { return "Error"; }
}

// --- 2. CRON JOB ---
Deno.cron("AutoHistory", "*/5 * * * *", async () => {
  try {
    const r = await fetch("https://api.thaistock2d.com/live");
    const d = await r.json();
    const k = new Date().toISOString().split('T')[0]; // UTC Date Key
    if(!d.result) return;
    const m = d.result[1]?.twod || "--", e = (d.result[3]||d.result[2])?.twod || "--";
    if(m!=="--" || e!=="--") {
        const old = (await kv.get(["history", k])).value as any || {morning:"--",evening:"--"};
        await kv.set(["history", k], { morning: m!=="--"?m:old.morning, evening: e!=="--"?e:old.evening, date: k });
    }
  } catch(e) {}
});

// --- 3. SERVER ---
serve(async (req) => {
  const url = new URL(req.url);
  
  // PWA
  if (url.pathname === "/manifest.json") return new Response(JSON.stringify({name:"VIP 2D",short_name:"VIP 2D",start_url:"/",display:"standalone",background_color:"#0f172a",theme_color:"#0f172a",icons:[{src:"https://img.icons8.com/color/192/shop.png",sizes:"192x192",type:"image/png"}]}),{headers:{"content-type":"application/json"}});
  if (url.pathname === "/sw.js") return new Response(`self.addEventListener('install',e=>e.waitUntil(caches.open('v1').then(c=>c.addAll(['/']))));self.addEventListener('fetch',e=>e.respondWith(fetch(e.request).catch(()=>caches.match(e.request))));`,{headers:{"content-type":"application/javascript"}});
  if (url.pathname === "/reset_admin") { await kv.delete(["users", "admin"]); return new Response("Admin Reset.",{status:200}); }

  // AUTH
  const cookies = req.headers.get("Cookie") || "";
  const user = cookies.split(";").find(c => c.trim().startsWith("user="))?.split("=")[1] ? decodeURIComponent(cookies.split(";").find(c => c.trim().startsWith("user="))!.split("=")[1].trim()) : null;
  const isAdmin = user === "admin";

  if (req.method === "POST" && (url.pathname === "/login" || url.pathname === "/register")) {
      const f = await req.formData();
      const u = f.get("username")?.toString().trim().toLowerCase();
      const p = f.get("password")?.toString();
      if(!u || !p) return Response.redirect(url.origin + "/?err=missing");
      
      if(url.pathname === "/register") {
          if((await kv.get(["users", u])).value) return Response.redirect(url.origin + "/?err=exists");
          const salt = generateId(), hash = await hashPassword(p, salt);
          await kv.set(["users", u], { passwordHash: hash, salt, balance: 0 });
      } else {
          const d = (await kv.get(["users", u])).value as any;
          if(!d || d.passwordHash !== await hashPassword(p, d.salt)) return Response.redirect(url.origin + "/?err=invalid");
      }
      const h = new Headers({"Location":"/"}); h.set("Set-Cookie", `user=${encodeURIComponent(u)}; Path=/; Max-Age=1296000`);
      return new Response(null, { status: 303, headers: h });
  }
  if (url.pathname === "/logout") { const h=new Headers({"Location":"/"}); h.set("Set-Cookie", "user=; Path=/; Max-Age=0"); return new Response(null, {status:303, headers:h}); }

  // API & ACTIONS
  if (user && req.method === "POST") {
      const uKey = ["users", user];
      const uD = (await kv.get(uKey)).value as any;
      
      if(url.pathname === "/bot_predict") {
          const { type } = await req.json();
          const md = (await kv.get(["system", "manual_data"])).value as any || {};
          let html = "", title = "";
          if(type === 'morning') {
              title = "Morning Prediction";
              const base = md.evening_result;
              html = base ? `<div class="text-center space-y-4"><div class="text-xs text-gray-400">Based on: <b class="text-white">${base}</b></div><div class="bg-yellow-500/10 p-4 rounded-xl border border-yellow-500/50"><div class="text-yellow-500 font-bold text-sm">FORMULA 1</div><div class="text-3xl font-bold text-white tracking-[4px]">${calcF1(base)}</div></div><div class="text-[10px] text-gray-500">For Next Morning</div></div>` : `<div class="text-center text-gray-500 py-4">Wait for Admin update</div>`;
          } else {
              title = "Evening Prediction";
              const base = md.morning_result;
              html = base ? `<div class="text-center space-y-4"><div class="text-xs text-gray-400">Based on: <b class="text-white">${base}</b></div><div class="bg-yellow-500/10 p-3 rounded-xl border border-yellow-500/50"><div class="text-yellow-500 font-bold text-xs">FORMULA 1</div><div class="text-2xl font-bold text-white">${calcF1(base)}</div></div><div class="bg-blue-500/10 p-3 rounded-xl border border-blue-500/50"><div class="text-blue-400 font-bold text-xs">FORMULA 2</div><div class="text-2xl font-bold text-white">${calcF2(md.morning_set, md.morning_val)}</div></div><div class="text-[10px] text-gray-500">For This Evening</div></div>` : `<div class="text-center text-gray-500 py-4">Wait for Admin update</div>`;
          }
          return new Response(JSON.stringify({html, title}), {headers:{"content-type":"application/json"}});
      }

      if(url.pathname === "/bet") {
          const f = await req.formData();
          const n = (f.get("number")?.toString()||"").split(",").map(x=>x.trim()).filter(x=>x);
          const a = parseInt(f.get("amount")?.toString()||"0");
          if(!n.length || a<50) return new Response(JSON.stringify({status:"invalid"}));
          if(uD.balance < n.length*a) return new Response(JSON.stringify({status:"no_balance"}));
          
          let atomic = kv.atomic().check({key:uKey, versionstamp:(await kv.get(uKey)).versionstamp})
              .set(uKey, {...uD, balance: uD.balance - (n.length*a)});
          
          const date = new Date().toLocaleString("en-US", {timeZone:"Asia/Yangon", day:'numeric', month:'short', year:'numeric'});
          const time = new Date().toLocaleString("en-US", {timeZone:"Asia/Yangon", hour12:true, hour:'numeric', minute:'numeric'});
          const bid = Date.now().toString().slice(-6);
          
          for(let num of n) atomic = atomic.set(["bets", Date.now()+Math.random().toString().slice(2,5)], { user, number:num, amount:a, status:"PENDING", time, date, bid });
          
          const c = await atomic.commit();
          if(!c.ok) return new Response(JSON.stringify({status:"retry"}));
          return new Response(JSON.stringify({status:"success", voucher:{id:bid, user, date, time, nums:n, amt:a, total:n.length*a}}));
      }

      if(url.pathname === "/update_avatar") {
          const f = await req.formData();
          await kv.set(uKey, {...uD, avatar: f.get("avatar")});
          return new Response(JSON.stringify({status:"ok"}));
      }
      
      if(url.pathname === "/change_pass") {
          const f = await req.formData();
          const s = generateId(), h = await hashPassword(f.get("new")?.toString()||"", s);
          await kv.set(uKey, {...uD, passwordHash: h, salt: s});
          return Response.redirect(url.origin+"/profile?msg=ok");
      }

      if(url.pathname === "/clear_history") {
         for await (const e of kv.list({prefix:["bets"]})) {
             if(e.value.user===user && e.value.status!=="PENDING") await kv.delete(e.key);
         }
         return new Response(JSON.stringify({status:"ok"}));
      }

      // ADMIN ONLY POSTS
      if(isAdmin) {
          const f = await req.formData();
          if(url.pathname === "/admin/save_data") {
              await kv.set(["system", "manual_data"], {
                  date_display: f.get("date"), morning_result: f.get("m_res"), evening_result: f.get("e_res"),
                  morning_set: f.get("m_set"), morning_val: f.get("m_val")
              });
              return new Response(JSON.stringify({status:"success"}));
          }
          if(url.pathname === "/admin/topup") {
              const tU = f.get("user")?.toString(); const tA = parseInt(f.get("amt")?.toString()||"0");
              const tRes = await kv.get(["users", tU]);
              if(tRes.value) {
                  await kv.set(["users", tU], {...tRes.value, balance: tRes.value.balance + tA});
                  await kv.set(["transactions", Date.now().toString()], {user:tU, amount:tA, type:"TOPUP", time: new Date().toLocaleString()});
                  return new Response(JSON.stringify({status:"success"}));
              }
              return new Response(JSON.stringify({status:"error"}));
          }
          if(url.pathname === "/admin/payout") {
               const win = f.get("win"); const rate = 80;
               for await (const e of kv.list({prefix:["bets"]})) {
                   if(e.value.status==="PENDING") {
                       if(e.value.number===win) {
                           const wA = e.value.amount*rate;
                           const u = await kv.get(["users", e.value.user]);
                           await kv.set(["users", e.value.user], {...u.value, balance: u.value.balance+wA});
                           await kv.set(e.key, {...e.value, status:"WIN", winAmount:wA});
                       } else { await kv.set(e.key, {...e.value, status:"LOSE"}); }
                   }
               }
               return new Response(JSON.stringify({status:"success"}));
          }
          if(url.pathname === "/admin/del_bet") { await kv.delete(["bets", f.get("id")]); return new Response(JSON.stringify({status:"success"})); }
          if(url.pathname === "/admin/settings") {
              const c = { kpay_no: f.get("kpay_no"), wave_no: f.get("wave_no"), tip: f.get("tip") };
              await kv.set(["system", "config"], c);
              return new Response(JSON.stringify({status:"success"}));
          }
      }
  }

  // --- UI COMPONENTS ---
  const head = `<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"><link rel="manifest" href="/manifest.json"><script src="https://cdn.tailwindcss.com"></script><script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script><script src="https://html2canvas.hertzen.com/dist/html2canvas.min.js"></script><link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet"><style>body{background:#0f172a;color:white;font-family:sans-serif}.glass{background:rgba(30,41,59,0.8);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.1)}.loader{border:3px solid #f3f3f3;border-top:3px solid #eab308;border-radius:50%;width:30px;height:30px;animation:spin 1s linear infinite}@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}</style><script>function showLoad(){document.getElementById('l').classList.remove('hidden')}function hideLoad(){document.getElementById('l').classList.add('hidden')}window.addEventListener('beforeunload',showLoad)</script>`;
  const loader = `<div id="l" class="fixed inset-0 bg-black/90 z-50 hidden flex items-center justify-center"><div class="loader"></div></div>`;
  
  // --- LOGIN PAGE ---
  if(!user) {
      return new Response(`<!DOCTYPE html><html><head>${head}</head><body class="flex items-center justify-center min-h-screen"><div class="w-full max-w-sm p-6 text-center"><h1 class="text-3xl font-bold text-yellow-500 mb-6">VIP 2D</h1><div class="glass rounded-xl p-6"><div class="flex mb-4 bg-slate-800 rounded"><button onclick="sTab('l')" class="flex-1 py-2 bg-slate-600 rounded">Login</button><button onclick="sTab('r')" class="flex-1 py-2">Register</button></div><form id="fL" action="/login" method="POST" class="space-y-3" onsubmit="showLoad()"><input name="username" placeholder="User" class="w-full p-3 bg-slate-900 rounded" required><input name="password" type="password" placeholder="Pass" class="w-full p-3 bg-slate-900 rounded" required><button class="w-full p-3 bg-yellow-500 text-black font-bold rounded">LOGIN</button></form><form id="fR" action="/register" method="POST" class="hidden space-y-3" onsubmit="showLoad()"><input name="username" placeholder="New User" class="w-full p-3 bg-slate-900 rounded" required><input name="password" type="password" placeholder="New Pass" class="w-full p-3 bg-slate-900 rounded" required><button class="w-full p-3 bg-blue-600 text-white font-bold rounded">REGISTER</button></form></div></div><script>function sTab(t){document.getElementById(t==='l'?'fL':'fR').classList.remove('hidden');document.getElementById(t==='l'?'fR':'fL').classList.add('hidden')} const u=new URLSearchParams(location.search);if(u.get('err'))Swal.fire('Error','Check details or User exists','error')</script></body></html>`, {headers:{"content-type":"text/html"}});
  }

  // --- DATA LOAD ---
  const uD = (await kv.get(["users", user])).value as any;
  if(!uD) return Response.redirect("/logout");
  const sys = (await kv.get(["system", "config"])).value as any || {};
  const mD = (await kv.get(["system", "manual_data"])).value as any || {date:"--"};
  
  // --- BOT PAGE ---
  if(url.pathname === "/bot") {
      return new Response(`<!DOCTYPE html><html><head>${head}</head><body class="flex flex-col h-screen"><div class="bg-slate-900 p-4 shadow flex gap-3 items-center"><a href="/"><i class="fas fa-arrow-left"></i></a><h1 class="font-bold">Bot Prediction</h1></div><div class="p-6 space-y-4 flex-1 overflow-y-auto"><div class="text-center text-gray-400 text-sm mb-4">Target: ${mD.date}</div><div onclick="pred('morning')" class="glass p-4 rounded-xl text-center cursor-pointer hover:bg-white/5"><i class="fas fa-sun text-yellow-500 text-2xl mb-2"></i><h2 class="font-bold">Morning</h2><p class="text-xs">Formula 1</p></div><div onclick="pred('evening')" class="glass p-4 rounded-xl text-center cursor-pointer hover:bg-white/5"><i class="fas fa-moon text-purple-500 text-2xl mb-2"></i><h2 class="font-bold">Evening</h2><p class="text-xs">Formula 1 & 2</p></div></div><script>async function pred(type){showLoad();const r=await fetch('/bot_predict',{method:'POST',body:JSON.stringify({type})});const d=await r.json();hideLoad();if(d.html)Swal.fire({title:d.title,html:d.html,background:'#1e293b',color:'#fff'});else Swal.fire('Wait','Data not updated','info')}</script>${loader}</body></html>`, {headers:{"content-type":"text/html"}});
  }

  // --- MAIN PAGE ---
  let bets = []; const iter = kv.list({prefix:["bets"]},{reverse:true, limit: 50});
  for await (const e of iter) { const v = e.value as any; v.id=e.key[1]; if(isAdmin || v.user===user) bets.push(v); }

  return new Response(`<!DOCTYPE html><html><head>${head}</head><body class="pb-20">${loader}
    <nav class="glass fixed top-0 w-full z-40 px-4 py-3 flex justify-between items-center shadow-lg"><div class="flex items-center gap-2"><div class="w-8 h-8 rounded-full bg-yellow-500 flex items-center justify-center text-black font-bold">${uD.avatar?`<img src="${uD.avatar}" class="w-full h-full rounded-full">`:user[0].toUpperCase()}</div><div><div class="text-[10px] text-gray-400">Balance</div><div class="text-sm font-bold">${uD.balance} Ks</div></div></div>${isAdmin?'<span class="bg-red-600 text-[10px] px-2 rounded font-bold">ADMIN</span>':''}</nav>
    <div class="pt-20 px-4 space-y-6">
        <a href="/bot" onclick="showLoad()" class="block w-full bg-blue-600 p-4 rounded-xl text-center font-bold shadow-lg"><i class="fas fa-robot mr-2"></i> Auto Bot</a>
        ${sys.tip ? `<div class="glass p-3 rounded-xl border-l-4 border-yellow-500"><div class="text-xs text-gray-400">Tip</div><div>${sys.tip}</div></div>`:''}
        
        ${isAdmin ? `<div class="bg-white p-4 rounded-xl shadow text-black"><h3 class="font-bold text-red-600 text-xs mb-2">ADMIN CONTROL</h3><form onsubmit="sub(event,'/admin/save_data')" class="space-y-2"><input name="date" value="${mD.date}" class="w-full border p-1 text-xs" placeholder="Date"><div class="flex gap-2"><input name="m_res" value="${mD.morning_result||''}" placeholder="M-Res" class="w-1/2 border p-1"><input name="e_res" value="${mD.evening_result||''}" placeholder="E-Res" class="w-1/2 border p-1"></div><div class="flex gap-2"><input name="m_set" value="${mD.morning_set||''}" placeholder="Set" class="w-1/2 border p-1"><input name="m_val" value="${mD.morning_val||''}" placeholder="Val" class="w-1/2 border p-1"></div><button class="w-full bg-red-600 text-white text-xs py-2 rounded">SAVE DATA</button></form><hr class="my-2"><div class="flex gap-2"><form onsubmit="sub(event,'/admin/payout')" class="flex-1 flex gap-1"><input name="win" placeholder="Win" class="w-12 border p-1 text-xs"><button class="bg-blue-600 text-white text-xs p-1 rounded">PAY</button></form><form onsubmit="sub(event,'/admin/topup')" class="flex-1 flex gap-1"><input name="user" placeholder="U" class="w-10 border p-1 text-xs"><input name="amt" placeholder="A" class="w-10 border p-1 text-xs"><button class="bg-green-600 text-white text-xs p-1 rounded">TOP</button></form></div></div>` : ''}

        ${!isAdmin ? `<button onclick="document.getElementById('bm').classList.remove('hidden')" class="w-full bg-yellow-500 text-black font-bold p-4 rounded-xl shadow">BET NOW</button>` : ''}

        <div class="glass rounded-xl p-4"><h3 class="text-sm font-bold mb-2">History</h3><div class="space-y-2 max-h-60 overflow-y-auto">${bets.map(b=>`<div class="flex justify-between items-center p-2 bg-black/30 rounded border-l-2 ${b.status==='WIN'?'border-green-500':'border-yellow-500'}"><div><div class="font-bold">${b.number}</div><div class="text-[10px] text-gray-400">${b.date}</div></div><div class="flex gap-2 items-center"><span>${b.amount}</span>${isAdmin?`<i class="fas fa-trash text-red-500 text-xs" onclick="del('${b.id}')"></i>`:''}</div></div>`).join('')}</div></div>
    </div>
    
    <div class="fixed bottom-0 w-full glass border-t border-white/10 flex justify-around items-center h-16 z-40"><a href="/" class="text-yellow-500"><i class="fas fa-home text-xl"></i></a><a href="/profile" onclick="showLoad()" class="text-gray-400"><i class="fas fa-user text-xl"></i></a></div>

    <div id="bm" class="fixed inset-0 bg-black/90 z-50 hidden flex items-center justify-center p-4"><div class="bg-slate-800 w-full max-w-sm rounded-xl p-4"><div class="flex justify-between mb-4"><h2 class="font-bold">Bet</h2><button onclick="document.getElementById('bm').classList.add('hidden')">X</button></div><form onsubmit="bet(event)"><textarea id="bn" name="number" class="w-full bg-slate-900 p-2 rounded text-white mb-2" placeholder="12, 34"></textarea><input name="amount" type="number" class="w-full bg-slate-900 p-2 rounded text-white mb-4" placeholder="Amount"><button class="w-full bg-yellow-500 text-black font-bold py-2 rounded">CONFIRM</button></form></div></div>
    
    <script>
    async function sub(e,u){e.preventDefault();showLoad();const r=await fetch(u,{method:'POST',body:new FormData(e.target)});hideLoad();const d=await r.json();Swal.fire(d.status==='success'?'OK':'Error')}
    async function bet(e){e.preventDefault();showLoad();const r=await fetch('/bet',{method:'POST',body:new FormData(e.target)});const d=await r.json();hideLoad();if(d.status==='success'){document.getElementById('bm').classList.add('hidden');Swal.fire('Success','Bet Placed','success').then(()=>location.reload())}else Swal.fire('Error',d.status,'error')}
    function del(id){if(confirm('Delete?')){fetch('/admin/del_bet',{method:'POST',body:new URLSearchParams({id})}).then(()=>location.reload())}}
    </script>
    </body></html>`, {headers:{"content-type":"text/html"}});
  
  // --- PROFILE PAGE ---
  } else if (url.pathname === "/profile") {
      const sys = (await kv.get(["system", "config"])).value as any || {};
      return new Response(`<!DOCTYPE html><html><head>${head}</head><body>${loader}
      <div class="p-6 space-y-6"><div class="text-center mt-10"><div class="w-24 h-24 rounded-full bg-slate-700 mx-auto mb-3 overflow-hidden flex items-center justify-center">${uData.avatar?`<img src="${uData.avatar}" class="w-full h-full">`:`<i class="fas fa-user text-4xl"></i>`}</div><h1 class="text-xl font-bold">${user}</h1><div class="text-yellow-500 font-bold text-xl">${uData.balance} Ks</div><input type="file" class="text-xs mt-2" onchange="upAv(this)"></div>
      <div class="glass p-4 rounded-xl"><h3>Contact</h3><div class="grid grid-cols-2 gap-2 mt-2 text-xs"><div class="bg-blue-900/50 p-2 rounded">KPay: ${sys.kpay_no||'-'}</div><div class="bg-yellow-900/50 p-2 rounded">Wave: ${sys.wave_no||'-'}</div></div></div>
      <button onclick="doLogout()" class="w-full bg-red-600 py-3 rounded font-bold">LOGOUT</button></div>
      <div class="fixed bottom-0 w-full glass border-t border-white/10 flex justify-around items-center h-16"><a href="/" onclick="showLoad()" class="text-gray-400"><i class="fas fa-home text-xl"></i></a><a href="#" class="text-yellow-500"><i class="fas fa-user text-xl"></i></a></div>
      <script>function upAv(i){if(i.files[0]){const r=new FileReader();r.onload=e=>{const fd=new FormData();fd.append('avatar',e.target.result);fetch('/update_avatar',{method:'POST',body:fd}).then(()=>location.reload())};r.readAsDataURL(i.files[0])}}</script>
      </body></html>`, {headers:{"content-type":"text/html"}});
  }

  return new Response("404", {status:404});
});
