/* FootixMap : carte des matchs de football (Ligue 1 à National 2) */

let map, cluster, chart, lienPlusProche;
let matchs = [];
let affiches = [];
let regions = [];
let centreTampon = null;
let cercleTampon = null;
let selectionCarte = false;

const $ = id => document.getElementById(id);

function info(html) {
  $("distance-info").innerHTML = html;
}

// Chargement des données

function urlWfs(couche) {
  const params = new URLSearchParams({
    service: "WFS",
    version: "1.1.0",
    request: "GetFeature",
    typeName: CONFIG.workspace + ":" + couche,
    outputFormat: "application/json",
    srsName: "EPSG:4326"
  });
  return CONFIG.geoserverUrl + "/wfs?" + params;
}

function lireGeojson(url) {
  return fetch(url).then(r => {
    if (!r.ok) throw new Error("Lecture impossible : " + url + " (HTTP " + r.status + ")");
    return r.json();
  });
}

function chargerDonnees() {
  const geoserver = CONFIG.source === "geoserver";
  const urlMatchs = geoserver ? urlWfs(CONFIG.layerMatchs) : CONFIG.fichierMatchs;
  const urlRegions = geoserver ? urlWfs(CONFIG.layerRegions) : CONFIG.fichierRegions;
  return Promise.all([lireGeojson(urlMatchs), lireGeojson(urlRegions)]);
}

function preparerMatchs(geojson) {
  return geojson.features.map(f => {
    const p = f.properties;
    return {
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      categorie: p.categorie,
      journee: p.journee,
      date: p.date,
      heure: p.heure,
      butsDom: p.butsDom,
      butsExt: p.butsExt,
      arrete: p.arrete,
      terrainFFF: p.terrainFFF,
      villeFFF: p.villeFFF,
      homeTeam: p.homeTeam,
      awayTeam: p.awayTeam,
      location: p.location,
      ville: p.ville,
      region: ""
    };
  });
}

// La région de chaque match est calculée une seule fois au chargement
function affecterRegions() {
  matchs.forEach(m => {
    const pt = turf.point([m.lon, m.lat]);
    const r = regions.find(f => turf.booleanPointInPolygon(pt, f));
    m.region = r ? r.properties.nom : "Hors régions françaises";
  });
}

// Carte

function initialiser() {
  map = L.map("mymap").setView(CONFIG.centre, CONFIG.zoom);

  const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; contributeurs OpenStreetMap"
  }).addTo(map);
  const satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "&copy; Esri"
  });
  L.control.layers({ "OpenStreetMap": osm, "Satellite": satellite }, {}, { position: "topleft" }).addTo(map);

  cluster = L.markerClusterGroup({ maxClusterRadius: 40 });
  map.addLayer(cluster);
  ajouterLegende();

  map.on("click", e => {
    if (selectionCarte) {
      selectionCarte = false;
      $("mymap").classList.remove("viseur");
      definirCentre(e.latlng.lat, e.latlng.lng);
    } else {
      matchLePlusProche(e.latlng.lat, e.latlng.lng);
    }
  });

  $("btnFiltrer").onclick = afficherMatchs;
  $("btnReset").onclick = reinitialiser;
  $("btnHasard").onclick = matchAuHasard;
  $("btnExport").onclick = exporterCSV;
  $("btnCarte").onclick = activerSelectionCarte;
  $("btnTampon").onclick = tracerTampon;
  $("btnEffacerTampon").onclick = effacerTampon;
  ["statsTeam", "statsRegion", "statsCategorie"].forEach(id => $(id).onchange = majStats);
  initAutocompletion();

  chargerDonnees().then(([geoMatchs, geoRegions]) => {
    regions = geoRegions.features;
    L.geoJSON(geoRegions, { style: { color: "#555", weight: 1, fillOpacity: 0.03 }, interactive: false }).addTo(map);
    matchs = preparerMatchs(geoMatchs);
    affecterRegions();
    remplirListes();
    afficherMatchs();
    info(matchs.length + " matchs chargés. Cliquez sur la carte pour trouver le match le plus proche.");
  }).catch(err => {
    info('<span class="erreur">' + err.message + "</span>");
    throw err;
  });
}

function ajouterLegende() {
  const legende = L.control({ position: "bottomright" });
  legende.onAdd = () => {
    const div = L.DomUtil.create("div", "legende");
    div.innerHTML = Object.entries(CONFIG.couleurs).map(([cat, coul]) => '<i style="background:' + coul + '"></i>' + cat).join("<br>");
    return div;
  };
  legende.addTo(map);
}

function remplirListes() {
  const tri = arr => [...new Set(arr)].sort((a, b) => a.localeCompare(b, "fr"));
  const cats = Object.keys(CONFIG.couleurs).filter(c => matchs.some(m => m.categorie === c));
  const noms = tri(regions.map(r => r.properties.nom));
  remplir("categorie", cats);
  remplir("statsCategorie", cats);
  remplir("region", noms);
  remplir("statsRegion", noms);
  remplir("homeTeam", tri(matchs.map(m => m.homeTeam)));
  remplir("awayTeam", tri(matchs.map(m => m.awayTeam)));
  remplir("statsTeam", tri(matchs.flatMap(m => [m.homeTeam, m.awayTeam])));
}

function remplir(id, valeurs) {
  valeurs.forEach(v => $(id).appendChild(new Option(v, v)));
}

function dateFr(iso) {
  return new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function score(m) {
  if (m.butsDom === null || m.butsDom === undefined) return "score non communiqué";
  return m.butsDom + " - " + m.butsExt + (m.arrete ? " (match arrêté)" : "");
}

// Compare deux noms de commune sans accents, casse ni tirets (« Paris 13e » et « PARIS » sont la même ville)
function memeVille(a, b) {
  const norm = v => (v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\bst\b/g, "saint").replace(/[^a-z]/g, "");
  const x = norm(a);
  const y = norm(b);
  return x.startsWith(y) || y.startsWith(x);
}

function popup(m) {
  const lignes = [
    "<b>" + m.homeTeam + " " + score(m) + " " + m.awayTeam + "</b>",
    dateFr(m.date) + " à " + m.heure,
    m.categorie + ", journée " + m.journee,
    m.location + " (" + m.ville + ")"
  ];
  if (m.villeFFF && !memeVille(m.ville, m.villeFFF)) lignes.push("<i>Joué selon la FFF à : " + m.terrainFFF + ", " + m.villeFFF + "</i>");
  return lignes.join("<br>");
}

// Filtres

function dansTampon(m) {
  if (!cercleTampon) return true;
  const rayon = cercleTampon.getRadius() / 1000;
  return turf.distance([centreTampon.lng, centreTampon.lat], [m.lon, m.lat], { units: "kilometers" }) <= rayon;
}

function afficherMatchs() {
  const d1 = $("dateDebut").value;
  const d2 = $("dateFin").value;
  const cat = $("categorie").value;
  const dom = $("homeTeam").value;
  const ext = $("awayTeam").value;
  const reg = $("region").value;

  affiches = matchs.filter(m => {
    if (d1 && m.date < d1) return false;
    if (d2 && m.date > d2) return false;
    if (cat && m.categorie !== cat) return false;
    if (dom && m.homeTeam !== dom) return false;
    if (ext && m.awayTeam !== ext) return false;
    if (reg && m.region !== reg) return false;
    return dansTampon(m);
  });

  cluster.clearLayers();
  affiches.forEach(m => {
    m.marqueur = L.circleMarker([m.lat, m.lon], {
      radius: 7,
      fillColor: CONFIG.couleurs[m.categorie] || "#888",
      color: "#222",
      weight: 1,
      fillOpacity: 0.85
    }).bindPopup(popup(m));
    cluster.addLayer(m.marqueur);
  });

  if (cercleTampon) {
    map.fitBounds(cercleTampon.getBounds());
  } else if (affiches.length) {
    map.fitBounds(cluster.getBounds().pad(0.1));
  }
  majStats();
  return affiches.length;
}

function reinitialiser() {
  ["dateDebut", "dateFin", "categorie", "homeTeam", "awayTeam", "region"].forEach(id => $(id).value = "");
  effacerTampon();
}

// Rayon autour d'une adresse ou d'un point cliqué

function definirCentre(lat, lon) {
  if (centreTampon) map.removeLayer(centreTampon.marqueur);
  centreTampon = L.latLng(lat, lon);
  centreTampon.marqueur = L.marker(centreTampon).addTo(map);
  info("Point choisi. Réglez le rayon puis cliquez sur « Matchs dans le rayon ».");
}

function activerSelectionCarte() {
  selectionCarte = true;
  $("mymap").classList.add("viseur");
  info("Cliquez sur la carte pour placer le centre du rayon.");
}

function tracerTampon() {
  if (!centreTampon) {
    info("Choisissez d'abord une adresse ou un point sur la carte.");
    return;
  }
  const km = parseFloat($("rayonKm").value);
  if (!(km > 0)) {
    info("Le rayon doit être un nombre de kilomètres positif.");
    return;
  }
  if (cercleTampon) map.removeLayer(cercleTampon);
  cercleTampon = L.circle(centreTampon, { radius: km * 1000, color: "#d62828", weight: 2, fillOpacity: 0.08 }).addTo(map);
  const n = afficherMatchs();
  info(n + " match(s) à moins de " + km + " km avec les filtres actuels.");
}

function effacerTampon() {
  if (cercleTampon) map.removeLayer(cercleTampon);
  if (centreTampon) map.removeLayer(centreTampon.marqueur);
  cercleTampon = null;
  centreTampon = null;
  afficherMatchs();
}

function matchLePlusProche(lat, lon) {
  if (!affiches.length) return;
  let proche = null;
  let dmin = Infinity;
  affiches.forEach(m => {
    const d = turf.distance([lon, lat], [m.lon, m.lat], { units: "kilometers" });
    if (d < dmin) {
      dmin = d;
      proche = m;
    }
  });
  if (lienPlusProche) map.removeLayer(lienPlusProche);
  lienPlusProche = L.polyline([[lat, lon], [proche.lat, proche.lon]], { color: "#f28c28", weight: 3, dashArray: "6,6" }).addTo(map);
  info("Match le plus proche : " + proche.homeTeam + " " + score(proche) + " " + proche.awayTeam + ", " + proche.location + " (" + proche.ville + "), à " + dmin.toFixed(1) + " km à vol d'oiseau");
}

// Statistiques

function majStats() {
  const team = $("statsTeam").value;
  const reg = $("statsRegion").value;
  const cat = $("statsCategorie").value;

  const sel = affiches.filter(m => {
    if (team && m.homeTeam !== team && m.awayTeam !== team) return false;
    if (reg && m.region !== reg) return false;
    if (cat && m.categorie !== cat) return false;
    return true;
  });

  const joues = sel.filter(m => m.butsDom !== null && m.butsDom !== undefined);
  const buts = joues.reduce((t, m) => t + m.butsDom + m.butsExt, 0);
  $("nbMatchs").textContent = sel.length;
  $("nbStades").textContent = new Set(sel.map(m => m.location + "|" + m.ville)).size;
  $("nbButs").textContent = buts + (joues.length ? " (" + (buts / joues.length).toFixed(2).replace(".", ",") + " par match)" : "");
  $("ligneBilan").style.display = team ? "block" : "none";
  if (team) {
    let v = 0, n = 0, d = 0, bp = 0, bc = 0;
    joues.forEach(m => {
      const pour = m.homeTeam === team ? m.butsDom : m.butsExt;
      const contre = m.homeTeam === team ? m.butsExt : m.butsDom;
      bp += pour;
      bc += contre;
      if (pour > contre) v++;
      else if (pour === contre) n++;
      else d++;
    });
    $("bilan").textContent = v + " V, " + n + " N, " + d + " D, " + bp + " buts marqués, " + bc + " encaissés";
  }

  // Nombre de matchs par mois, empilé par division
  const mois = [...new Set(sel.map(m => m.date.slice(0, 7)))].sort();
  const cats = Object.keys(CONFIG.couleurs).filter(c => sel.some(m => m.categorie === c));
  const series = cats.map(c => ({
    label: c,
    backgroundColor: CONFIG.couleurs[c],
    data: mois.map(mm => sel.filter(m => m.categorie === c && m.date.startsWith(mm)).length)
  }));
  const etiquettes = mois.map(mm => new Date(mm + "-15").toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }));

  if (chart) chart.destroy();
  chart = new Chart($("statsChart"), {
    type: "bar",
    data: { labels: etiquettes, datasets: series },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { title: { display: true, text: "Matchs par mois" }, legend: { labels: { boxWidth: 12 } } },
      scales: { x: { stacked: true }, y: { stacked: true, ticks: { precision: 0 } } }
    }
  });
}

// Actions

function exporterCSV() {
  if (!affiches.length) {
    info("Aucun match à exporter.");
    return;
  }
  const champs = ["date", "heure", "categorie", "journee", "homeTeam", "awayTeam", "butsDom", "butsExt", "location", "ville", "region", "lat", "lon"];
  const lignes = affiches.map(m => champs.map(c => String(m[c] ?? "").replace(/;/g, ",")).join(";"));
  const csv = "﻿" + [champs.join(";"), ...lignes].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = "footixmap_matchs.csv";
  a.click();
}

function matchAuHasard() {
  if (!affiches.length) {
    info("Aucun match avec ces filtres.");
    return;
  }
  const m = affiches[Math.floor(Math.random() * affiches.length)];
  cluster.zoomToShowLayer(m.marqueur, () => m.marqueur.openPopup());
  info("Match tiré au sort : " + m.homeTeam + " " + score(m) + " " + m.awayTeam + ", " + dateFr(m.date));
}

// Autocomplétion d'adresse avec la Base Adresse Nationale

function initAutocompletion() {
  const champ = $("adresseTampon");
  const liste = $("adresse-suggestions");
  let minuteur;

  champ.addEventListener("input", () => {
    clearTimeout(minuteur);
    const q = champ.value.trim();
    if (q.length < 3) {
      liste.style.display = "none";
      return;
    }
    minuteur = setTimeout(() => chercherAdresses(q), 300);
  });

  document.addEventListener("click", e => {
    if (!champ.contains(e.target) && !liste.contains(e.target)) liste.style.display = "none";
  });
}

function chercherAdresses(q) {
  const liste = $("adresse-suggestions");
  fetch("https://api-adresse.data.gouv.fr/search/?q=" + encodeURIComponent(q) + "&limit=5")
    .then(r => r.json())
    .then(data => {
      liste.innerHTML = "";
      data.features.forEach(f => {
        const div = document.createElement("div");
        div.className = "suggestion";
        div.textContent = f.properties.label;
        div.onclick = () => {
          $("adresseTampon").value = f.properties.label;
          liste.style.display = "none";
          const [lon, lat] = f.geometry.coordinates;
          map.setView([lat, lon], 11);
          definirCentre(lat, lon);
        };
        liste.appendChild(div);
      });
      liste.style.display = data.features.length ? "block" : "none";
    });
}

document.addEventListener("DOMContentLoaded", initialiser);
