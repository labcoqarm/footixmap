/* FootixMap : paramètres de l'application */

const CONFIG = {
  // "fichier" lit les GeoJSON du dossier data/ (GitHub Pages)
  // "geoserver" interroge le WFS d'un GeoServer local (architecture 3-tiers d'origine)
  source: "fichier",

  fichierMatchs: "data/matchs.geojson",
  fichierRegions: "data/regions.geojson",

  geoserverUrl: "http://localhost:8080/geoserver",
  workspace: "footix",
  layerMatchs: "matchs",
  layerRegions: "regions",

  couleurs: {
    "Ligue 1": "#d62828",
    "Ligue 2": "#1d4e89",
    "National 1": "#2a9d8f",
    "National 2A": "#e9a03b",
    "National 2B": "#8f5fa8",
    "National 2C": "#6b8f23"
  },

  centre: [46.6, 2.5],
  zoom: 6
};
