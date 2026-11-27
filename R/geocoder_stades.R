# FootixMap : géocode les stades de BDD_FOOT.csv avec Nominatim (OpenStreetMap)
# Nominatim demande un User-Agent identifiable : le définir dans la variable NOMINATIM_UA
# Les stades mal placés ont ensuite été corrigés à la main (donnees/corrections_stades.csv)

library(httr)
library(jsonlite)
library(readr)
library(writexl)

# Lire le CSV
matchs <- read_csv("donnees/BDD_FOOT.csv", guess_max = 10000)

# Le CSV source est en Latin-1
repair_encoding <- function(x) {
  if (!is.character(x)) return(x)
  iconv(x, from = "Latin1", to = "UTF-8")
}

matchs[] <- lapply(matchs, repair_encoding)

# Nettoyer location : supprimer tout ce qui est entre parenthèses
matchs$location <- trimws(gsub("\\s*\\([^)]*\\)", "", matchs$location))

# Inverser les coordonnées existantes si elles sont au format lon,lat
matchs$coordonnees_Stade <- ifelse(
  !is.na(matchs$coordonnees_Stade) & matchs$coordonnees_Stade != "",
  sapply(strsplit(matchs$coordonnees_Stade, ","), function(x) {
    if (length(x) == 2) paste0(x[2], ",", x[1]) else NA_character_
  }),
  matchs$coordonnees_Stade
)

# Fonctions de géocodage
geocode_forward <- function(nom_stade, sleep_sec = 1) {
  if (is.na(nom_stade) || nom_stade == "") return(NA_character_)
  
  # Cas spécifiques pour Monaco et autres stades problématiques
  query_base <- nom_stade
  if (grepl("Louis II", nom_stade, ignore.case = TRUE)) {
    query_base <- "Stade Louis II, Monaco"
  } else if (grepl("Francis-Le Blé", nom_stade, ignore.case = TRUE)) {
    query_base <- "Stade Francis-Le Blé, Brest"
  } else if (grepl("Vélodrome", nom_stade, ignore.case = TRUE)) {
    query_base <- "Stade Vélodrome, Marseille"
  } else if (grepl("Charléty", nom_stade, ignore.case = TRUE)) {
    query_base <- "Stade Charléty, Paris"
  } else if (grepl("Océane", nom_stade, ignore.case = TRUE)) {
    query_base <- "Stade Océane, Le Havre"
  } else {
    query_base <- paste(nom_stade, "France")
  }
  
  url <- "https://nominatim.openstreetmap.org/search"
  reponse <- GET(
    url,
    query = list(q = query_base, format = "json", limit = 1),
    add_headers(`User-Agent` = Sys.getenv("NOMINATIM_UA", "FootixMap"), `Accept-Language` = "fr-FR")
  )
  Sys.sleep(sleep_sec)
  
  if (status_code(reponse) != 200) {
    warning("Forward: erreur HTTP ", status_code(reponse), " pour ", nom_stade)
    return(NA_character_)
  }
  
  json <- content(reponse, "parsed")
  if (length(json) == 0 || is.null(json[[1]]$lon)) return(NA_character_)
  
  # Format lat,lon
  paste0(round(as.numeric(json[[1]]$lat), 6), ",", round(as.numeric(json[[1]]$lon), 6))
}

geocode_reverse <- function(lonlat, sleep_sec = 1) {
  if (is.na(lonlat) || lonlat == "") return(NA_character_)
  
  coords <- strsplit(lonlat, ",")[[1]]
  if (length(coords) != 2) return(NA_character_)
  
  # Maintenant au format lat,lon
  lat <- coords[1]; lon <- coords[2]
  
  url <- "https://nominatim.openstreetmap.org/reverse"
  reponse <- GET(
    url,
    query = list(lat = lat, lon = lon, format = "json", addressdetails = 1, zoom = 10),
    add_headers(`User-Agent` = Sys.getenv("NOMINATIM_UA", "FootixMap"), `Accept-Language` = "fr-FR")
  )
  Sys.sleep(sleep_sec)
  
  if (status_code(reponse) != 200) {
    warning("Reverse: erreur HTTP pour ", lonlat)
    return(NA_character_)
  }
  
  json <- content(reponse, "parsed")
  if (!is.null(json$address$town)) return(json$address$town)
  if (!is.null(json$address$city)) return(json$address$city)
  if (!is.null(json$address$village)) return(json$address$village)
  if (!is.null(json$address$country) && grepl("Monaco", json$address$country, ignore.case = TRUE)) {
    return("Monaco") # Monaco n'a pas de "town" ou "city" dans l'API
  }
  return(NA_character_)
}

# Exécution avec cache
cache_forward <- new.env(hash = TRUE)
cache_reverse <- new.env(hash = TRUE)

# Géocodage direct uniquement si coordonnees_Stade est manquant
matchs$coordonnees_Stade <- ifelse(
  is.na(matchs$coordonnees_Stade) | matchs$coordonnees_Stade == "",
  sapply(matchs$location, function(stade) {
    if (is.null(cache_forward[[stade]])) {
      cache_forward[[stade]] <<- geocode_forward(stade)
    }
    cache_forward[[stade]]
  }, USE.NAMES = FALSE),
  matchs$coordonnees_Stade
)

# Géocodage inverse uniquement si ville est manquante
matchs$ville <- ifelse(
  is.na(matchs$ville) | matchs$ville == "",
  sapply(matchs$coordonnees_Stade, function(coord) {
    if (is.null(cache_reverse[[coord]])) {
      cache_reverse[[coord]] <<- geocode_reverse(coord)
    }
    cache_reverse[[coord]]
  }, USE.NAMES = FALSE),
  matchs$ville
)

matchs$coordonnees_ville <- NULL

# Sauvegarder en CSV
write_csv(matchs, "donnees/matchs_geocodes_osm.csv")

# Sauvegarder en XLSX
write_xlsx(matchs, "donnees/matchs_geocodes_osm.xlsx")

cat("Terminé\n")