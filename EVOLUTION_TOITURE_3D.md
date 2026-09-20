# Evolution - Rendu fiable des toitures 3D

## But

Remplacer l'extrusion 3D plate des batiments par des toitures mesurees : pans, faitages, pignons, obstacles et hauteurs coherentes avec les calculs solaires.

Les boutons de forme de toiture du prototype restent des hypotheses d'etude. Ils ne doivent pas modifier le volume 3D tant qu'aucune geometrie de toiture qualifiee n'est disponible.

## Limite du rendu actuel

Les tuiles vectorielles OpenFreeMap/OpenStreetMap sont une source de contexte en lecture seule. MapLibre peut extruder une empreinte avec une hauteur uniforme, mais ne peut pas decrire un toit a pente, un faitage ou un pignon par les seules proprietes d'une `fill-extrusion`.

Un maillage client fabrique a partir d'une simple empreinte ne peut pas garantir la forme reelle du toit et risque de ne pas rester coherent avec les batiments et les ombres affiches.

## Architecture recommandee

1. Recuperer l'empreinte du batiment et les donnees d'elevation disponibles.
2. Utiliser en priorite le LiDAR HD IGN ou une source altimetrique de precision equivalente.
3. Segmenter les plans de toiture, detecter les faitages, pignons, lucarnes, cheminees et zones exclues dans un traitement serveur.
4. Calculer et stocker, pour chaque pan, la geometrie, l'azimut, la pente, la surface, l'altitude et un niveau de confiance.
5. Generer un maillage ferme et valide par batiment.
6. Publier ce maillage en 3D Tiles ou glTF, ainsi que les facettes en PostGIS pour les calculs geospatiaux.
7. Afficher les maillages 3D avec un moteur adapte aux objets 3D, par exemple CesiumJS et 3D Tiles. MapLibre peut rester la carte de navigation et de recherche.

## Sources et replis

| Source | Usage | Niveau de confiance |
| --- | --- | --- |
| LiDAR HD IGN ou modele de surface precis | Reconstruction des pans et masques proches | Eleve, apres controle de qualite |
| Modele urbain CityGML/LoD2 publie localement | Maillage ou validation de toiture | Variable selon date et precision |
| Attributs OSM `roof:*` | Hypothese initiale lorsque coherente | Faible a moyen |
| Saisie manuelle guidee | Correction des cas non couverts | Faible, a valider |

## Criteres d'acceptation

- Chaque toit affiche un volume ferme sans intersection avec les batiments voisins.
- Les facettes visibles, les facettes utilisees pour le calcul PV et les facettes utilisees pour les ombres proviennent de la meme source versionnee.
- La provenance, la date des donnees et le niveau de confiance sont visibles dans l'etude.
- En absence de donnees suffisantes, le produit affiche une hypothese editable et non une toiture pretendument mesuree.

## Priorite de mise en oeuvre

Commencer par une zone pilote couverte par le LiDAR, par exemple autour de Bourges apres verification de la disponibilite et de la date des donnees. Comparer les pans reconstruits avec des orthophotos et quelques controles terrain avant une generalisation nationale.
