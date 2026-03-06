document.addEventListener("DOMContentLoaded", function () {

(function () {

const apiBase = "https://ai-front-desk-backend.onrender.com";


// =====================================================
// SESSION MANAGEMENT
// =====================================================

let sessionId = localStorage.getItem("ai_session_id");

if (!sessionId) {

sessionId = "web-" + crypto.randomUUID();
localStorage.setItem("ai_session_id", sessionId);

}

let isOpen = false;
let hasWelcomed = false;


// =====================================================
// CHAT BUTTON
// =====================================================

const toggleButton = document.createElement("div");

toggleButton.innerText = "Chat";

Object.assign(toggleButton.style,{
position:"fixed",
bottom:"20px",
right:"20px",
background:"#000",
color:"#fff",
padding:"12px 18px",
borderRadius:"30px",
cursor:"pointer",
fontFamily:"Arial",
zIndex:"999999",
boxShadow:"0 6px 18px rgba(0,0,0,0.25)",
transition:"all .3s ease"
});

document.body.appendChild(toggleButton);


// =====================================================
// CHAT WINDOW
// =====================================================

const container = document.createElement("div");

Object.assign(container.style,{
position:"fixed",
bottom:"80px",
right:"20px",
width:"360px",
height:"460px",
background:"#fff",
border:"1px solid #ddd",
borderRadius:"14px",
boxShadow:"0 12px 40px rgba(0,0,0,0.25)",
display:"none",
flexDirection:"column",
overflow:"hidden",
fontFamily:"Arial",
zIndex:"999999",
opacity:"0",
transform:"translateY(10px)",
transition:"all .25s ease"
});

document.body.appendChild(container);


// =====================================================
// MESSAGE AREA
// =====================================================

const messages = document.createElement("div");

Object.assign(messages.style,{
flex:"1",
padding:"12px",
overflowY:"auto",
display:"flex",
flexDirection:"column"
});

container.appendChild(messages);


// =====================================================
// INPUT BAR
// =====================================================

const inputBar = document.createElement("div");

Object.assign(inputBar.style,{
display:"flex",
borderTop:"1px solid #eee"
});

const input = document.createElement("input");

input.placeholder = "Type your message...";

Object.assign(input.style,{
flex:"1",
border:"none",
padding:"12px",
outline:"none"
});

const sendButton = document.createElement("button");

sendButton.innerText = "Send";

Object.assign(sendButton.style,{
background:"#000",
color:"#fff",
border:"none",
padding:"0 18px",
cursor:"pointer"
});

inputBar.appendChild(input);
inputBar.appendChild(sendButton);

container.appendChild(inputBar);


// =====================================================
// MESSAGE FUNCTION
// =====================================================

function addMessage(text,isUser){

const msg = document.createElement("div");

msg.innerText = text;

Object.assign(msg.style,{
marginBottom:"10px",
fontSize:"14px",
padding:"10px",
borderRadius:"10px",
maxWidth:"80%",
background:isUser ? "#000" : "#f2f2f2",
color:isUser ? "#fff" : "#000",
alignSelf:isUser ? "flex-end" : "flex-start"
});

messages.appendChild(msg);

messages.scrollTop = messages.scrollHeight;

}


// =====================================================
// TYPING INDICATOR
// =====================================================

function showTyping(){

const typing = document.createElement("div");

typing.id="typing";

Object.assign(typing.style,{
display:"flex",
gap:"4px",
marginBottom:"10px"
});

for(let i=0;i<3;i++){

const dot=document.createElement("div");

Object.assign(dot.style,{
width:"6px",
height:"6px",
background:"#888",
borderRadius:"50%",
animation:"bounce 1.2s infinite",
animationDelay:(i*0.2)+"s"
});

typing.appendChild(dot);

}

messages.appendChild(typing);
messages.scrollTop=messages.scrollHeight;

}

function hideTyping(){

const typing=document.getElementById("typing");

if(typing) typing.remove();

}


// =====================================================
// QUICK ACTION BUTTONS
// =====================================================

function showQuickActions(){

const wrapper = document.createElement("div");

wrapper.style.marginBottom="10px";

const callBtn = document.createElement("button");
callBtn.innerText="📞 Call";
callBtn.onclick=()=>{ window.location.href="tel:+14028171993"; };

const textBtn = document.createElement("button");
textBtn.innerText="📱 Text";
textBtn.onclick=()=>{ requestPhone(); };

const chatBtn = document.createElement("button");
chatBtn.innerText="💬 Chat";
chatBtn.onclick=()=>{ showProjectOptions(); };

[callBtn,textBtn,chatBtn].forEach(btn=>{

Object.assign(btn.style,{
marginRight:"6px",
padding:"8px 10px",
borderRadius:"6px",
cursor:"pointer",
background:"#f1f5f9",
color:"#000",
border:"1px solid #ddd"
});

wrapper.appendChild(btn);

});

messages.appendChild(wrapper);

}


// =====================================================
// PROJECT TYPE
// =====================================================

function showProjectOptions(){

const options=[
"Interior Painting",
"Exterior Painting",
"Commercial"
];

options.forEach(option=>{

const btn=document.createElement("button");

btn.textContent=option;

Object.assign(btn.style,{
display:"block",
marginTop:"8px",
padding:"10px",
borderRadius:"8px",
border:"none",
background:"#f1f5f9",
cursor:"pointer"
});

btn.onclick=()=>{

addMessage(option,true);

fetch(apiBase+"/lead/project-type",{
method:"POST",
headers:{ "Content-Type":"application/json"},
body:JSON.stringify({projectType:option})
});

requestPhone();

};

messages.appendChild(btn);

});

}


// =====================================================
// PHONE CAPTURE
// =====================================================

function requestPhone(){

const phone = prompt("Enter your phone number");

if(!phone) return;

fetch(apiBase+"/lead/phone",{
method:"POST",
headers:{ "Content-Type":"application/json"},
body:JSON.stringify({
phone:phone,
source:"website_chat"
})
});

addMessage("Great 👍 What is the project address?",false);

requestAddress();

}


// =====================================================
// ADDRESS CAPTURE
// =====================================================

function requestAddress(){

const address = prompt("Enter project address");

if(!address) return;

fetch(apiBase+"/lead/address",{
method:"POST",
headers:{ "Content-Type":"application/json"},
body:JSON.stringify({address})
});

showEstimateTimes();

}


// =====================================================
// ESTIMATE TIMES
// =====================================================

function showEstimateTimes(){

const times=[
"Tomorrow 10:00 AM",
"Tomorrow 2:30 PM",
"Thursday 9:00 AM"
];

addMessage("We have these estimate openings:",false);

times.forEach(time=>{

const btn=document.createElement("button");

btn.textContent=time;

Object.assign(btn.style,{
display:"block",
marginTop:"8px",
padding:"10px",
borderRadius:"8px",
border:"none",
background:"#2563eb",
color:"#fff",
cursor:"pointer"
});

btn.onclick=()=>{

addMessage(time,true);

fetch(apiBase+"/lead/appointment",{
method:"POST",
headers:{ "Content-Type":"application/json"},
body:JSON.stringify({appointment:time})
});

addMessage("You're booked 👍 We'll text confirmation shortly.",false);

};

messages.appendChild(btn);

});

}


// =====================================================
// CHAT TO AI
// =====================================================

async function sendMessage(){

const text=input.value.trim();

if(!text) return;

addMessage(text,true);
input.value="";

showTyping();

try{

const response=await fetch(apiBase+"/website-chat",{
method:"POST",
headers:{ "Content-Type":"application/json"},
body:JSON.stringify({
message:text,
sessionId:sessionId
})
});

hideTyping();

const data=await response.json();

setTimeout(()=>{
addMessage(data.reply || "No response",false);
},400);

}catch{

hideTyping();

addMessage("Connection error",false);

}

}

sendButton.onclick=sendMessage;

input.addEventListener("keypress",(e)=>{
if(e.key==="Enter") sendMessage();
});


// =====================================================
// TOGGLE CHAT
// =====================================================

toggleButton.onclick=()=>{

isOpen=!isOpen;

if(isOpen){

container.style.display="flex";

setTimeout(()=>{
container.style.opacity="1";
container.style.transform="translateY(0)";
},10);

toggleButton.innerText="Close";

if(!hasWelcomed){

addMessage("Hi 👋 Welcome to Gladiators Painting! I can help you get a fast quote.",false);

showQuickActions();

hasWelcomed=true;

}

}else{

container.style.opacity="0";
container.style.transform="translateY(10px)";

setTimeout(()=>{
container.style.display="none";
},250);

toggleButton.innerText="Chat";

}

};


// =====================================================
// VISITOR PROMPT
// =====================================================

setTimeout(()=>{

if(!isOpen){

const prompt=document.createElement("div");

prompt.innerText="Want a fast painting estimate?";

Object.assign(prompt.style,{
position:"fixed",
bottom:"95px",
right:"20px",
background:"#fff",
padding:"10px 14px",
borderRadius:"12px",
boxShadow:"0 4px 10px rgba(0,0,0,0.2)",
cursor:"pointer",
zIndex:"999999"
});

prompt.onclick=()=>{
toggleButton.click();
prompt.remove();
};

document.body.appendChild(prompt);

setTimeout(()=>{ prompt.remove(); },15000);

}

},8000);


// =====================================================
// ANIMATIONS
// =====================================================

const style=document.createElement("style");

style.innerHTML=`

@keyframes bounce{
0%,80%,100%{transform:scale(0)}
40%{transform:scale(1)}
}

`;

document.head.appendChild(style);


})();

});
