/* Shared Leaflet map coordination for Customer, Driver and Company Admin. */
(() => {
  if (window.SwiftHaulMaps) return;
  class MapLayer {
    constructor(name, group) { this.name=name; this.group=group; }
    add(item) { if(item&&!this.group.hasLayer(item))this.group.addLayer(item); return item; }
    remove(item) { if(item&&this.group.hasLayer(item))this.group.removeLayer(item); }
    clear() { this.group.clearLayers(); }
  }
  class MapLayerManager {
    constructor(map) { this.map=map;this.layers=new Map();this.owners=new Map();['tiles','markers','routes','driver-location','service-areas','operational-overlays'].forEach(n=>this.layers.set(n,new MapLayer(n,L.layerGroup().addTo(map)))); }
    add(layer,scope='shared',exclusive=false) { if(!layer?.group)throw new TypeError('A valid map layer is required.');if(exclusive)for(const [n,o] of this.owners)if(o===scope&&n!==layer.name)this.remove(this.layers.get(n));this.layers.set(layer.name,layer);this.owners.set(layer.name,scope);layer.group.addTo(this.map);return layer; }
    remove(layer) { if(!layer)return;layer.group.remove();this.owners.delete(layer.name); }
    get(name) { return this.layers.get(name)||null; }
  }
  class MapPaddingSource { constructor(element,edgeInsets={top:0,right:0,bottom:0,left:0}){this.element=element;this.edgeInsets=edgeInsets;} }
  class MapPaddingProvider {
    constructor(map){this.map=map;this.sources=new Map();this.observers=new Map();this.edgeInsets={top:0,right:0,bottom:0,left:0};}
    add(source,scope='map'){this.remove(source);this.sources.set(source,scope);if(source.element&&window.ResizeObserver){const o=new ResizeObserver(()=>this.refresh());o.observe(source.element);this.observers.set(source,o);}this.refresh();return source;}
    remove(source){this.observers.get(source)?.disconnect();this.observers.delete(source);this.sources.delete(source);this.refresh();}
    refresh(){const t={top:0,right:0,bottom:0,left:0};for(const s of this.sources.keys()){const r=s.element?.getBoundingClientRect();if(r&&r.width&&r.height){const visible=r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;if(visible){t.top=Math.max(t.top,Math.max(0,r.bottom<=innerHeight?0:r.bottom-innerHeight)+(s.edgeInsets.top||0));t.bottom=Math.max(t.bottom,Math.max(0,innerHeight-r.top)+(s.edgeInsets.bottom||0));t.left=Math.max(t.left,Math.max(0,-r.left)+(s.edgeInsets.left||0));t.right=Math.max(t.right,Math.max(0,r.right-innerWidth)+(s.edgeInsets.right||0));}}else for(const k of Object.keys(t))t[k]=Math.max(t[k],Number(s.edgeInsets?.[k]||0));}this.edgeInsets=t;this.map.fire('swiftmap:paddingchange',{edgeInsets:{...t}});return t;}
    getFitPadding(){const p=this.edgeInsets;return{paddingTopLeft:[p.left+24,p.top+24],paddingBottomRight:[p.right+24,p.bottom+24]};}
  }
  class MapCameraRule {constructor(boundingLocations=[],options={}){this.boundingLocations=boundingLocations;this.options=options;}}
  class MapCameraHandle {constructor(director,scope){this.director=director;this.scope=scope;this.active=true;this.listeners=new Set();this.isActiveStream={subscribe:fn=>{this.listeners.add(fn);fn(this.isActive);return{unsubscribe:()=>this.listeners.delete(fn)}}};}get isActive(){return this.active&&this.director.owner===this;}notify(){for(const fn of this.listeners)fn(this.isActive);}set(camera,duration=0){if(!this.isActive)return false;return this.director.apply(camera,duration);}relinquish(){this.director.relinquishCameraControl(this);}}
  class MapCameraDirector {
    constructor(map,padding){this.map=map;this.padding=padding;this.rules=new Map();this.owner=null;this.gesture=false;map.on('dragstart zoomstart',()=>{this.gesture=true;});map.on('dragend zoomend',()=>{this.gesture=false;});}
    add(rule,scope='shared'){this.rules.set(rule,scope);return rule;}remove(rule){this.rules.delete(rule);}
    requestCameraControl(scope='shared'){if(this.owner){this.owner.active=false;this.owner.notify();}this.owner=new MapCameraHandle(this,scope);this.owner.notify();return this.owner;}
    relinquishCameraControl(handle){if(this.owner===handle){handle.active=false;this.owner=null;handle.notify();}}
    apply(camera,duration=0){if(!camera||this.gesture)return false;const opts={animate:duration>0,duration:Math.max(0,duration)/1000,maxZoom:camera.maxZoom||camera.zoom||undefined,...this.padding.getFitPadding()};if((Array.isArray(camera.bounds)&&camera.bounds.length>1)||camera.bounds?.getSouthWest)this.map.fitBounds(camera.bounds,opts);else if(Number.isFinite(camera.lat)&&Number.isFinite(camera.lng))this.map.setView([camera.lat,camera.lng],camera.zoom||this.map.getZoom(),opts);return true;}
    move(camera,duration=0,scope='shared'){const h=this.requestCameraControl(scope);const ok=h.set(camera,duration);h.relinquish();return ok;}
    fitRule(rule,scope='shared'){if(this.rules.get(rule)!==scope)return false;return this.move({bounds:rule.boundingLocations},rule.options.duration||0,scope);}
  }
  function createMap(element,options={}){const map=L.map(element,{worldCopyJump:true,zoomControl:false,...options.leaflet});const layers=new MapLayerManager(map);L.tileLayer(options.tileUrl||'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{maxZoom:20,attribution:options.attribution||'&copy; OpenStreetMap contributors &copy; CARTO',...options.tileOptions}).addTo(layers.get('tiles').group);const padding=new MapPaddingProvider(map);const camera=new MapCameraDirector(map,padding);if(options.paddingElement)padding.add(new MapPaddingSource(options.paddingElement),options.scope||'shared');return{map,layers,padding,camera,destroy(){for(const s of [...padding.sources.keys()])padding.remove(s);map.remove();}};}
  window.SwiftHaulMaps={createMap,MapLayer,MapLayerManager,MapPaddingProvider,MapPaddingSource,MapCameraDirector,MapCameraRule,MapCameraHandle};
})();