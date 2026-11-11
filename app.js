"use strict";
/* ============ Configuración del modelo de consumo ============
   fu / fe: cómo se reparte el consumo mixto homologado entre ciudad y carretera (~90 km/h).
   real:    corrección aproximada del consumo homologado WLTP al consumo real.
   k:       cuánto sube el consumo por cada km/h por encima de 90 (resistencia del aire). */
const TIPOS = {
  gasolina:  {nombre:"Gasolina",  unidad:"l",   precio:1.55, fu:1.25, fe:0.85, real:1.18, k:0.008},
  diesel:    {nombre:"Diésel",    unidad:"l",   precio:1.50, fu:1.22, fe:0.87, real:1.15, k:0.008},
  hibrido:   {nombre:"Híbrido",   unidad:"l",   precio:null, fu:0.92, fe:1.05, real:1.15, k:0.009},
  glp:       {nombre:"GLP",       unidad:"l",   precio:0.95, fu:1.25, fe:0.85, real:1.18, k:0.008},
  electrico: {nombre:"Eléctrico", unidad:"kWh", precio:0.20, fu:0.85, fe:0.95, real:1.12, k:0.011},
};
const VEL = {ciudad:30, carretera:80, autovia:115}; // velocidades medias para la calculadora rápida
const COLORES = ["#1D5BA8","#2E8B57","#C4501B","#7A4BB0"];

/* ============ Utilidades ============ */
const $ = s => document.querySelector(s);
const eur = n => n.toLocaleString("es-ES",{style:"currency",currency:"EUR"});
const num = (n,d=1) => n.toLocaleString("es-ES",{minimumFractionDigits:d,maximumFractionDigits:d});
const sinTildes = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
const duracion = s => { const m=Math.round(s/60), h=Math.floor(m/60); return h?`${h} h ${m%60} min`:`${m} min`; };
const distancia = m => m>=1000 ? `${num(m/1000, m<10000?1:0)} km` : `${Math.round(m/10)*10} m`;
const corto = n => n.split(",").slice(0,3).join(",").trim();
async function getJSON(url){ const r=await fetch(url,{headers:{Accept:"application/json"}}); if(!r.ok) throw new Error(r.status); return r.json(); }
function leer(k, def){ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):def; }catch{ return def; } }
function guardar(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} }

/* ============ Estado guardado en el móvil ============ */
const ajustes = Object.assign({precios:{gasolina:1.55, diesel:1.50, glp:0.95, electrico:0.20}, peaje:0.12, estilo:1, real:true, mix:[30,40,30]}, leer("rj.ajustes",{}));
let garaje = leer("rj.garaje", []);           // [{id, marca, modelo, tipo, kw, m}]
let idActivo = leer("rj.activo", null);
const guardarTodo = () => { guardar("rj.ajustes",ajustes); guardar("rj.garaje",garaje); guardar("rj.activo",idActivo); };

/* ============ Base de datos de coches ============ */
let BD = [], fuente = "";
fetch("coches.json").then(r=>r.json()).then(d=>{
  fuente = d.fuente;
  BD = d.coches.map(([marca,modelo,tipo,kw,m,n])=>({marca,modelo,tipo,kw,m,n, txt:sinTildes(`${marca} ${modelo} ${TIPOS[tipo].nombre} ${kw?kw+"kw "+Math.round(kw*1.36)+"cv":""}`)}));
  $("#fuente-datos").textContent = `${BD.length.toLocaleString("es-ES")} versiones disponibles. Datos: ${fuente}.`;
}).catch(()=>{ $("#fuente-datos").textContent = "No se pudo cargar la lista de coches. Puedes añadir el tuyo a mano."; });

function cocheActivo(){ return garaje.find(c=>c.id===idActivo) || null; }
function perfil(c){ // consumo en ciudad y carretera a partir del mixto
  const t=TIPOS[c.tipo], f=(ajustes.real?t.real:1)*ajustes.estilo;
  return {u:c.m*t.fu*f, e:c.m*t.fe*f, k:t.k, tipo:c.tipo};
}
function consumoA(v, p){
  if(v<=40) return p.u;
  if(v<=75) return p.u+(p.e-p.u)*(v-40)/35;
  if(v<=90) return p.e;
  return p.e*(1+p.k*(v-90));
}
function precioDe(tipo){ return tipo==="hibrido" ? ajustes.precios.gasolina : ajustes.precios[tipo]; }
function nombreCoche(c){ return `${c.marca} ${c.modelo}`.trim(); }
function detalleCoche(c){
  const t=TIPOS[c.tipo];
  return `${t.nombre}${c.kw?`, ${Math.round(c.kw*1.36)} CV`:""}, ${num(c.m)} ${t.unidad}/100 km homologado`;
}

/* ============ Pestañas ============ */
let mapaListo=false;
document.querySelectorAll("nav.pestanas button").forEach(b=>b.addEventListener("click", ()=>mostrar(b.dataset.vista)));
function mostrar(id){
  document.querySelectorAll(".vista").forEach(v=>v.hidden = v.id!==id);
  document.querySelectorAll("nav.pestanas button").forEach(b=>{ if(b.dataset.vista===id) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current"); });
  if(id==="v-ruta"){ if(!mapaListo) iniciarMapa(); else setTimeout(()=>map.invalidateSize(),50); }
}
$("#chip-coche").addEventListener("click", ()=>mostrar("v-coches"));

/* ============ Calculadora rápida ============ */
document.querySelectorAll("#tipo-via button").forEach(b=>{
  b.setAttribute("aria-pressed", b.dataset.mix===ajustes.mix.join(","));
  b.addEventListener("click", ()=>{
    ajustes.mix=b.dataset.mix.split(",").map(Number); guardarTodo();
    document.querySelectorAll("#tipo-via button").forEach(x=>x.setAttribute("aria-pressed", x===b)); calcularRapido();
  });
});
["#km","#km-peaje"].forEach(s=>$(s).addEventListener("input", calcularRapido));
function calcularRapido(){
  const c=cocheActivo(), tk=$("#ticket");
  if(!c){ tk.innerHTML=`<div class="total"><p>Añade tu coche en <strong>Mis coches</strong> para calcular el coste.</p></div>`; $("#nota-calc").textContent=""; return; }
  const km=Math.max(0,+$("#km").value||0), kmPeaje=Math.min(km,Math.max(0,+$("#km-peaje").value||0));
  const p=perfil(c), t=TIPOS[c.tipo], [pc,pr,pa]=ajustes.mix.map(x=>x/100);
  const cons100 = pc*consumoA(VEL.ciudad,p)+pr*consumoA(VEL.carretera,p)+pa*consumoA(VEL.autovia,p);
  const energia=km*cons100/100, cComb=energia*precioDe(c.tipo), cPeaje=kmPeaje*ajustes.peaje, total=cComb+cPeaje;
  tk.innerHTML=`
    <div class="total"><div class="cond">${eur(total)}</div><p>${num(km,0)} km con tu ${nombreCoche(c)}</p></div>
    <dl>
      <dt>${t.unidad==="kWh"?"Energía":"Combustible"}</dt><dd>${num(energia)} ${t.unidad}, ${eur(cComb)}</dd>
      <dt>Peajes</dt><dd>${eur(cPeaje)}</dd>
      <dt>Consumo estimado</dt><dd>${num(cons100)} ${t.unidad}/100 km</dd>
      <dt>Por kilómetro</dt><dd>${km?eur(total/km):"—"}</dd>
      <dt>Ida y vuelta</dt><dd>${eur(total*2)}</dd>
    </dl>`;
  $("#nota-calc").textContent = `Precio usado: ${num(precioDe(c.tipo),2)} €/${t.unidad}. ${ajustes.real?"Incluye el ajuste al consumo real.":"Usa el consumo homologado."} Puedes cambiarlo en Mis coches.`;
}

/* ============ Mis coches ============ */
function pintarGaraje(){
  const ul=$("#garaje"); ul.innerHTML="";
  if(!garaje.length){ ul.innerHTML=`<li class="vacio">Todavía no tienes coches. Búscalo abajo y tócalo para añadirlo.</li>`; }
  garaje.forEach(c=>{
    const li=document.createElement("li"); if(c.id===idActivo) li.className="activo";
    li.innerHTML=`<div class="info"><strong></strong><small></small></div>
      <button type="button" class="usar">${c.id===idActivo?"En uso":"Usar"}</button><button type="button" class="borrar" aria-label="Quitar">Quitar</button>`;
    li.querySelector("strong").textContent=nombreCoche(c); li.querySelector("small").textContent=detalleCoche(c);
    li.querySelector(".usar").addEventListener("click", ()=>{ idActivo=c.id; refrescar(); });
    li.querySelector(".borrar").addEventListener("click", ()=>{ garaje=garaje.filter(x=>x.id!==c.id); if(idActivo===c.id) idActivo=garaje[0]?.id||null; refrescar(); });
    ul.appendChild(li);
  });
  const a=cocheActivo(); $("#chip-coche").textContent = a ? nombreCoche(a) : "Elige tu coche";
}
function anadir(c){
  const nuevo={...c, id:String(Date.now())}; delete nuevo.txt; delete nuevo.n;
  garaje.push(nuevo); idActivo=nuevo.id; refrescar();
  $("#buscar-coche").value=""; $("#res-coches").innerHTML="";
}
$("#buscar-coche").addEventListener("input", e=>{
  const ul=$("#res-coches"); ul.innerHTML="";
  const palabras=sinTildes(e.target.value).split(/\s+/).filter(Boolean); if(!palabras.length) return;
  const hits=BD.filter(c=>palabras.every(p=>c.txt.includes(p))).slice(0,30);
  if(!hits.length){ ul.innerHTML=`<li>No hay resultados. Prueba solo con la marca y el modelo, o añádelo a mano.</li>`; return; }
  hits.forEach(c=>{
    const li=document.createElement("li"); li.innerHTML="<span></span><small></small>";
    li.firstChild.textContent=nombreCoche(c); li.lastChild.textContent=detalleCoche(c);
    li.addEventListener("click", ()=>anadir(c)); ul.appendChild(li);
  });
});
$("#btn-manual").addEventListener("click", ()=>{
  const m=+$("#m-cons").value; if(!m){ $("#m-cons").focus(); return; }
  anadir({marca:"", modelo:$("#m-nombre").value.trim()||"Mi coche", tipo:$("#m-tipo").value, kw:null, m});
});
// Precios y ajustes
for(const t of ["gasolina","diesel","glp","electrico"]){
  const i=$("#p-"+t); i.value=ajustes.precios[t];
  i.addEventListener("input", ()=>{ ajustes.precios[t]=+i.value||0; refrescar(false); });
}
$("#p-peaje").value=ajustes.peaje; $("#p-peaje").addEventListener("input", e=>{ ajustes.peaje=+e.target.value||0; refrescar(false); });
$("#estilo").value=String(ajustes.estilo); $("#estilo").addEventListener("change", e=>{ ajustes.estilo=+e.target.value; refrescar(false); });
$("#real").checked=ajustes.real; $("#real").addEventListener("change", e=>{ ajustes.real=e.target.checked; refrescar(false); });

function refrescar(garajeTambien=true){ guardarTodo(); if(garajeTambien) pintarGaraje(); calcularRapido(); recalcularRutas(); }

/* ============ Mapa y rutas ============ */
let map;
const R = {o:null, d:null, raw:[], rutas:[], sel:0, capas:[], marcas:{}, seguir:null, yo:null};

function iniciarMapa(){
  mapaListo=true;
  map=L.map("map",{zoomControl:false}).setView([40.2,-3.7],6);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19, attribution:'&copy; OpenStreetMap · OSRM'}).addTo(map);
  map.on("click", async e=>{
    const {lat,lng}=e.latlng, cual=!R.o?"o":(!R.d?"d":"o");
    if(cual==="o" && R.d){ R.d=null; $("#destino").value=""; quitarMarca("d"); limpiarRutas(); }
    fijar(cual,lat,lng,null); const n=await nombreDe(lat,lng); if(n) fijar(cual,lat,lng,n);
    if(R.o&&R.d) calcularRutas();
  });
}
const icono=(l,c)=>L.divIcon({className:"",html:`<div class="pin ${c}"><span>${l}</span></div>`,iconSize:[28,28],iconAnchor:[14,28]});
function quitarMarca(k){ if(R.marcas[k]){ map.removeLayer(R.marcas[k]); delete R.marcas[k]; } }
function fijar(cual,lat,lng,texto){
  R[cual]={lat,lng,texto}; $(cual==="o"?"#origen":"#destino").value = texto || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  if(R.marcas[cual]) R.marcas[cual].setLatLng([lat,lng]);
  else{
    const m=L.marker([lat,lng],{draggable:true, icon:icono(cual==="o"?"A":"B", cual==="o"?"pin-a":"pin-b")}).addTo(map);
    m.on("dragend", async ev=>{ const p=ev.target.getLatLng(); fijar(cual,p.lat,p.lng,await nombreDe(p.lat,p.lng)); if(R.o&&R.d) calcularRutas(); });
    R.marcas[cual]=m;
  }
}
async function nombreDe(lat,lng){
  try{ const j=await getJSON(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&accept-language=es`); return j.display_name?corto(j.display_name):null; }
  catch{ return null; }
}
function buscador(inp, lista, cual){
  const i=$(inp), ul=$(lista); let t=null, res=[];
  const cerrar=()=>{ ul.innerHTML=""; };
  const elegir=r=>{ fijar(cual,+r.lat,+r.lon,corto(r.display_name)); map.setView([+r.lat,+r.lon],12); cerrar(); i.blur(); if(R.o&&R.d) calcularRutas(); };
  i.addEventListener("input", ()=>{
    clearTimeout(t); R[cual]=null; const q=i.value.trim(); if(q.length<3){ cerrar(); return; }
    t=setTimeout(async ()=>{
      try{
        res=await getJSON(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=es&q=${encodeURIComponent(q)}`);
        ul.innerHTML="";
        res.forEach(r=>{ const li=document.createElement("li"); li.textContent=corto(r.display_name); li.addEventListener("pointerdown",ev=>{ev.preventDefault(); elegir(r);}); ul.appendChild(li); });
        if(!res.length) ul.innerHTML="<li>Sin resultados. Prueba con otro nombre o toca el mapa.</li>";
      }catch{ estadoRuta("No se pudo buscar. Comprueba la conexión.",true); }
    },400);
  });
  i.addEventListener("keydown", e=>{ if(e.key==="Enter"&&res[0]){ e.preventDefault(); elegir(res[0]); } });
  i.addEventListener("blur", ()=>setTimeout(cerrar,150));
}
buscador("#origen","#sug-origen","o"); buscador("#destino","#sug-destino","d");

$("#btn-ubicacion").addEventListener("click", ()=>{
  if(!navigator.geolocation) return estadoRuta("Este dispositivo no permite obtener la ubicación.",true);
  navigator.geolocation.getCurrentPosition(async p=>{
    const {latitude:lat,longitude:lng}=p.coords; fijar("o",lat,lng,"Mi ubicación"); map.setView([lat,lng],13);
    const n=await nombreDe(lat,lng); if(n) fijar("o",lat,lng,n); if(R.d) calcularRutas();
  }, ()=>estadoRuta("No se pudo obtener tu ubicación. Revisa los permisos.",true), {enableHighAccuracy:true,timeout:10000});
});
$("#btn-intercambiar").addEventListener("click", ()=>{
  const {o,d}=R; if(!o&&!d) return; quitarMarca("o"); quitarMarca("d"); R.o=R.d=null; $("#origen").value=$("#destino").value="";
  if(d) fijar("o",d.lat,d.lng,d.texto); if(o) fijar("d",o.lat,o.lng,o.texto); if(R.o&&R.d) calcularRutas();
});
$("#btn-seguir").addEventListener("click", e=>{
  if(R.seguir!==null){ navigator.geolocation.clearWatch(R.seguir); R.seguir=null; e.target.textContent="Seguirme"; return; }
  if(!navigator.geolocation) return;
  R.seguir=navigator.geolocation.watchPosition(p=>{
    const ll=[p.coords.latitude,p.coords.longitude];
    if(!R.yo) R.yo=L.marker(ll,{icon:L.divIcon({className:"",html:'<div class="yo"></div>',iconSize:[18,18],iconAnchor:[9,9]})}).addTo(map); else R.yo.setLatLng(ll);
    map.setView(ll,Math.max(map.getZoom(),16));
  }, ()=>estadoRuta("No se pudo seguir tu posición.",true), {enableHighAccuracy:true});
  e.target.textContent="Dejar de seguir";
});

function estadoRuta(txt,error=false){
  const p=$("#panel-rutas"); let e=p.querySelector(".estado");
  if(!e){ p.innerHTML=`<div class="asa"></div><p class="estado"></p>`; e=p.querySelector(".estado"); }
  e.textContent=txt; e.classList.toggle("error",error);
}
function limpiarRutas(){ R.capas.forEach(l=>map.removeLayer(l)); R.capas=[]; R.raw=[]; R.rutas=[]; $("#panel-rutas").innerHTML=""; }

async function calcularRutas(){
  const {o,d}=R; if(!o||!d) return;
  estadoRuta("Calculando rutas…");
  const base=`https://router.project-osrm.org/route/v1/driving/${o.lng},${o.lat};${d.lng},${d.lat}?overview=full&geometries=geojson&steps=true`;
  // El servidor público de OSRM no permite excluir peajes: la ruta sin peajes se pide a Valhalla (formato compatible con OSRM)
  const sinPeajes={locations:[{lat:o.lat,lon:o.lng},{lat:d.lat,lon:d.lng}], costing:"auto", costing_options:{auto:{use_tolls:0}}, format:"osrm", shape_format:"geojson", language:"es-ES"};
  const res=await Promise.allSettled([getJSON(base+"&alternatives=3"), getJSON("https://valhalla1.openstreetmap.de/route?json="+encodeURIComponent(JSON.stringify(sinPeajes)))]);
  let lista=[]; res.forEach(r=>{ if(r.status==="fulfilled"&&r.value.code==="Ok") lista.push(...r.value.routes); });
  const vistos=new Set();
  lista=lista.filter(r=>{ const k=Math.round(r.distance/1000)+"-"+Math.round(r.duration/120); return vistos.has(k)?false:vistos.add(k); });
  if(!lista.length){ limpiarRutas(); return estadoRuta("No se encontró ninguna ruta por carretera entre esos puntos.",true); }
  R.raw=lista.sort((a,b)=>a.duration-b.duration).slice(0,4); R.sel=0;
  recalcularRutas(true);
}
function analizar(r, c){
  const p=perfil(c); let energia=0, kmPeaje=0;
  for(const s of r.legs.flatMap(l=>l.steps)){
    const km=s.distance/1000; if(!km) continue;
    const v=s.duration>0?km/(s.duration/3600):50;
    energia+=km*consumoA(v,p)/100;
    if(s.intersections?.some(i=>i.classes?.includes("toll"))) kmPeaje+=km;
  }
  const cComb=energia*precioDe(c.tipo), cPeaje=kmPeaje*ajustes.peaje;
  return {r, energia, kmPeaje, cComb, cPeaje, total:cComb+cPeaje, unidad:TIPOS[c.tipo].unidad};
}
function recalcularRutas(encuadrar=false){
  if(!R.raw.length) return;
  const c=cocheActivo();
  if(!c){ estadoRuta("Añade tu coche en Mis coches para ver el coste de cada ruta.",true); }
  R.rutas = c ? R.raw.map(r=>analizar(r,c)) : R.raw.map(r=>({r, total:0, cComb:0, cPeaje:0, energia:0, kmPeaje:0, unidad:""}));
  dibujar(encuadrar); if(c) pintarRutas();
}
function dibujar(encuadrar){
  R.capas.forEach(l=>map.removeLayer(l)); R.capas=[];
  R.rutas.map((_,i)=>i).sort((a,b)=>(a===R.sel)-(b===R.sel)).forEach(i=>{
    const sel=i===R.sel, coords=R.rutas[i].r.geometry.coordinates.map(([x,y])=>[y,x]);
    if(sel) R.capas.push(L.polyline(coords,{color:"#fff",weight:10,opacity:.9}).addTo(map));
    const l=L.polyline(coords,{color:COLORES[i],weight:sel?6:4,opacity:sel?1:.55}).addTo(map);
    l.on("click",ev=>{ L.DomEvent.stop(ev); R.sel=i; dibujar(false); pintarRutas(); }); R.capas.push(l);
  });
  if(encuadrar) map.fitBounds(L.featureGroup(R.capas).getBounds(),{paddingTopLeft:[20,170],paddingBottomRight:[20,window.innerHeight*0.4]});
}
function pintarRutas(){
  const rs=R.rutas, p=$("#panel-rutas");
  const iR=rs.reduce((b,x,i)=>x.r.duration<rs[b].r.duration?i:b,0), iB=rs.reduce((b,x,i)=>x.total<rs[b].total?i:b,0);
  const max=Math.max(...rs.map(x=>x.total))||1, ref=rs[iR];
  p.innerHTML=`<div class="asa"></div>`;
  rs.forEach((x,i)=>{
    const b=document.createElement("button"); b.type="button"; b.className="ruta"; b.style.setProperty("--c",COLORES[i]); b.setAttribute("aria-pressed",i===R.sel);
    const via=x.r.legs.map(l=>l.summary).filter(Boolean).join(", ")||`Ruta ${i+1}`;
    let comp="";
    if(i!==iR){
      const dm=Math.round((x.r.duration-ref.r.duration)/60), de=ref.total-x.total;
      comp=`<div class="comparado">Frente a la más rápida: <span class="extra">+${dm} min</span>${de>0.005?`, <span class="ahorro">ahorras ${eur(de)}</span>`:de<-0.005?`, <span class="extra">${eur(-de)} más</span>`:""}</div>`;
    }
    b.innerHTML=`<div class="via"></div>
      <div class="cifras"><span class="tiempo cond">${duracion(x.r.duration)}</span><span class="km">${distancia(x.r.distance)}</span><span class="coste cond">${eur(x.total)}</span></div>
      <div class="barra-coste" aria-hidden="true"><span class="comb" style="width:${x.cComb/max*100}%"></span><span class="peaje" style="width:${x.cPeaje/max*100}%"></span></div>
      <div class="desglose"><span>${x.unidad==="kWh"?"Energía":"Combustible"}: ${eur(x.cComb)} (${num(x.energia)} ${x.unidad})</span><span>Peajes: ${eur(x.cPeaje)}</span></div>
      <div>${i===iR?'<span class="etq rapida">Más rápida</span>':""}${i===iB?'<span class="etq barata">Más barata</span>':""}${x.kmPeaje<0.5?'<span class="etq libre">Sin peajes</span>':""}</div>${comp}`;
    b.querySelector(".via").textContent="Por "+via;
    b.addEventListener("click",()=>{ R.sel=i; dibujar(false); pintarRutas(); });
    p.appendChild(b);
  });
  // Indicaciones de la ruta elegida
  const det=document.createElement("details"); det.className="pasos"; det.innerHTML="<summary>Indicaciones paso a paso</summary><ol></ol>";
  const ol=det.querySelector("ol");
  rs[R.sel].r.legs.flatMap(l=>l.steps).forEach(s=>{
    const t=s.maneuver.type, f=t.includes("roundabout")||t==="rotary"?"⟳":t==="arrive"?"◉":(FLECHA[s.maneuver.modifier]||"↑");
    const li=document.createElement("li"); li.innerHTML=`<span class="flecha">${f}</span><span></span><span class="dist">${s.distance?distancia(s.distance):""}</span>`;
    li.children[1].textContent=instruccion(s);
    li.addEventListener("click",()=>{ const [lng,lat]=s.maneuver.location; map.setView([lat,lng],16); });
    ol.appendChild(li);
  });
  p.appendChild(det);
}

/* ============ Indicaciones en español ============ */
const DIR={"right":"a la derecha","left":"a la izquierda","slight right":"ligeramente a la derecha","slight left":"ligeramente a la izquierda","sharp right":"bruscamente a la derecha","sharp left":"bruscamente a la izquierda","straight":"recto","uturn":"un cambio de sentido"};
const FLECHA={"right":"↱","left":"↰","slight right":"↗","slight left":"↖","sharp right":"↱","sharp left":"↰","straight":"↑","uturn":"↶"};
function instruccion(s){
  const m=s.maneuver, dir=DIR[m.modifier]||"", v=s.ref&&s.name?`${s.name} (${s.ref})`:(s.ref||s.name||""), por=v?` por ${v}`:"", hacia=s.destinations?` hacia ${s.destinations}`:(v?` hacia ${v}`:"");
  switch(m.type){
    case "depart": return `Sal${por}`;
    case "arrive": return "Has llegado a tu destino";
    case "turn": return m.modifier==="straight"?`Sigue recto${por}`:m.modifier==="uturn"?`Haz un cambio de sentido${por}`:`Gira ${dir}${por}`;
    case "new name": case "continue": return `Continúa${por||" recto"}`;
    case "merge": return `Incorpórate${por}`;
    case "on ramp": return `Toma el acceso${hacia}`;
    case "off ramp": return `Toma la salida${s.exits?` ${s.exits}`:""}${hacia}`;
    case "fork": return `En la bifurcación, mantente ${dir}${hacia}`;
    case "end of road": return `Al final de la vía, gira ${dir}${por}`;
    case "roundabout": case "rotary": case "roundabout turn": return m.exit?`En la rotonda, toma la ${m.exit}.ª salida${por}`:`Entra en la rotonda${por}`;
    case "exit roundabout": case "exit rotary": return `Sal de la rotonda${por}`;
    default: return dir?`Sigue ${dir}${por}`:`Continúa${por}`;
  }
}

/* ============ Arranque ============ */
pintarGaraje(); calcularRapido();
if(!garaje.length) mostrar("v-coches");
if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});
