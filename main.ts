import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { crypto } from "https://deno.land/std@0.177.0/crypto/mod.ts";

const kv = await Deno.openKv();

// --- HELPERS ---
async function hash(p: string, s: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(p + s));
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function genId() { return crypto.randomUUID(); }

// --- FORMULAS ---
function f1(n: string) { // 5/10 Diff
    if(!n) return "No Data";
    const d = n.split('').map(Number);
    let res = new Set();
    for (let x of d) {
        if(isNaN(x)) continue;
        res.add((5-(x%5)+1)%10); res.add((10-(x%10)+1)%10);
    }
    return Array.from(res).join(", ");
}
function f2(s: string, v: string) { // Set/Val
    if(!s || !v) return "Waiting";
    try {
        const sd = s.replace(/,/g,'').split('.')[0].slice(-3).split('').map(Number);
        const vd = v.replace(/,/g,'').split('.')[0].slice(-3).split('').map(Number);
        let res = new Set();
        for(let i=0; i<sd.length; i++) res.add(((sd[i] + (vd[i]||0))%10 + 1)%10);
        return Array.from(res).join(", ");
    } catch(e) { return "Error"; }
}

// --- CRON ---
Deno.cron("History", "*/5 * * * *", async () => {
  try {
    const r = await fetch("https://api.thaistock2d.com/live");
    const d = await r.json();
    const k = new Date().toISOString().split('T')[0];
    if(d.result) {
        const m = d.result[1]?.twod || "--", e = (d.result[3]||d.result[2])?.twod || "--";
        if(m!=="--" || e!=="--") {
            const old = (await kv.get(["history", k])).value as any || {morning:"--",evening:"--"};
            await kv.set(["history", k], { morning: m!=="--"?m:old.morning, evening: e!=="--"?e:old.evening, date: k });
        }
    }
  } catch(e) {}
});

// --- HTML TEMPLATE ---
const HTML = (title: string, body: string) => `
<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><title>${title}</title><link rel="manifest" href="/manifest.json"><script src="https://cdn.tailwindcss.com"></script><script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script><script src="https://html2canvas.hertzen.com/dist/html2canvas.min.js"></script><link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet"><style>body{background:#0f172a;color:#e2e8f0;font-family:sans-serif}.glass{background:rgba(30,41,59,0.8);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.1)}.btn-box{background:linear-gradient(135deg,#1e293b,#0f172a);border:1px solid #334155;border-radius:15px;padding:15px;text-align:center}.loader{border:3px solid #f3f3f3;border-top:3px solid #eab308;border-radius:50%;width:30px;height:30px;animation:spin 1s linear infinite}@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}</style><script>if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js');function showL(){document.getElementById('l').classList.remove('hidden')}function hideL(){document.getElementById('l').classList.add('hidden')}window.addEventListener('beforeunload',showL)</script></head><body><div id="l" class="fixed inset-0 bg-black/90 z-50 hidden flex items-center justify-center"><div class="loader"></div></div>${body}</body></html>`;

const NAV = (active:string) => `<div class="fixed bottom-0 w-full glass flex justify-around items-center h-16 z-40"><a href="/" class="${active==='h'?'text-yellow-500':'text-gray-400'} flex flex-col items-center"><i class="fas fa-home text-lg"></i><span class="text-[10px]">Home</span></a><a href="/history" class="${active==='x'?'text-yellow-500':'text-gray-400'} flex flex-col items-center"><i class="fas fa-calendar text-lg"></i><span class="text-[10px]">History</span></a><a href="/profile" class="${active==='p'?'text-yellow-500':'text-gray-400'} flex flex-col items-center"><i class="fas fa-user text-lg"></i><span class="text-[10px]">Profile</span></a></div>`;

serve(async (req) => {
  const url = new URL(req.url);

  // PWA
  if (url.pathname === "/manifest.json") return new Response(JSON.stringify({name:"VIP",short_name:"VIP",start_url:"/",display:"standalone",background_color:"#0f172a",icons:[{src:"https://img.icons8.com/color/192/shop.png",sizes:"192x192",type:"image/png"}]}),{headers:{"content-type":"application/json"}});
  if (url.pathname === "/sw.js") return new Response(`self.addEventListener('install',e=>e.waitUntil(caches.open('v1').then(c=>c.addAll(['/']))));self.addEventListener('fetch',e=>e.respondWith(fetch(e.request).catch(()=>caches.match(e.request))));`,{headers:{"content-type":"application/javascript"}});
  if (url.pathname === "/reset_admin") { await kv.delete(["users", "admin"]); return new Response("Admin Reset",{status:200}); }

  // AUTH CHECK
  const cookie = req.headers.get("Cookie")||"";
  const user = cookie.includes("user=") ? decodeURIComponent(cookie.split("user=")[1].split(";")[0]) : null;
  const isAdmin = user === "admin";

  // AUTH ACTIONS
  if (req.method === "POST") {
      const fd = await req.formData();
      if (url.pathname === "/login" || url.pathname === "/register") {
          const u = fd.get("username")?.toString().trim();
          const p = fd.get("password")?.toString();
          if (!u || !p) return Response.redirect(url.origin + "/");
          
          if (url.pathname === "/register") {
              if ((await kv.get(["users", u])).value) return Response.redirect(url.origin + "/?e=exists");
              const s = genId();
              await kv.set(["users", u], { hash: await hash(p, s), salt: s, balance: 0 });
          } else {
              const d = (await kv.get(["users", u])).value as any;
              if (!d || d.hash !== await hash(p, d.salt)) return Response.redirect(url.origin + "/?e=fail");
          }
          const h = new Headers({"Location":"/"}); h.set("Set-Cookie", `user=${encodeURIComponent(u)}; Path=/; Max-Age=999999`);
          return new Response(null, {status:303, headers:h});
      }
      
      // USER ACTIONS
      if (user) {
          const uKey = ["users", user];
          const uD = (await kv.get(uKey)).value as any;
          
          if (url.pathname === "/bet") {
              const n = (fd.get("number")?.toString()||"").split(",");
              const a = parseInt(fd.get("amount")?.toString()||"0");
              if(a<50 || !n.length) return new Response(JSON.stringify({status:"err"}));
              if(uD.balance < n.length*a) return new Response(JSON.stringify({status:"no_bal"}));
              
              let atom = kv.atomic().check({key:uKey, versionstamp:(await kv.get(uKey)).versionstamp})
                  .set(uKey, {...uD, balance: uD.balance - (n.length*a)});
              const time = new Date().toLocaleString("en-US", {timeZone:"Asia/Yangon"});
              const batch = Date.now().toString().slice(-6);
              for(const x of n) atom = atom.set(["bets", Date.now()+Math.random().toString().slice(2,5)], {user, num:x.trim(), amt:a, status:"PENDING", time, batch});
              const c = await atom.commit();
              return new Response(JSON.stringify({status:c.ok?"ok":"retry", v:{id:batch, user, time, nums:n, total:n.length*a}}));
          }
          
          if (url.pathname === "/bot_predict") {
              const type = (await req.json()).type;
              const md = (await kv.get(["sys", "manual"])).value as any || {};
              let h = "", t = "";
              if (type === 'morning') {
                  const base = md.e_res; t = "Morning";
                  h = base ? `<div class="text-center">Base: ${base}<br><b class="text-2xl text-yellow-500">${f1(base)}</b></div>` : "No Data";
              } else {
                  const base = md.m_res; t = "Evening";
                  h = base ? `<div class="text-center">Base: ${base}<br>F1: <b class="text-yellow-500">${f1(base)}</b><br>F2: <b class="text-blue-400">${f2(md.m_set, md.m_val)}</b></div>` : "No Data";
              }
              return new Response(JSON.stringify({html:h, title:t}), {headers:{"content-type":"application/json"}});
          }
          
          // ADMIN ACTIONS
          if (isAdmin) {
              if (url.pathname === "/admin/save") {
                  await kv.set(["sys", "manual"], { date: fd.get("d"), m_res: fd.get("m"), e_res: fd.get("e"), m_set: fd.get("s"), m_val: fd.get("v") });
                  return new Response(JSON.stringify({status:"ok"}));
              }
              if (url.pathname === "/admin/topup") {
                  const tu = fd.get("u")?.toString(), ta = parseInt(fd.get("a")?.toString()||"0");
                  const td = (await kv.get(["users", tu])).value as any;
                  if(td) { await kv.set(["users", tu], {...td, balance: td.balance+ta}); await kv.set(["tx", Date.now().toString()], {user:tu, amt:ta, type:"TOPUP", time:new Date().toLocaleString()}); }
                  return new Response(JSON.stringify({status:"ok"}));
              }
              if (url.pathname === "/admin/payout") {
                  const win = fd.get("w")?.toString();
                  for await (const e of kv.list({prefix:["bets"]})) {
                      if(e.value.status==="PENDING") {
                          if(e.value.num===win) {
                              const wa = e.value.amt*80;
                              const ud = (await kv.get(["users", e.value.user])).value as any;
                              await kv.set(["users", e.value.user], {...ud, balance: ud.balance+wa});
                              await kv.set(e.key, {...e.value, status:"WIN"});
                          } else await kv.set(e.key, {...e.value, status:"LOSE"});
                      }
                  }
                  return new Response(JSON.stringify({status:"ok"}));
              }
          }
      }
  }

  // --- PAGES ---
  if (!user) return new Response(HTML("Login", `<div class="flex h-screen items-center justify-center"><div class="w-full max-w-sm p-6 glass rounded-xl"><h1 class="text-2xl font-bold text-center mb-4 text-yellow-500">VIP 2D</h1><form action="/login" method="POST" class="space-y-3" onsubmit="showL()"><input name="username" placeholder="User" class="w-full p-3 rounded bg-slate-900" required><input name="password" type="password" placeholder="Pass" class="w-full p-3 rounded bg-slate-900" required><button class="w-full p-3 bg-yellow-600 rounded font-bold">LOGIN</button></form><div class="text-center mt-4 text-xs text-gray-400" onclick="document.forms[0].action='/register';document.querySelector('button').innerText='REGISTER'">Create Account</div></div></div>`), {headers:{"content-type":"text/html"}});
  
  const uD = (await kv.get(["users", user])).value as any;
  if(!uD) return Response.redirect("/logout");

  if (url.pathname === "/bot") {
      const md = (await kv.get(["sys", "manual"])).value as any || {date:"Today"};
      return new Response(HTML("Bot", `<div class="bg-slate-900 p-4 flex items-center gap-3"><a href="/"><i class="fas fa-arrow-left"></i></a><h1 class="font-bold">Bot Prediction (${md.date})</h1></div><div class="p-6 space-y-4"><div onclick="gp('morning')" class="btn-box"><h2 class="text-yellow-500 font-bold">Morning</h2><p class="text-xs">Formula 1</p></div><div onclick="gp('evening')" class="btn-box"><h2 class="text-purple-500 font-bold">Evening</h2><p class="text-xs">Formula 1 & 2</p></div></div><script>async function gp(type){showL();const r=await fetch('/bot_predict',{method:'POST',body:JSON.stringify({type})});const d=await r.json();hideL();Swal.fire({title:d.title,html:d.html,background:'#1e293b',color:'#fff'})}</script>`), {headers:{"content-type":"text/html"}});
  }

  if (url.pathname === "/profile") {
      return new Response(HTML("Profile", `<div class="p-6 pb-20 space-y-4"><div class="glass p-6 rounded-xl text-center"><h1 class="text-xl font-bold">${user}</h1><div class="text-yellow-500 text-xl font-bold">${uD.balance} Ks</div></div><a href="/logout" class="block w-full bg-red-600 p-3 rounded text-center font-bold">LOGOUT</a></div>${NAV('p')}`), {headers:{"content-type":"text/html"}});
  }

  if (url.pathname === "/history") {
      const hList = []; for await (const e of kv.list({prefix:["history"]}, {limit:20, reverse:true})) hList.push(e.value);
      return new Response(HTML("History", `<div class="p-4 pb-20 space-y-2"><h2 class="text-center font-bold mb-4">Past Results</h2>${hList.map(h=>`<div class="glass p-3 flex justify-between rounded"><span>${h.date}</span><span class="text-yellow-500">${h.morning} / ${h.evening}</span></div>`).join('')}</div>${NAV('x')}`), {headers:{"content-type":"text/html"}});
  }

  // HOME
  const md = (await kv.get(["sys", "manual"])).value as any || {};
  const bets = []; for await (const e of kv.list({prefix:["bets"]},{reverse:true,limit:50})) if(isAdmin||e.value.user===user) bets.push(e.value);
  
  return new Response(HTML("Home", `
    <nav class="glass sticky top-0 p-4 flex justify-between items-center z-40"><div class="font-bold">${user} <span class="text-yellow-500 text-xs">${uD.balance}</span></div>${isAdmin?'<span class="bg-red-600 text-[10px] px-2 rounded">ADMIN</span>':''}</nav>
    <div class="p-4 pb-24 space-y-4">
        <a href="/bot" class="block w-full bg-blue-600 p-4 rounded-xl text-center font-bold shadow">Auto Prediction Bot</a>
        ${isAdmin ? `<div class="bg-white p-4 rounded text-black"><h3 class="text-red-600 font-bold text-xs mb-2">ADMIN PANEL</h3><form onsubmit="adm(event,'/admin/save')" class="space-y-2"><input name="d" value="${md.date||''}" placeholder="Date" class="w-full border p-1"><div class="flex gap-1"><input name="m" value="${md.m_res||''}" placeholder="M-Res" class="w-1/2 border p-1"><input name="e" value="${md.e_res||''}" placeholder="E-Res" class="w-1/2 border p-1"></div><div class="flex gap-1"><input name="s" value="${md.m_set||''}" placeholder="Set" class="w-1/2 border p-1"><input name="v" value="${md.m_val||''}" placeholder="Val" class="w-1/2 border p-1"></div><button class="w-full bg-red-600 text-white p-1 rounded">SAVE</button></form><hr class="my-2"><form onsubmit="adm(event,'/admin/topup')" class="flex gap-1"><input name="u" placeholder="User" class="w-12 border p-1"><input name="a" placeholder="Amt" class="w-12 border p-1"><button class="bg-green-600 text-white p-1 rounded flex-1">TOP</button></form><form onsubmit="adm(event,'/admin/payout')" class="mt-2 flex gap-1"><input name="w" placeholder="Win" class="w-full border p-1"><button class="bg-blue-600 text-white p-1 rounded">PAY</button></form></div>` : ''}
        ${!isAdmin ? `<button onclick="document.getElementById('bm').classList.remove('hidden')" class="w-full bg-yellow-500 text-black font-bold p-4 rounded shadow">BET NOW</button>`:''}
        <div class="glass p-4 rounded-xl h-64 overflow-y-auto space-y-2">${bets.map(b=>`<div class="flex justify-between text-sm border-b border-white/10 pb-1"><span>${b.num} (${b.amt})</span><span class="${b.status==='WIN'?'text-green-400':'text-yellow-500'}">${b.status}</span></div>`).join('')}</div>
    </div>
    ${NAV('h')}
    <div id="bm" class="fixed inset-0 bg-black/90 hidden flex items-center justify-center p-4 z-50"><div class="bg-slate-800 w-full max-w-sm p-4 rounded"><h2 class="font-bold mb-4">Betting</h2><form onsubmit="bet(event)"><input name="number" placeholder="12, 34" class="w-full p-2 bg-slate-900 mb-2 rounded" required><input name="amount" type="number" placeholder="Amount" class="w-full p-2 bg-slate-900 mb-4 rounded" required><div class="flex gap-2"><button type="button" onclick="document.getElementById('bm').classList.add('hidden')" class="flex-1 bg-gray-600 p-2 rounded">Close</button><button class="flex-1 bg-yellow-500 text-black p-2 rounded">Confirm</button></div></form></div></div>
    <div id="vm" class="fixed inset-0 bg-black/90 hidden flex items-center justify-center p-4 z-50"><div class="bg-white text-black w-full max-w-xs rounded overflow-hidden"><div id="vc" class="p-4 text-center"><h2 class="font-bold">SUCCESS</h2><div id="vc-c" class="font-mono my-4 text-sm"></div></div><button onclick="saveV()" class="w-full bg-blue-600 text-white p-3">Save Image</button><button onclick="location.reload()" class="w-full bg-gray-200 p-3">Close</button></div></div>
    <script>
    async function adm(e,u){e.preventDefault();showL();await fetch(u,{method:'POST',body:new FormData(e.target)});hideL();location.reload()}
    async function bet(e){e.preventDefault();showL();const r=await fetch('/bet',{method:'POST',body:new FormData(e.target)});const d=await r.json();hideL();if(d.status==='success'){document.getElementById('bm').classList.add('hidden');document.getElementById('vc-c').innerHTML=\`ID: \${d.v.id}<br>Nums: \${d.v.nums}<br>Total: \${d.v.total}\`;document.getElementById('vm').classList.remove('hidden')}else Swal.fire('Error',d.status)}
    function saveV(){html2canvas(document.getElementById('vc')).then(c=>{const l=document.createElement('a');l.download='v.png';l.href=c.toDataURL();l.click()})}
    </script>
  `), {headers:{"content-type":"text/html"}});
});
