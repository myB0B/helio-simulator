# Plan de developpement - Pre-etude photovoltaique

## 1. Objectif

Faire evoluer l'application cartographique existante vers un outil de pre-etude photovoltaique a la demande, par adresse.

Le resultat devra fournir, pour chaque pan de toiture exploitable :

- orientation (azimut) et inclinaison ;
- surface potentiellement installable ;
- duree d'ensoleillement et impact de l'ombrage ;
- irradiation recue ;
- puissance crete estimable ;
- production mensuelle et annuelle estimee en kWh ;
- hypotheses de calcul, sources des donnees et niveau de confiance.

Le produit vise la qualification commerciale et technique initiale. Il ne constitue pas une etude d'execution ni une garantie de production.

## 2. Perimetre valide

- Couverture : analyse nationale a la demande, adresse par adresse.
- Donnees d'etablissements ou de projets : saisie et maintien manuels.
- Restitution : potentiel complet, et non la seule exposition solaire.
- Precision : le calcul d'ombrage doit etre fiable, traceable et independant du rendu de la carte.

L'analyse a la demande evite le precalcul de toutes les toitures de France, mais suppose l'acces a des referentiels geographiques nationaux adequats.

## 3. Etat du prototype cartographique

Le prototype est maintenant un frontend Vite avec MapLibre GL. Leaflet et OSMBuildings ne sont plus charges par l'entree active de l'application.

Fonctions realisees :

- carte WebGL 3D deplacable, orientable et inclinable a la souris ;
- fond CARTO configure avec une cle publique injectee par variable d'environnement ;
- batiments vectoriels OpenFreeMap/OpenStreetMap extrudes en 3D, sans appel navigateur a l'API OSM ;
- recherche Nominatim, geolocalisation navigateur et centrage par adresse ;
- choix de date, d'heure et curseur horaire, relies a la position solaire SunCalc ;
- clic sur un batiment, y compris les composants `MultiPolygon`, avec selection de la composante proche du clic ;
- rose des facades en degres depuis le nord et choix de la facade la plus proche du sud comme reference de l'estimation ;
- calcul de surface depuis l'empreinte, choix manuel du type de toiture et de la facade de reference, puis estimation photovoltaique locale ;
- projection visuelle des ombres de volumes batis, avec une silhouette et une teinte uniforme ;
- tests unitaires du calcul solaire et geometrique, et build Vite operationnel.

Limites actuelles :

- les hauteurs, empreintes et facades proviennent des tuiles vectorielles ; leur qualite varie selon OpenStreetMap ;
- les tuiles vectorielles distantes sont en lecture seule et l'extrusion MapLibre ne supporte pas de pente par sommet ; une toiture 3D fidele exige des facettes qualifiees livrees par une source propre, des tuiles 3D ou un modele 3D ;
- une facade ou une empreinte ne donne pas l'azimut et la pente reels d'un pan de toiture ;
- les ombres sont un rendu visuel client : elles ne modelisent ni relief, ni vegetation, ni obstacles de toiture, ni penombre ;
- la silhouette d'ombre utilise une enveloppe convexe pour garantir un rendu uniforme ; elle ne constitue pas un masque geospatial qualifie ;
- aucun resultat de production ne doit etre presente comme une etude de pose ou une garantie.

### Parametrage photovoltaique du prototype

Le panneau d'etude raisonne sur le pan selectionne, y compris pour un double pan. En l'absence de facette de toiture qualifiee, sa surface reste une estimation issue de l'empreinte :

- toit terrasse : surface d'empreinte ;
- simple pan : surface d'empreinte corrigee de l'inclinaison ;
- double pan : moitie de l'empreinte corrigee de l'inclinaison.

Le module de reference mesure `1,961 m x 1,134 m`, soit `2,223774 m2`. La puissance DC est calculee depuis le nombre de panneaux et leur puissance unitaire, et non depuis une densite arbitraire de puissance. Le rendement module controle la coherence entre dimensions et Wc, mais ne modifie pas seul la puissance declaree.

Valeurs initiales modifiables de la pre-etude :

| Hypothese | Valeur initiale | Usage |
| --- | --- | --- |
| Nombre de panneaux | 8 | Pour le seul pan selectionne |
| Puissance unitaire | 520 Wc | Puissance DC installee |
| Rendement module | 23,38 % | Controle de coherence du module |
| Retraits techniques | 10 % du pan | Rives, acces et contraintes de pose |
| Jeux de pose | 3 % des panneaux | Rails, interstices et tolerances |
| Espacement inter-rangees | 10 % sur terrasse, 0 % sur pan incline | Limitation indicative des ombres entre rangees |
| Conversion | Onduleur central ou micro-onduleurs | Hypothese de materiel |
| Rendement de conversion | 96,6 % | Valeur editable |
| Cables | 2 % | Perte DC/AC preliminaire |
| Encrassement | 3 % | Perte preliminaire |
| Mismatch | 2 % | Dispersion des modules et chaines |
| Disponibilite | 1 % | Indisponibilite previsionnelle |
| Thermique | 6 % | Perte preliminaire faute de modele thermique detaille |
| Ecretage | 1 % | Hypothese initiale a confirmer avec le dimensionnement AC |

Le panneau distingue la surface non exploitable par retraits, la surface exploitable, la surface physique des modules, leur emprise de pose et la surface encore disponible. Une alerte apparait lorsque l'emprise de pose depasse la surface exploitable. Les pertes sont composees multiplicativement : rendement onduleur puis cables, encrassement, mismatch, disponibilite, thermique et ecretage. Ces hypotheses doivent etre remplacees par les caracteristiques du materiel et les contraintes reelles avant toute etude definitive.

### Editeur de configuration 2D

Un editeur visuel 2D complete la consultation 3D. Il est ouvert depuis la rose des facades d'un batiment selectionne, force une vue verticale et centre la carte sur l'emprise a corriger, au-dessus du fond, des parcelles et des couches de contexte.

Le projet edite reste local au navigateur dans cette premiere version : une structure versionnee conserve l'empreinte corrigee, les pans, les zones non exploitables, les groupes de panneaux et les hypotheses de l'etude. La donnee officielle reste intacte et sert de reference. Une phase ulterieure ajoutera comptes utilisateurs, API, PostGIS et historique partageable.

Fonctions cibles de l'editeur :

- modifier une empreinte existante par deplacement, ajout ou suppression de sommets, sans limite de quatre cotes ;
- creer un batiment libre ou une installation de panneaux au sol ;
- dessiner les pans, faitages, retraits, espaces de pose et panneaux aux dimensions reelles ;
- choisir l'orientation et le mode portrait/paysage des modules ;
- synchroniser surfaces, nombre de modules, puissance et production avec le panneau d'etude ;
- signaler les modules hors zone, les chevauchements et les geometres invalides.

Le rendu utilisera une source GeoJSON d'edition dediee et des couleurs semantiques distinctes : batiment bleu, surface exploitable verte, retraits orange, pan selectionne jaune, panneaux bleus et conflits rouges. Le zoom de la carte est porte a 22 pour la manipulation, mais ne rend pas les referentiels raster ou vectoriels plus precis que leur source.

## 4. Architecture cible

### Frontend

- Carte de recherche et selection d'adresse.
- Visualisation du batiment, des pans detectes, des exclusions et des zones d'ombre.
- Formulaire d'hypotheses : module, pertes, contraintes de pose et consommation optionnelle.
- Suivi de la progression du calcul et restitution partageable.

### API et traitements

- API securisee pour creer et consulter les analyses.
- File de traitement asynchrone pour les calculs geospatiaux et energetiques.
- Workers capables de reprendre une analyse en echec.
- Cache des donnees geographiques et resultats par adresse, scenario et version de referentiel.

### Donnees

- PostgreSQL avec PostGIS.
- Geometries des batiments, pans de toiture, obstacles et zones exclues.
- Versionnement des sources geographiques et des parametres de calcul.
- Historique des corrections manuelles et journal d'audit.

### Calcul

- Position solaire astronomique par pas de temps documente.
- Extraction de plans de toiture depuis des donnees d'elevation de haute precision.
- Ray tracing ou methode geospatiale equivalente contre batiments, relief et vegetation disponibles.
- Calcul de l'irradiation et de la production avec une bibliotheque photovoltaique eprouvee, par exemple pvlib.

Le navigateur ne doit pas etre la source du resultat de reference. Il affiche les resultats et permet les corrections, tandis que le serveur garantit reproductibilite et tracabilite.

## 5. Referentiels necessaires

1. Geocodage d'adresse et empreinte de batiment.
2. Donnees OpenStreetMap pour les empreintes, hauteurs et attributs de toiture lorsqu'ils existent.
3. Modele numerique de surface, idealement LiDAR, pour reconstruire les plans de toiture, les obstacles, le relief et la vegetation.
4. Donnees meteorologiques et d'irradiation historiques. PVGIS constitue une option ouverte pour l'irradiation et les estimations de production par localisation.
5. Parametres techniques de modules, onduleurs et pertes systeme.

En absence de donnees d'elevation suffisamment precises, l'application doit declarer le resultat comme estimatif et autoriser la correction manuelle de l'orientation, de la pente et des zones exploitables.

## 6. Strategie de donnees sans pans de toiture fournis

### Source de base : OpenStreetMap et tuiles vectorielles

OpenStreetMap est adapte pour obtenir l'empreinte d'un batiment et, de facon non uniforme, des attributs tels que `height`, `building:levels`, `roof:shape`, `roof:direction`, `roof:orientation`, `roof:height` ou `roof:levels`.

Ces attributs ne sont ni obligatoires ni homogenes. Ils ne suffisent donc pas a garantir l'orientation, l'inclinaison ou la surface d'un pan de toiture partout en France. Les donnees OpenStreetMap sont sous licence ODbL : l'attribution est obligatoire et les obligations de partage doivent etre examinees avant de distribuer une base derivee.

Le prototype utilise des tuiles vectorielles OpenFreeMap alimentees par OpenStreetMap pour afficher les volumes 3D. Cette source evite les appels directs a l'API OSM dans le navigateur, mais reste une couche de contexte. Il ne faut pas inferer une toiture fiable depuis son rendu ou ses attributs incomplets.

### Strategie recommandee : niveaux de donnees

1. Utiliser les attributs OSM de toiture lorsqu'ils sont presents et coherents.
2. Sinon, reconstruire les plans de toiture depuis une donnee altimetrique ouverte de haute precision, notamment les produits LiDAR ou modeles de surface disponibles via l'IGN.
3. Completer les masques d'ombre avec les empreintes et hauteurs de batiments, le relief et la vegetation lorsque ces donnees sont disponibles.
4. En cas de donnees insuffisantes, demander la validation ou la saisie manuelle de l'orientation, de la pente, de la surface et des obstacles.
5. Ne jamais afficher une valeur precise sans declarer le niveau de confiance et la source utilisee.

### Alternatives possibles

| Option | Apport | Limites | Usage recommande |
| --- | --- | --- | --- |
| Attributs de toiture OpenStreetMap | Gratuit, national, directement exploitable quand renseigne | Couverture et qualite heterogenes ; rarement suffisants pour les ombres | Premiere hypothese et validation visuelle |
| LiDAR ou modele numerique de surface ouvert | Permet de detecter pente, azimut, surfaces et masques proches | Volume de donnees, traitement geospatial complexe, couverture et date a verifier localement | Solution de reference ouverte pour les analyses qualifiees |
| Empreintes et hauteurs de batiments ouvertes, par exemple BD TOPO | Modele de voisinage et ombres des volumes batis | Ne decrit habituellement pas chaque pan ni les obstacles fins | Repli pour l'ombre urbaine, combine au LiDAR ou a la saisie |
| Orthophotos ouvertes et vision par ordinateur | Peut aider a detecter formes de toit, obstacles et panneaux existants | Inclinaison et hauteurs peu fiables sans elevation ; necessite une validation | Aide a la saisie, jamais source unique de calcul |
| Saisie manuelle guidee | Couvre tout le territoire et permet de traiter les cas incomplets | Dependance a la qualite de l'operateur | Repli obligatoire, avec photos et controles de coherence |
| Services commerciaux de donnees solaires ou 3D | Donnees et traitements potentiellement plus homogenes | Cout, licences, dependance fournisseur, couverture a confirmer | Comparatif ou solution de secours apres evaluation contractuelle |

### Regles de confiance

- Elevee : plans derives de donnees altimetriques recentes et valides, avec masques proches modelises.
- Moyenne : geometrique OSM ou modele de batiment valide, complete par une validation manuelle.
- Faible : empreinte seule, hypothese de pente ou obstacles non modelises.
- Non calculable : adresse ou donnees insuffisantes ; l'application demande alors une saisie ou refuse la pre-etude.

## 7. Plan de realisation

### Phase 1 - Cadrage metier

- Formaliser les indicateurs, unites, hypotheses et exclusions.
- Definir les niveaux de confiance et les messages de limitation.
- Valider les regles de surface installable : retraits de bord, lucarnes, acces, obstacles et zones interdites.
- Definir le contenu du rapport de pre-etude.

Livrable : specification fonctionnelle, modele de donnees et criteres d'acceptation.

### Phase 2 - Socle applicatif et geospatial

- Realise : projet Vite, verrouillage des dependances, build et tests unitaires du calcul solaire/geometrique.
- A realiser : lint, tests navigateur, CI et versionnement applicatif si le depot est initialise.
- Mettre en place l'API, PostgreSQL/PostGIS, les migrations et l'authentification.
- Modeliser analyse, adresse, batiment, toiture, obstacle, scenario, resultat et rapport.
- Creer les endpoints de lancement, suivi et consultation d'analyse.
- Installer la file de traitement et le suivi des erreurs.

Livrable : une analyse vide peut etre creee, suivie et historisee.

### Phase 3 - Analyse geometrique de toiture

- Realise : geocoder une adresse, identifier visuellement un batiment, calculer la surface de son empreinte et afficher ses facades.
- Recuperer et stocker les donnees OSM, d'empreinte et d'elevation necessaires, avec leurs metadonnees de licence et de version.
- Exploiter d'abord les attributs de toiture OSM, puis detecter les plans manquants depuis les donnees altimetriques disponibles.
- Calculer surface, azimut, pente et qualite geometrique pour chaque pan.
- Permettre la validation ou correction manuelle sur la carte.

Livrable : des pans de toiture selectionnables et corrigeables sont produits pour une adresse.

### Phase 4 - Ensoleillement et ombrage

- Realise : simulation instantanee de la position solaire et rendu visuel d'ombres uniformes pour la date et l'heure selectionnees.
- A realiser : simulation annuelle avec un pas temporel valide et stockage des resultats.
- Determiner les masques dus aux batiments, relief et vegetation selon les donnees disponibles ; ne pas utiliser le canvas OSMBuildings comme source de masque.
- Calculer les heures d'ensoleillement, les periodes d'ombre et la surface exposee de chaque pan.
- Stocker les resultats et leurs metadonnees de calcul.

Livrable : chaque pan affiche un resultat d'exposition explicable et un niveau de confiance.

### Phase 5 - Potentiel photovoltaique

- Integrer les donnees d'irradiation et les parametres du scenario.
- Calculer irradiation, pertes, puissance installable et production mensuelle/annuelle.
- Produire des scenarios prudent, nominal et optimise.
- Exposer les hypotheses de calcul dans le resultat et le rapport.

Livrable : une pre-etude complete est disponible pour une adresse.

### Phase 6 - Interface utilisateur

- Realise : migration de l'entree active vers MapLibre GL, carte 3D manipulable, recherche, geolocalisation, selection de batiment et edition manuelle des hypotheses.
- En cours : mode editeur 2D local, ouvert depuis la rose de facades, avec couche GeoJSON superposee et retour vers la carte 3D.
- Ajouter l'edition d'empreinte, les pans, marges, modules portrait/paysage, groupes au sol, annulation/refaire et sauvegarde locale versionnee.
- Conserver les scripts historiques hors de l'entree active, puis les archiver ou les supprimer apres validation.
- Ajouter la visualisation de pans reels, des exclusions et des niveaux de confiance.
- Afficher progression, resultats, hypothese, confiance et limites.
- Ajouter une page de rapport partageable puis un export PDF.

Livrable : parcours complet adresse vers pre-etude dans le navigateur.

### Phase 7 - Validation et mise en production

- Constituer un jeu de cas de reference avec mesures terrain et productions observees.
- Mesurer les erreurs de geometrie, d'ombrage et de production separement.
- Fixer les seuils de qualite avant ouverture a des utilisateurs externes.
- Mettre en place sauvegardes, monitoring, alertes, politique de confidentialite et gestion securisee des cles.

Livrable : service deployable, surveille et qualifie sur des cas de reference.

## 8. Criteres de fiabilite

- Chaque resultat indique la date, la version et la couverture des donnees utilisees.
- L'orientation, l'inclinaison et la surface peuvent etre controlees ou corrigees manuellement.
- Les obstacles non modelises sont explicitement identifies comme limites.
- Les resultats energetiques sont reproductibles avec les memes donnees et parametres.
- La precision est mesuree sur un jeu de reference avant toute promesse commerciale.
- Les resultats fondes sur une empreinte OSM seule sont limites a une estimation et ne peuvent pas etre qualifies de fiables.

## 9. Priorites immediates

1. Tester la disponibilite, resolution, fraicheur et licence des donnees altimetriques ouvertes pour un echantillon d'adresses, dont Bourges.
2. Construire un prototype serveur comparant attributs OSM, reconstruction altimetrique et saisie manuelle sur des toitures connues.
3. Remplacer l'ombre visuelle cliente par des masques geospatiaux reproductibles, en tenant compte du relief, du bati et de la vegetation.
4. Ajouter des tests navigateur pour le chargement des tuiles, la 3D, les clics sur petits batiments et les ombres.
5. Definir le niveau de precision attendu, les seuils de qualite mesurables et les regles d'affichage du niveau de confiance.
