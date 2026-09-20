# Mission OpenCode --- Rendu 3D bâtiment, toiture et panneaux solaires dans MapLibre GL

## 1. Objectif

L'application possède déjà un éditeur 2D fonctionnel permettant de
définir un projet photovoltaïque.

Après validation dans l'éditeur 2D, je veux afficher sur la carte
MapLibre GL une représentation 3D simple et fiable comprenant :

-   les murs du bâtiment ;
-   la toiture réellement inclinée ;
-   les panneaux photovoltaïques aux emplacements définis en 2D ;
-   les couleurs déjà définies dans l'éditeur.

Le rendu n'a pas besoin d'être photoréaliste. La priorité est la
fidélité géométrique, la stabilité dans MapLibre et la simplicité.

## 2. Règle fondamentale : l'éditeur 2D est la source de vérité

La 3D ne doit prendre aucune nouvelle décision métier.

Les données suivantes existent déjà dans l'éditeur et doivent être
réutilisées :

-   contour et/ou dimensions du bâtiment ;
-   hauteur TOTALE du bâtiment ;
-   inclinaison/pente du toit ;
-   orientation du toit ;
-   direction/sens des pentes ;
-   couleurs ;
-   position, nombre, dimensions, orientation, espacement et marges des
    panneaux.

Ne pas recalculer le calepinage des panneaux. Ne pas créer un modèle
`Project3D` dupliquant le modèle existant.

Pipeline attendu :

    Project existant
      ├─> éditeur 2D
      └─> generateSolarProjectMesh(Project)
              └─> CustomLayer MapLibre

La 3D est uniquement une projection géométrique du projet 2D validé.

## 3. Commencer impérativement par analyser le projet

Avant d'écrire du code :

1.  Inspecter la structure du projet.
2.  Identifier où MapLibre GL est initialisé.
3.  Identifier l'éditeur 2D et son modèle de données.
4.  Trouver les propriétés réelles correspondant à :
    -   hauteur totale ;
    -   pente et son unité ;
    -   orientation du toit ;
    -   sens/direction des pentes ;
    -   géométrie des pans si elle existe ;
    -   couleurs ;
    -   panneaux ;
    -   géolocalisation du projet.
5.  Déterminer le repère utilisé par l'éditeur 2D.
6.  Vérifier les conventions d'angles :
    -   origine de 0° ;
    -   sens horaire/antihoraire ;
    -   angle relatif au bâtiment ou au nord.
7.  Présenter avant implémentation :
    -   les fichiers concernés ;
    -   le modèle de données trouvé ;
    -   le système de coordonnées ;
    -   les informations éventuellement manquantes ;
    -   le plan minimal de modifications.

Ne suppose pas la structure des données et ne crée pas de propriétés
fictives pour contourner une donnée introuvable.

## 4. Technologie imposée

Ne pas utiliser :

-   Three.js ;
-   React Three Fiber ;
-   Babylon.js ;
-   Cesium ;
-   glTF ;
-   3D Tiles ;
-   un canvas WebGL séparé.

Utiliser directement une `CustomLayerInterface` MapLibre :

    type: "custom"
    renderingMode: "3d"

avec le contexte WebGL fourni par MapLibre et son depth buffer.

Ne pas utiliser `fill-extrusion` pour simuler un toit incliné.

## 5. Architecture

Séparer strictement la géométrie métier du rendu MapLibre.

Organisation indicative, à adapter au projet :

    solar3d/
      geometry/
        types.ts
        walls.ts
        roof.ts
        panels.ts
        mesh.ts
      maplibre/
        SolarProject3DLayer.ts

Le moteur géométrique ne doit pas dépendre de MapLibre.

Il travaille dans un repère local en mètres :

    X = axe horizontal local
    Y = axe horizontal local
    Z = vertical / hauteur

Centraliser dans une seule fonction la conversion entre le repère de
l'éditeur et le repère utilisé pour MapLibre/WebGL. Ne pas disperser des
`-1`, `+90`, `360-angle`, etc.

## 6. Mesh

Utiliser une structure similaire à :

    interface MeshData {
      positions: Float32Array;
      normals: Float32Array;
      colors: Float32Array;
      indices: Uint32Array;
    }

Les coordonnées sont en mètres dans le repère local.

Fusionner autant que possible murs, toit et panneaux dans un nombre
minimal de buffers et de draw calls. Ne pas créer un objet WebGL par
panneau.

## 7. Hauteur totale et hauteur des murs

IMPORTANT : la hauteur présente dans l'éditeur est la hauteur TOTALE du
bâtiment, du sol jusqu'au point le plus haut de la toiture.

La hauteur des murs n'est PAS une entrée.

Elle doit être calculée automatiquement.

Pour un pan de portée horizontale `run` :

    rise = run * tan(pitchRadians)

Pour un toit symétrique à deux pans :

    roofHeight = halfSpan * tan(pitchRadians)
    wallHeight = totalBuildingHeight - roofHeight

Invariant obligatoire :

    wallHeight + roofHeight = totalBuildingHeight

Le faîtage doit toujours être exactement à :

    Z = totalBuildingHeight

Si la pente augmente à hauteur totale constante, la hauteur des murs
diminue.

Si `wallHeight < 0`, signaler une configuration géométriquement
impossible. Ne pas masquer silencieusement le problème avec
`Math.max()`.

## 8. Ne pas supposer que la pente suit width ou depth

L'éditeur possède déjà l'orientation du toit et la direction des pentes.

Ne pas écrire une logique fragile basée uniquement sur `width` et
`depth`.

Utiliser des vecteurs et des projections.

À partir d'une direction de pente normalisée :

    slopeDir = { x, y }

projection d'un point :

    projection = x * slopeDir.x + y * slopeDir.y

La portée horizontale d'un pan peut être déterminée à partir des
projections pertinentes :

    run = maxProjection - minProjection

Puis :

    rise = run * tan(pitchRadians)

Une toiture orientée à 0°, 37°, 90°, 137° ou 270° doit fonctionner sans
cas spécial lié à l'angle.

## 9. Orientation et conventions

Inspecter d'abord les conventions existantes.

Si nécessaire, créer une seule conversion, par exemple :

    editorAngleToLocalDirection(angle): Vec2

Ne jamais supposer arbitrairement que 0° = nord ou que les angles sont
horaires sans vérifier le code existant.

L'orientation doit rester correcte lors du placement géographique sur
MapLibre.

## 10. Toiture

Si l'éditeur possède déjà les polygones des pans de toiture, LES
UTILISER DIRECTEMENT.

C'est préférable à reconstruire ou deviner la toiture depuis le
footprint.

Ne pas tenter initialement de résoudre automatiquement toutes les formes
architecturales possibles.

Implémenter correctement les formes réellement produites par l'éditeur
actuel.

La géométrie du toit doit être réellement inclinée en 3D : pas de
texture ou d'effet visuel simulant la pente.

## 11. Fonction centrale de surface du toit

Créer une abstraction unique et testable, par exemple :

    getRoofSurfacePoint(
      point2D: Vec2,
      roofPlane: RoofPlane
    ): {
      position: Vec3;
      normal: Vec3;
    }

Elle calcule la position 3D à partir de :

-   la position 2D ;
-   la direction de pente ;
-   l'inclinaison ;
-   le pan concerné ;
-   la position du faîtage/point haut ;
-   la hauteur totale.

Le mesh du toit ET les panneaux doivent utiliser la même définition
mathématique.

## 12. Murs

À partir du footprint et de la hauteur de murs calculée, pour chaque
segment A-B créer :

    A_bas
    B_bas
    B_haut
    A_haut

puis deux triangles :

    A_bas, B_bas, B_haut
    A_bas, B_haut, A_haut

Calculer les normales horizontales correctement.

## 13. Panneaux photovoltaïques

Ne jamais recalculer :

-   leur nombre ;
-   leur placement ;
-   leurs marges ;
-   leur espacement ;
-   leurs dimensions ;
-   leur orientation.

Utiliser exactement le résultat validé par l'éditeur 2D.

Pour chaque panneau, récupérer ses quatre coins 2D et appeler
`getRoofSurfacePoint()` pour chaque coin.

Le panneau doit suivre exactement la surface inclinée.

Ajouter un petit offset, par exemple 0,03 à 0,05 m, appliqué SELON LA
NORMALE du toit :

    finalPosition = roofPosition + roofNormal * panelOffset

Cela évite le Z-fighting.

Pour la première version, chaque panneau peut être un rectangle de deux
triangles. Une petite épaisseur (par exemple 0,04 m) peut être ajoutée
seulement après validation du rendu simple.

## 14. Normales

Calculer de vraies normales :

-   murs : normales horizontales ;
-   pans de toit : normales correspondant à leur pente et direction ;
-   panneaux : normales correspondant à leur plan.

Ne pas utiliser `(0, 0, 1)` pour une toiture inclinée.

Les normales servent à l'éclairage et à l'offset des panneaux.

## 15. Couleurs

Les couleurs existent déjà dans l'éditeur 2D.

Ne pas créer une seconde configuration métier de couleurs spécifique à
la 3D.

Réutiliser les valeurs existantes et créer uniquement une conversion
technique vers `[r,g,b,a]` si WebGL l'exige.

Le bâtiment, le toit et les panneaux doivent afficher les couleurs
choisies par l'utilisateur.

## 16. Coordonnées MapLibre

La géométrie métier reste en mètres.

La CustomLayer reçoit l'origine géographique du projet et utilise les
mécanismes MapLibre appropriés, notamment
`MercatorCoordinate.fromLngLat()` et `meterInMercatorCoordinateUnits()`,
pour placer et dimensionner le modèle.

Pipeline :

    coordonnées éditeur 2D
      -> coordonnées locales en mètres
      -> mesh 3D local
      -> transformation géographique MapLibre
      -> rendu

Ne pas stocker les vertices métier directement en longitude/latitude.

## 17. CustomLayer MapLibre

Créer une classe propre, par exemple `SolarProject3DLayer`, avec :

    onAdd()
    render()
    onRemove()

et une API de mise à jour telle que :

    setProject(project)

ou :

    updateMesh(mesh)

Gérer correctement :

-   compilation et suppression des shaders ;
-   création/suppression des buffers ;
-   index buffer ;
-   depth testing ;
-   matrice MapLibre ;
-   mise à jour du mesh ;
-   libération des ressources WebGL.

La 3D doit rester attachée au bon emplacement lors de zoom, pitch,
bearing et déplacement de la carte.

## 18. Shaders

Utiliser des shaders simples.

Vertex shader :

-   position ;
-   normale ;
-   couleur ;
-   transformation MapLibre.

Fragment shader :

-   couleur ;
-   lumière ambiante ;
-   lumière directionnelle simple basée sur la normale.

Pas de PBR, textures ou ombres dynamiques dans la première version.

## 19. Ordre d'implémentation obligatoire

Ne pas tout coder d'un coup.

### Étape 1

Afficher un triangle avec la CustomLayer et valider position, matrice et
profondeur.

### Étape 2

Afficher un parallélépipède simple et vérifier l'échelle réelle en
mètres.

### Étape 3

Brancher la géométrie réelle des murs.

### Étape 4

Ajouter la toiture inclinée et valider mathématiquement sa hauteur.

Tester plusieurs pentes, notamment 0°, 15°, 30° et 45°.

### Étape 5

Afficher UN panneau réel provenant de l'éditeur 2D.

Vérifier position, orientation, pente et offset.

### Étape 6

Afficher tous les panneaux réels sans recalculer leur disposition.

### Étape 7

Ajouter couleurs, normales et éclairage.

### Étape 8

Optimiser les buffers/draw calls seulement lorsque le comportement est
correct.

Après chaque étape importante, exécuter les tests, le typecheck et le
build disponibles et corriger les erreurs avant de poursuivre.

## 20. Tests géométriques obligatoires

Les tests du moteur géométrique ne doivent pas nécessiter MapLibre.

Créer notamment :

    calculateRoofHeight(run, pitchDegrees)
    calculateWallHeight(totalHeight, roofHeight)
    getRoofSurfacePoint(...)

Exemple :

    totalHeight = 7
    span = 8
    pitch = 30°

Pour un toit symétrique :

    halfSpan = 4
    roofHeight ≈ 2.309
    wallHeight ≈ 4.691
    ridgeZ = 7

Pour :

    totalHeight = 7
    span = 8
    pitch = 45°

attendre :

    roofHeight = 4
    wallHeight = 3
    ridgeZ = 7

Toujours vérifier à la tolérance numérique :

    wallHeight + roofHeight ≈ totalHeight

Tester aussi les orientations 0°, 45°, 90°, 180° et 270° : dimensions,
pente, hauteur totale et disposition relative des panneaux ne doivent
pas être altérées par une rotation.

Tester qu'un panneau posé sur un pan conserve sa géométrie et reste
parallèle au toit.

## 21. Debug visuel

Prévoir temporairement un mode `debug: true` pouvant afficher ou aider à
diagnostiquer :

-   origine locale ;
-   axes X/Y/Z ;
-   faîtage ;
-   sens des pentes ;
-   normales principales.

Ne pas corriger les erreurs d'orientation par rotations arbitraires
jusqu'à ce que le rendu "semble bon". Identifier et corriger la
transformation mathématique.

## 22. Ce qu'il ne faut pas faire

Ne pas :

-   modifier ou remplacer inutilement l'éditeur 2D ;
-   refaire le placement photovoltaïque ;
-   dupliquer les données métier dans un modèle 3D ;
-   deviner orientation ou pente déjà présentes ;
-   utiliser Three.js ou un autre moteur 3D ;
-   utiliser glTF ou 3D Tiles ;
-   utiliser `fill-extrusion` pour le toit ;
-   simuler la pente par texture ;
-   créer une scène/caméra indépendante de MapLibre ;
-   créer un objet WebGL par panneau ;
-   ajouter une grosse dépendance sans nécessité ;
-   coder des corrections d'axes dispersées ;
-   masquer les configurations géométriques impossibles.

## 23. Critères d'acceptation

La tâche est terminée seulement si :

1.  le bâtiment est au bon emplacement géographique ;
2.  ses dimensions correspondent aux données 2D ;
3.  sa hauteur totale correspond exactement à celle définie dans
    l'éditeur ;
4.  la hauteur des murs est automatiquement déduite de la pente et de la
    hauteur totale ;
5.  le toit est réellement incliné ;
6.  l'orientation et le sens des pentes correspondent à l'éditeur ;
7.  modifier la pente conserve la hauteur totale et modifie correctement
    la hauteur des murs ;
8.  les panneaux sont exactement aux positions définies en 2D ;
9.  les panneaux suivent correctement leur pan de toiture ;
10. les panneaux ne présentent pas de Z-fighting ;
11. les couleurs correspondent à celles de l'éditeur ;
12. le modèle reste stable lors de zoom, rotation, pitch et déplacement
    MapLibre ;
13. la géométrie est testée indépendamment de MapLibre ;
14. aucune dépendance Three.js n'est nécessaire.

## 24. Consigne finale à l'agent

Ne commence pas par produire une grosse implémentation supposant le
modèle de données.

Commence par inspecter le repository et réponds avec :

1.  les fichiers concernés ;
2.  la structure exacte des données du projet ;
3.  les propriétés existantes correspondant au bâtiment, toit, pente,
    orientation, sens des pentes, hauteur, couleurs et panneaux ;
4.  les conventions de coordonnées et d'angles ;
5.  ce qui est directement réutilisable ;
6.  ce qui manque réellement, le cas échéant ;
7.  un plan d'implémentation minimal par étapes.

Ensuite implémente progressivement.

À chaque étape, privilégie la correction géométrique et la réutilisation
des données existantes plutôt qu'une abstraction prématurée.

La règle à conserver pendant toute l'implémentation est :

    ÉDITEUR 2D = SOURCE DE VÉRITÉ
    3D = VISUALISATION DÉTERMINISTE DES DONNÉES 2D
