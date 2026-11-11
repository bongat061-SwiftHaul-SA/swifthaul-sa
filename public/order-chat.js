(() => {
 const app=document.body.dataset.app;
 if(!["customer","driver"].includes(app))return;
 const style=document.createElement("style");style.textContent=`
 .sh-chat-launch{border:1px solid #58616c;background:#1b222a;color:#f5f7fa;border-radius:9px;padding:9px 12px;font-weight:700;cursor:pointer;margin:5px 5px 5px 0}
 .sh-chat-overlay{position:fixed;inset:0;background:#020408bb;z-index:1400;display:flex;justify-content:flex-end}
 .sh-chat-drawer{width:min(440px,100%);height:100%;background:#101419;border-left:1px solid #38414b;color:#f5f7fa;display:flex;flex-direction:column;padding:18px}
 .sh-chat-head{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #303943;padding-bottom:12px}
 .sh-chat-head h2{font-size:19px;margin:0}.sh-chat-close{background:#252c34;color:white;border:1px solid #49535f;border-radius:8px;padding:8px 12px}
 .sh-chat-log{flex:1;overflow:auto;display:flex;flex-direction:column;gap:9px;padding:14px 0}
 .sh-chat-msg{max-width:88%;padding:10px 12px;background:#202832;border:1px solid #37414c;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere}
 .sh-chat-msg.mine{align-self:flex-end;background:#343d48}.sh-chat-meta{font-size:10px;color:#9ca8b4;margin-top:5px}
 .sh-chat-compose{display:flex;gap:8px}.sh-chat-compose textarea{flex:1;min-height:46px;max-height:110px;resize:vertical;background:#090d11;color:white;border:1px solid #424c57;border-radius:9px;padding:10px}.sh-chat-compose button{background:#e8edf2;color:#101419;border:0;border-radius:9px;padding:10px 14px;font-weight:800}
 .sh-chat-chips{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}.sh-chat-chips button{background:#1b242d;color:#dfe5eb;border:1px solid #39434f;border-radius:20px;padding:7px 10px;font-size:11px}
 .sh-chat-muted{font-size:12px;color:#a9b3bd}.sh-chat-proxy{background:#171d24;color:#aab4be;border:1px solid #3b4651;border-radius:8px;padding:8px 10px;margin:8px 0;align-self:flex-start}
 `;
 document.head.append(style);
 window.openSwiftHaulChat=({orderId,trackingCode,role})=>{
  if(!orderId||!trackingCode)return;
  const overlay=document.createElement("div");overlay.className="sh-chat-overlay";
  const drawer=document.createElement("section");drawer.className="sh-chat-drawer";drawer.setAttribute("role","dialog");drawer.setAttribute("aria-modal","true");drawer.setAttribute("aria-label","Delivery chat");
  const head=document.createElement("header");head.className="sh-chat-head";const title=document.createElement("h2");title.textContent="Delivery chat";const close=document.createElement("button");close.className="sh-chat-close";close.textContent="Close";head.append(title,close);
  const privacy=document.createElement("p");privacy.className="sh-chat-muted";privacy.textContent="Private chat for this delivery only. Personal phone numbers are not displayed.";
  const log=document.createElement("div");log.className="sh-chat-log";log.setAttribute("aria-live","polite");
  const proxy=document.createElement("button");proxy.className="sh-chat-proxy";proxy.textContent="Call via SwiftHaul · Proxy calling coming soon";proxy.disabled=true;
  const chips=document.createElement("div");chips.className="sh-chat-chips";
  if(role==="driver")for(const text of ["I am at the gate","5 mins away","Please send gate/pin code","Call me via app"]){const b=document.createElement("button");b.type="button";b.textContent=text;b.addEventListener("click",()=>{input.value=text;send();});chips.append(b);}
  const compose=document.createElement("form");compose.className="sh-chat-compose";const input=document.createElement("textarea");input.maxLength=2000;input.placeholder="Write a message…";input.setAttribute("aria-label","Message");const sendButton=document.createElement("button");sendButton.type="submit";sendButton.textContent="Send";compose.append(input,sendButton);
  const state=document.createElement("p");state.className="sh-chat-muted";state.setAttribute("role","status");
  drawer.append(head,privacy,proxy,log,chips,compose,state);overlay.append(drawer);document.body.append(overlay);
  let timer=null,closed=false,readOnly=false,channel=null;
  const sb=window.swiftHaulSupabase;if(sb&&role!=="recipient"){channel=sb.channel("order:"+orderId,{config:{private:true}}).on("broadcast",{event:"new_message"},()=>void refresh()).subscribe();}
  const api=async(body)=>{const {data,error}=await window.swiftHaulSupabase.functions.invoke("order-chat",{body:{order_id:orderId,tracking_code:trackingCode,...body}});if(error||data?.error)throw new Error(data?.error||error?.message||"Chat unavailable");return data;};
  const render=messages=>{log.replaceChildren();for(const m of messages){const el=document.createElement("article");el.className="sh-chat-msg"+((role==="driver"&&m.sender_role==="driver")||(role==="customer"&&m.sender_role==="customer")?" mine":"");el.textContent=m.message_text||"Attachment";const meta=document.createElement("div");meta.className="sh-chat-meta";meta.textContent=m.sender_role+" · "+new Date(m.created_at).toLocaleTimeString();el.append(meta);log.append(el);}log.scrollTop=log.scrollHeight;};
  const refresh=async()=>{try{const data=await api({action:"list"});render(data.messages||[]);readOnly=!!data.read_only;if(readOnly){input.disabled=true;sendButton.disabled=true;chips.hidden=true;state.textContent="This delivery chat is now archived (15 minutes after delivery/cancellation).";}else state.textContent="Messages are private to this delivery."; }catch(e){state.textContent=e.message;}};
  async function send(){const text=input.value.trim();if(!text||readOnly)return;sendButton.disabled=true;try{await api({message_text:text});input.value="";await refresh();}catch(e){state.textContent=e.message;}finally{sendButton.disabled=readOnly;}}
  compose.addEventListener("submit",e=>{e.preventDefault();void send();});
  close.addEventListener("click",()=>{closed=true;if(timer)clearInterval(timer);if(channel&&sb)sb.removeChannel(channel);overlay.remove();});
  overlay.addEventListener("click",e=>{if(e.target===overlay)close.click();});
  void refresh();timer=setInterval(()=>{if(!closed)void refresh();},4000);
 };
 const addButton=(card,orderId,trackingCode,role)=>{if(!trackingCode||card.querySelector(".sh-chat-launch"))return;const b=document.createElement("button");b.type="button";b.className="sh-chat-launch";b.textContent="Chat about delivery";b.addEventListener("click",()=>window.openSwiftHaulChat({orderId,trackingCode,role}));(card.querySelector(".order-actions")||card).append(b);};
 if(app==="customer"){
  const scan=()=>document.querySelectorAll(".order[data-waybill]").forEach(card=>addButton(card,card.dataset.waybill,card.dataset.trackingCode,"customer"));
  new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});scan();
 }else{
  const scan=()=>document.querySelectorAll("#dispatches .order[data-waybill]").forEach(card=>addButton(card,card.dataset.waybill,card.dataset.trackingCode,"driver"));
  new MutationObserver(scan).observe(document.getElementById("dispatches")||document.body,{childList:true,subtree:true});scan();
 }
})();