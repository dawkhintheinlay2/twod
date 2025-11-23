import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// မိတ်ဆွေရဲ့ Key (Active ဖြစ်နေပါပြီ)
const API_KEY = "AIzaSyDRIIEdpfFnE5Qoj4npwidQyT596U8hXpw"; 

// သုံးမည့် Model (စောနက စမ်းလို့ရသွားတဲ့ Model)
const MODEL_NAME = "gemini-2.0-flash";

const SYSTEM_INSTRUCTION = `
You are "Soe Kyaw Win AI", a smart Myanmar assistant.

**YOUR ROLES:**
1. **2D Expert:**
   - You will receive [MARKET DATA] and [FORMULA RESULTS].
   - Explain the results to the user like a friend.
   - If asked about "Missing Numbers" or "Doubles", give advice based on general 2D knowledge (Monday/Friday for doubles).
2. **General Assistant:**
   - You can answer questions about Football, Health, Knowledge, History freely.
   - Do NOT mention 2D if the topic is unrelated.

**TONE:** Friendly, Casual ("ကွ", "ဟ", "ရောင်").
**LANGUAGE:** Myanmar (Burmese) with correct spelling.
`;

// --- တွက်နည်း (၁) - ၅ ပြည့် ၁၀ ပြည့် ---
function calculateFormula5_10(twod: string) {
    try {
        const digits = twod.split('').map(Number);
        let results = [];
        let originalSums = [];
        for (let n of digits) {
            let diff5 = (5 - (n % 5));
            let diff10 = (10 - (n % 10));
            if(diff10===10) diff10=0;
            
            let to5 = (diff5 + 1) % 10;
            let to10 = (diff10 + 1) % 10;
            
            originalSums.push(diff5); originalSums.push(diff10);
            results.push(to5); results.push(to10);
        }
        let finalSet = new Set(results);
        if (finalSet.size < 3) {
             for (let n of originalSums) { finalSet.add(n); if (finalSet.size >= 3) break; }
        }
        return Array.from(finalSet).join(", ");
    } catch (e) { return null; }
}

// --- တွက်နည်း (၂) - Set/Value ---
function calculateFormulaSetVal(setStr: string, valStr: string) {
    try {
        const s = setStr.replace(/,/g, ""); const v = valStr.replace(/,/g, ""); 
        const sDigits = s.split('.')[0].slice(-3).split('').map(Number); 
        const vDigits = v.split('.')[0].slice(-3).split('').map(Number);
        let incremented = []; let originalSums = [];
        for (let i = 0; i < sDigits.length; i++) {
            let sum = (sDigits[i] + (vDigits[i] || 0)) % 10;
            let inc = (sum + 1) % 10;
            originalSums.push(sum); incremented.push(inc);
        }
        let finalSet = new Set(incremented);
        if (finalSet.size < 3) {
            for (let num of originalSums) { finalSet.add(num); if (finalSet.size >= 3) break; }
        }
        return Array.from(finalSet).join(", ");
    } catch (e) { return null; }
}

// --- Data ရှာဖွေခြင်း ---
async function getContext() {
    let context = "";
    try {
        const res = await fetch("https://api.thaistock2d.com/live");
        const data = await res.json();
        const now = new Date().toLocaleString("en-US", { timeZone: "Asia/Yangon", hour12: true, dateStyle: 'full', timeStyle: 'short' });
        
        context += `[CURRENT TIME]: ${now}\n`;
        const dayName = now.split(',')[0];
        if(dayName === 'Monday' || dayName === 'Friday') context += `[DAY_INFO]: Today is ${dayName}. Warn user about Doubles (အပူး)!\n`;

        let mNum = null, eNum = null;
        if (data.result && data.result[1]) mNum = data.result[1].twod;
        if (data.result && (data.result[3] || data.result[2])) eNum = (data.result[3] || data.result[2]).twod;

        if (eNum) {
            context += `STATUS: Evening Result (${eNum}) is OUT.\n`;
            context += `FORMULA_1 (FOR TOMORROW): [${calculateFormula5_10(eNum)}]\n`;
        } else if (mNum) {
            context += `STATUS: Morning Result (${mNum}) is OUT.\n`;
            context += `FORMULA_1 (FOR EVENING): [${calculateFormula5_10(mNum)}]\n`;
            if (data.result[1].set && data.result[1].value) {
                context += `FORMULA_2 (Set/Val - FOR EVENING): [${calculateFormulaSetVal(data.result[1].set, data.result[1].value)}]\n`;
            }
        } else {
            context += `STATUS: Market Not Open Yet.\n`;
        }
    } catch (e) { context += "Data Unavailable.\n"; }
    return context;
}

serve(async (req) => {
  const url = new URL(req.url);

  // API Endpoint
  if (req.method === "POST" && url.pathname === "/chat") {
    try {
      const { message } = await req.json();
      const context = await getContext();
      
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ 
            role: "user",
            parts: [{ text: `${SYSTEM_INSTRUCTION}\n${context}\n[USER MESSAGE]\n${message}` }] 
          }]
        })
      });

      const data = await response.json();
      
      if (data.error) {
         return new Response(JSON.stringify({ reply: "Error: " + data.error.message }), { headers: { "Content-Type": "application/json" } });
      }

      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "စက်ပိုင်းဆိုင်ရာ အခက်အခဲရှိနေပါတယ်ခင်ဗျာ။";
      return new Response(JSON.stringify({ reply }), { headers: { "Content-Type": "application/json" } });

    } catch (e) {
      return new Response(JSON.stringify({ reply: "Connection Error." }), { headers: { "Content-Type": "application/json" } });
    }
  }

  // UI Rendering (Chat Only)
  return new Response(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <title>Soe Kyaw Win AI</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
      <link href="https://fonts.googleapis.com/css2?family=Padauk:wght@400;700&family=Poppins:wght@300;500&display=swap" rel="stylesheet">
      <style>
        body { background: #0f172a; color: white; font-family: 'Poppins', 'Padauk', sans-serif; }
        .chat-container { height: calc(100vh - 140px); overflow-y: auto; padding: 20px; scroll-behavior: smooth; }
        .msg { max-width: 85%; margin-bottom: 15px; padding: 12px 16px; border-radius: 20px; font-size: 15px; line-height: 1.6; }
        .user { background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; align-self: flex-end; margin-left: auto; border-bottom-right-radius: 4px; }
        .ai { background: #1e293b; color: #e2e8f0; align-self: flex-start; margin-right: auto; border-bottom-left-radius: 4px; border: 1px solid #334155; }
        .typing { font-size: 12px; color: #94a3b8; margin-left: 20px; display: none; }
        .time { font-size: 10px; opacity: 0.7; display: block; text-align: right; margin-top: 5px; }
      </style>
    </head>
    <body class="flex flex-col h-screen">
      
      <div class="bg-slate-900 p-4 shadow-xl border-b border-slate-800 z-10 flex justify-between items-center">
        <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold shadow-lg">
                <i class="fas fa-robot text-xl"></i>
            </div>
            <div>
                <h1 class="font-bold text-lg text-white">Soe Kyaw Win AI</h1>
                <div class="flex items-center gap-1 text-[10px] text-green-400 font-bold">
                    <span class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span> Online
                </div>
            </div>
        </div>
        <button onclick="clearChat()" class="text-gray-400 hover:text-red-500 p-2 rounded-full border border-slate-700"><i class="fas fa-trash-alt"></i></button>
      </div>

      <div id="chatBox" class="chat-container flex flex-col"></div>
      <div id="typing" class="typing"><i class="fas fa-circle-notch fa-spin text-blue-500 mr-1"></i> ဖြေကြားနေသည်...</div>

      <div class="p-3 bg-slate-900 border-t border-slate-800 flex gap-2 items-center pb-6 fixed bottom-0 w-full">
        <input id="msgInput" type="text" placeholder="သိလိုရာ မေးမြန်းပါ..." class="flex-1 bg-slate-800 text-white rounded-full px-5 py-3 focus:outline-none focus:ring-1 focus:ring-blue-500 border border-slate-700">
        <button onclick="sendMsg()" class="bg-gradient-to-r from-blue-500 to-indigo-600 text-white w-12 h-12 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform"><i class="fas fa-paper-plane text-lg"></i></button>
      </div>

      <script>
        const chatBox = document.getElementById('chatBox');
        const input = document.getElementById('msgInput');
        const typing = document.getElementById('typing');
        
        function getMMTime() { return new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Yangon', hour: 'numeric', minute: '2-digit', hour12: true }); }

        // Load History
        let chatHistory = JSON.parse(localStorage.getItem('skw_standalone_ai')) || [];
        if (chatHistory.length === 0) {
            addBubble("မင်္ဂလာပါခင်ဗျာ။ 2D/3D ကိစ္စပဲဖြစ်ဖြစ်၊ အထွေထွေဗဟုသုတပဲဖြစ်ဖြစ် မေးမြန်းနိုင်ပါတယ်ဗျ။", 'ai', false, getMMTime());
        } else {
            chatHistory.forEach(c => addBubble(c.text, c.type, false, c.time));
        }

        input.addEventListener("keypress", function(e) { if(e.key === "Enter") sendMsg(); });

        function saveChat(text, type, time) {
            chatHistory.push({ text, type, time });
            localStorage.setItem('skw_standalone_ai', JSON.stringify(chatHistory));
        }

        function clearChat() {
            if(confirm('မှတ်တမ်းများကို ဖျက်မှာသေချာလား?')) {
                localStorage.removeItem('skw_standalone_ai');
                chatHistory = [];
                chatBox.innerHTML = '';
                addBubble("စကားဝိုင်း အသစ်ပြန်စပါပြီ။", 'ai', false, getMMTime());
            }
        }

        async function sendMsg() {
            const text = input.value.trim();
            if(!text) return;
            
            const time = getMMTime();
            addBubble(text, 'user', true, time);
            input.value = '';
            typing.style.display = 'block';
            chatBox.scrollTop = chatBox.scrollHeight;

            try {
                const res = await fetch('/chat', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ message: text })
                });
                const data = await res.json();
                typing.style.display = 'none';
                
                const replyTime = getMMTime();
                let cleanReply = data.reply.replace(/\\*\\*(.*?)\\*\\*/g, '<b>$1</b>').replace(/\\n/g, '<br>');
                addBubble(cleanReply, 'ai', true, replyTime);
            } catch(e) {
                typing.style.display = 'none';
                addBubble("Error: " + e.message, 'ai', false, getMMTime());
            }
        }

        function addBubble(text, type, save, time) {
            if (save) saveChat(text, type, time);
            
            const div = document.createElement('div');
            div.className = 'msg ' + type + ' animate-[fadeIn_0.3s_ease-out]';
            div.innerHTML = \`\${text} <span class="time">\${time}</span>\`;
            
            chatBox.appendChild(div);
            chatBox.scrollTop = chatBox.scrollHeight;
        }
      </script>
    </body></html>
  `, { headers: { "content-type": "text/html; charset=utf-8" } });
});
