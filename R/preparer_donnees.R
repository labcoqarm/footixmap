# FootixMap : construit data/matchs.geojson (saison 2025-2026)
# Matchs, dates, horaires et scores : FFF (donnees/scores_fff_2025_2026.csv, voir outils/extraire_scores_fff.js)
# Position des stades : géocodage Nominatim (donnees/matchs_geocodes.csv) corrigé par donnees/corrections_stades.csv

library(sf)

# Chemins relatifs à la racine du projet (ouvrir footixmap.Rproj)
f_fff <- "donnees/scores_fff_2025_2026.csv"
f_correspondance <- "donnees/correspondance_equipes.csv"
f_geocodes <- "donnees/matchs_geocodes.csv"
f_corrections <- "donnees/corrections_stades.csv"
f_sortie <- "data/matchs.geojson"

fff <- read.csv2(f_fff, fileEncoding = "UTF-8", stringsAsFactors = FALSE, na.strings = "")
correspondance <- read.csv2(f_correspondance, fileEncoding = "UTF-8", stringsAsFactors = FALSE)
geocodes <- read.csv2(f_geocodes, fileEncoding = "UTF-8", stringsAsFactors = FALSE)
corrections <- read.csv(f_corrections, fileEncoding = "UTF-8", stringsAsFactors = FALSE)

# Un stade par club et par division, tiré du géocodage des matchs à domicile
stades <- unique(geocodes[, c("categorie", "homeTeam", "location", "ville", "latitude", "longitude")])
names(stades) <- c("categorie", "club", "stade", "ville", "latitude", "longitude")
stades$latitude <- as.numeric(stades$latitude)
stades$longitude <- as.numeric(stades$longitude)
if (anyDuplicated(stades[, c("categorie", "club")])) stop("Un club a plusieurs stades dans ", f_geocodes)

# Corrections : stade mal placé par Nominatim, stade réellement utilisé selon la FFF, ou club absent du géocodage
for (i in seq_len(nrow(corrections))) {
  cor <- corrections[i, c("categorie", "club", "stade", "ville", "latitude", "longitude")]
  sel <- stades$categorie == cor$categorie & stades$club == cor$club
  if (any(sel)) stades[sel, ] <- cor else stades <- rbind(stades, cor)
}

# Les lignes sans adversaire sont les journées où un club de National est exempt (17 clubs en 2025-2026)
exempt <- is.na(fff$domicile_fff) | is.na(fff$exterieur_fff)
cat(sum(exempt), "lignes d'exemption retirées\n")
fff <- fff[!exempt, ]

# Noms FFF vers noms de la carte
nom_carte <- function(cat, equipe) {
  cle_fff <- paste(correspondance$categorie, correspondance$equipe_fff)
  res <- correspondance$equipe_carte[match(paste(cat, equipe), cle_fff)]
  if (anyNA(res)) stop("Équipe FFF sans correspondance : ", paste(unique(equipe[is.na(res)]), collapse = ", "))
  res
}
fff$homeTeam <- nom_carte(fff$categorie, fff$domicile_fff)
fff$awayTeam <- nom_carte(fff$categorie, fff$exterieur_fff)

# Rattachement au stade du club qui reçoit
idx <- match(paste(fff$categorie, fff$homeTeam), paste(stades$categorie, stades$club))
if (anyNA(idx)) stop("Club sans stade : ", paste(unique(fff$homeTeam[is.na(idx)]), collapse = ", "))

if (anyNA(fff$date)) stop("Match sans date dans ", f_fff)

matchs <- data.frame(
  categorie = fff$categorie,
  journee = fff$journee,
  date = fff$date,
  heure = sub("H", ":", fff$heure),
  homeTeam = fff$homeTeam,
  awayTeam = fff$awayTeam,
  butsDom = fff$buts_dom,
  butsExt = fff$buts_ext,
  arrete = fff$arret == "O",
  location = stades$stade[idx],
  ville = stades$ville[idx],
  terrainFFF = fff$terrain,
  villeFFF = fff$ville_terrain,
  latitude = stades$latitude[idx],
  longitude = stades$longitude[idx]
)
matchs <- matchs[order(matchs$date, matchs$heure, matchs$categorie), ]
matchs <- cbind(index = seq_len(nrow(matchs)), matchs)

cat(sum(is.na(matchs$butsDom)), "match(s) sans score communiqué\n")
pts <- st_as_sf(matchs, coords = c("longitude", "latitude"), crs = 4326)
st_write(pts, f_sortie, driver = "GeoJSON", delete_dsn = TRUE, layer_options = "COORDINATE_PRECISION=6", quiet = TRUE)
cat(nrow(pts), "matchs écrits dans", f_sortie, "\n")
