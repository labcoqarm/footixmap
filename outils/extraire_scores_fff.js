// FootixMap : calendriers, horaires et scores 2025-2026 depuis l'API publique de la FFF (api-dofa.fff.fr)
// L'API refuse les requêtes faites hors navigateur (403 depuis R) : ce script se colle dans la console du navigateur (F12)
// sur un onglet ouvert à l'adresse https://api-dofa.fff.fr/api/compets/439449, puis télécharge scores_fff_2025_2026.csv
// Seuls les champs utiles à la carte sont gardés (pas les noms des arbitres et délégués)

// Numéros de compétition FFF de la saison 2025-2026 (cp_no) et poules à lire
const competitions = [
  ["Ligue 1", 439449, 1],
  ["Ligue 2", 439450, 1],
  ["National 1", 439454, 1],
  ["National 2A", 439451, 1],
  ["National 2B", 439451, 2],
  ["National 2C", 439451, 3]
];
const colonnes = ["categorie", "journee", "date", "heure", "domicile_fff", "exterieur_fff", "buts_dom", "buts_ext", "statut", "forfait_dom", "forfait_ext", "arret", "terrain", "ville_terrain", "ma_no"];

// Valeur vide quand le champ est absent (journée d'exemption, score non saisi)
const v = x => String(x ?? "").replace(/;/g, ",");

async function lirePoule(categorie, cpNo, poule) {
  const lignes = [];
  let url = `/api/compets/${cpNo}/phases/1/poules/${poule}/matchs?page=1`;
  while (url) {
    const reponse = await fetch(url, { headers: { accept: "application/ld+json" } });
    if (!reponse.ok) throw new Error("HTTP " + reponse.status + " sur " + url);
    const page = await reponse.json();
    for (const m of page["hydra:member"]) {
      const champs = [categorie, m.poule_journee?.number, (m.date ?? "").slice(0, 10), m.time, m.home?.short_name, m.away?.short_name, m.home_score, m.away_score, m.status, m.home_is_forfeit, m.away_is_forfeit, m.ma_arret, m.terrain?.name, m.terrain?.city, m.ma_no];
      lignes.push(champs.map(v).join(";"));
    }
    url = page["hydra:view"]?.["hydra:next"];
  }
  console.log(categorie + " : " + lignes.length + " matchs");
  return lignes;
}

let matchs = [];
for (const [categorie, cpNo, poule] of competitions) matchs = matchs.concat(await lirePoule(categorie, cpNo, poule));
if (matchs.length !== 1638) throw new Error("Nombre de matchs inattendu : " + matchs.length + " au lieu de 1638");

const csv = colonnes.join(";") + "\n" + matchs.join("\n") + "\n";
const lien = document.createElement("a");
lien.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
lien.download = "scores_fff_2025_2026.csv";
lien.click();
