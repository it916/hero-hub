import { db } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { renderWidgets, updateGreeting } from "./widgets.js";

const CALENDAR_URL = 'https://script.google.com/macros/s/AKfycbw-WkIdWhJ_ZEVkeZRr-rP8ha2QHBFQX6VNxEZ00Wc_eHIFYheJhLhbSX2NCfNPR9sI/exec';

export async function loadDashboard(user) {
  const userRef = doc(db, "users", user.email);
  const snap = await getDoc(userRef);
  const userData = snap.exists() ? snap.data() : {};
  startClock();
  await renderWidgets(userData);
  updateGreeting();
  loadWeather();
  loadCalendar();
  setInterval(loadWeather, 30*60000);
  setInterval(loadCalendar, 5*60000);
}

function startClock() {
  const dias = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
  const meses = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  function tick() {
    const now = new Date();
    const dEl = document.getElementById("meta-date");
    const tEl = document.getElementById("meta-time");
    if (dEl) dEl.textContent = `${dias[now.getDay()].slice(0,3)} ${now.getDate()} ${meses[now.getMonth()]}`;
    if (tEl) tEl.textContent = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  }
  tick();
  setInterval(tick, 30000);
}

const WI = {0:'☀️',1:'🌤️',2:'⛅',3:'☁️',45:'🌫️',48:'🌫️',51:'🌦️',53:'🌦️',55:'🌧️',61:'🌧️',63:'🌧️',65:'🌧️',71:'🌨️',73:'🌨️',75:'❄️',80:'🌦️',81:'🌧️',82:'⛈️',95:'⛈️',96:'⛈️',99:'⛈️'};
const WD = {0:'Despejado',1:'Mayormente despejado',2:'Parcialmente nublado',3:'Nublado',45:'Niebla',48:'Niebla',51:'Llovizna',53:'Llovizna',55:'Llovizna intensa',61:'Lluvia ligera',63:'Lluvia',65:'Lluvia intensa',80:'Chubascos',81:'Chubascos',82:'Tormenta',95:'Tormenta'};

function loadWeather() {
  fetch('https://api.open-meteo.com/v1/forecast?latitude=25.7617&longitude=-80.1918&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&temperature_unit=celsius&wind_speed_unit=kmh&timezone=auto',{cache:'no-store'})
    .then(r => r.json())
    .then(j => {
      const d = j.current;
      const el = id => document.getElementById(id);
      if (el('weatherIcon')) el('weatherIcon').textContent = WI[d.weather_code]||'🌡️';
      if (el('weatherTemp')) el('weatherTemp').textContent = Math.round(d.temperature_2m)+'°C';
      if (el('weatherDesc')) el('weatherDesc').textContent = WD[d.weather_code]||'—';
      if (el('weatherHumidity')) el('weatherHumidity').textContent = d.relative_humidity_2m+'%';
      if (el('weatherWind')) el('weatherWind').textContent = Math.round(d.wind_speed_10m)+' km/h';
      if (el('weatherFeels')) el('weatherFeels').textContent = Math.round(d.apparent_temperature)+'°C';
    })
    .catch(() => { const el = document.getElementById('weatherDesc'); if (el) el.textContent='Sin datos'; });
}

let meetTick = null, meetISO = null;
function fmtDate(dt) { return dt.toLocaleString('es-ES',{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }
function pad2(n) { return String(n).padStart(2,'0'); }
function updateCountdown() {
  if (!meetISO) return;
  const el = document.getElementById('meetCountdown');
  if (!el) return;
  const diff = new Date(meetISO).getTime() - Date.now();
  if (diff <= 0) { el.textContent = '¡Es ahora!'; el.classList.add('live'); return; }
  el.classList.remove('live');
  const d = Math.floor(diff/864e5), h = Math.floor((diff%864e5)/36e5), m = Math.floor((diff%36e5)/6e4);
  const p = []; if (d) p.push(d+'d'); p.push(pad2(h)+'h'); p.push(pad2(m)+'m');
  el.textContent = 'En ' + p.join(' ');
}
function loadCalendar() {
  const el = id => document.getElementById(id);
  fetch(CALENDAR_URL,{cache:'no-store'})
    .then(r => r.json())
    .then(data => {
      if (!data.found) {
        if (el('meetTitle')) el('meetTitle').textContent = 'Sin misiones próximas';
        if (el('meetMeta')) el('meetMeta').textContent = 'No hay eventos en los próximos 7 días';
        if (el('meetCountdown')) el('meetCountdown').textContent = '—';
        return;
      }
      meetISO = data.startISO;
      if (el('meetTitle')) el('meetTitle').textContent = data.title;
      if (el('meetMeta')) el('meetMeta').textContent = data.startISO ? fmtDate(new Date(data.startISO)) : '—';
      if (el('meetUpcoming') && data.upcomingTitles?.length) el('meetUpcoming').textContent = '+ '+data.upcomingTitles.join(' · ');
      const link = el('meetLink');
      if (link) { link.href = data.meetUrl || 'https://calendar.google.com'; link.textContent = data.meetUrl ? 'Unirse' : 'Calendar'; }
      if (meetTick) clearInterval(meetTick);
      updateCountdown();
      meetTick = setInterval(updateCountdown, 30000);
    })
    .catch(() => {
      if (el('meetTitle')) el('meetTitle').textContent = 'No se pudo cargar';
      if (el('meetMeta')) el('meetMeta').textContent = 'Revisa el Apps Script';
    });
}
