(() => {
 const body=document.body, label=document.querySelector('[data-connection-status]');
 const banner=document.createElement('aside');banner.className='swift-connection-banner';banner.setAttribute('role','status');banner.setAttribute('aria-live','polite');
 banner.innerHTML='<img src="mockup-box.webp" alt="" aria-hidden="true"><span data-connection-copy></span><button type="button" data-connection-retry hidden>Retry</button>';document.body.append(banner);
 const copy=banner.querySelector('[data-connection-copy]'),retry=banner.querySelector('[data-connection-retry]');
 function update(){const online=navigator.onLine;if(label)label.textContent=online?'Connection available · restoring securely…':'No internet connection · waiting to reconnect';banner.hidden=online;copy.textContent=online?'Connection restored. You can continue using SwiftHaul.':'You are offline. SwiftHaul will reconnect when your internet returns.';retry.hidden=online;body.dataset.connection=online?'online':'offline';}
 retry.addEventListener('click',()=>{update();if(navigator.onLine)window.location.reload();});window.addEventListener('online',update);window.addEventListener('offline',update);update();
})();