# PROJECT HANDOFF

## 1. Objectif du projet

Helio Simulator est une application web de pre-etude photovoltaique. Elle affiche une carte 3D, permet de selectionner ou dessiner des batiments, configurer une toiture et des panneaux, puis estime l'exposition et la production solaire.

## 2. Stack et architecture

- Vite 8, JavaScript ES modules, HTML/CSS sans framework.
- MapLibre GL pour la carte, les batiments 3D et les couches GeoJSON.
- SunCalc pour les calculs solaires.
- Application essentiellement concentree dans `src/main.js`.
- Tests Node natifs sur le moteur de calcul pur dans `src/solar.test.js`.
- Pas de depot Git detecte.
- Base de production Vite : `/heliosim/`.

## 3. Fichiers importants

- `src/main.js` : interface, etat, carte MapLibre, edition des batiments/toitures/panneaux et couches de rendu.
- `src/solar.js` : fonctions de calcul solaire et geometrique pures.
- `src/solar.test.js` : 17 tests du moteur `solar.js`.
- `src/style.css` : styles de l'interface, header et panneau de simulation.
- `src/editor.css` : styles specifiques a l'editeur de batiment/toiture.
- `index.html` : titre de page, chargement de la police Caveat et point d'entree.
- `vite.config.js` : base `/heliosim/` et proxy WMS IGN.
- `README.md` : demarrage, architecture et URL de production.
- `DEPLOIEMENT_APACHE_NGINX.md` : configurations Nginx/Apache pour `/heliosim/`.
- `EVOLUTION_TOITURE_3D.md` : contexte de conception historique des toitures.

## 4. Etat actuel

- Le projet s'appelle desormais **Helio Simulator**.
- Le package npm est `helio-simulator`.
- La production est prevue pour `https://fcinc.fr/heliosim/`.
- Le header affiche `helio` dans sa police serif existante, suivi de `Simulator` en Caveat manuscrite doree.
- La police Caveat est chargee depuis Google Fonts dans `index.html`.
- Le titre navigateur est `Helio Simulator`.
- Le panneau lateral "Simulation solaire" est ferme par defaut.
- Le bouton du header qui l'ouvre affiche `+ Simulateur`.
- Le clic sur ce bouton utilise `togglePanel()` et bascule la classe CSS `is-closed`.
- Les 17 tests passaient apres la modification du panneau ferme par defaut.
- Un build Vite passait apres le renommage. Aucun build/test n'a ete relance apres le dernier changement uniquement textuel du bouton.

## 5. Decisions importantes

- Le rendu Three.js personnalise des toitures et panneaux a ete supprime integralement.
- La dependance `three` a ete retiree de `package.json`.
- Les variables, fonctions et couche MapLibre liees a `threeRoof*` ont ete supprimees de `src/main.js`.
- La couche native MapLibre `roof-overlays-3d` est donc de nouveau visible et constitue le rendu actuel des toitures.
- Les fonctions de calcul de toiture existantes ont ete conservees : `roofMetrics`, `roofHeightAt`, `effectiveRoofRing`, `configurationWallHeight`, ainsi que les fonctions d'edition 2D.
- Les cles `localStorage` existantes contenant `helio-...` ont ete volontairement conservees : elles portent des donnees utilisateur persistees et ne sont pas des chemins ou du branding visible.
- Les URLs WMS dans `main.js` utilisent `import.meta.env.BASE_URL`; elles suivent automatiquement `base: "/heliosim/"`.
- La configuration serveur et la documentation doivent toujours servir l'application sous `/heliosim/`, sans sous-chemin `/helio/`.

## 6. Travail en cours

Aucune implementation active au moment du handoff.

Le dernier changement effectue est textuel dans `src/main.js` :

- bouton `#toggle-panel` : `+ Simulateur`;
- panneau `#study-panel` : classe initiale `is-closed`;
- attribut initial `aria-expanded="false"` sur le bouton.

## 7. Problemes connus

- L'utilisateur a signale : "Les dimensions du batiment a Est-ouest sont fausses."
- Ce probleme a ete explore mais n'a pas ete corrige : la demande a ete interrompue par les changements de nom et d'interface.
- Les zones pertinentes a investiguer sont dans `src/main.js` :
  - `setCardinalEdgeLength(direction, valueCentimeters)`;
  - `syncCardinalEdgeLengths()`;
  - `cardinalEdges(ring)`;
  - `coordinateAlongBearing(...)`;
  - `rectangularRoofRing(...)`;
  - `effectiveRoofRing(...)`;
  - `roofMetrics(...)`.
- Les dimensions Nord/Sud/Est/Ouest sont presentees dans l'editeur sous forme de champs `edgeNorth`, `edgeSouth`, `edgeEast`, `edgeWest`, en centimetres.
- Les tests actuels ne couvrent pas cette modification d'emprise ni le rendu MapLibre UI.
- Le build affiche un avertissement Vite sur un bundle JavaScript superieur a 500 kB. Ce n'est pas bloquant.

## 8. Prochaines etapes

1. Reproduire precisement l'erreur Est/Ouest sur une empreinte selectionnee ou dessinee.
2. Tracer la conversion entre la facade cardinale identifiee et l'arete modifiee dans `setCardinalEdgeLength`.
3. Verifier la convention des bearings : degres dans le sens horaire depuis le nord.
4. Corriger la geometrie au niveau responsable, sans modifier les calculs solaires non concernes.
5. Ajouter des tests cibles dans `src/solar.test.js` si la logique peut etre isolee dans `solar.js`; sinon effectuer au minimum une verification manuelle de l'editeur.
6. Executer `npm test` et `npm run build`.

## 9. Contraintes a respecter

- Preserver la base de deploiement `/heliosim/` dans Vite, documentation et configuration serveur.
- Ne pas reintroduire Three.js ni le rendu custom Three.js sans une decision explicite.
- Conserver le rendu de toiture base sur les couches MapLibre actuelles.
- Preserver la compatibilite des donnees `localStorage` existantes, notamment les cles `helio-...`.
- Ne pas casser l'etat initial ferme du panneau solaire ni son accessibilite :
  - `#study-panel` commence avec `is-closed`;
  - `#toggle-panel` commence avec `aria-expanded="false"`;
  - `togglePanel()` est l'unique mecanisme de bascule.
- Le branding header doit garder `helio` en Georgia serif et `Simulator` en Caveat manuscrite.
- Le projet utilise principalement de l'ASCII dans les fichiers.
- Les modifications doivent rester minimales et etre validees avec le plus petit test suffisant.

## 10. Informations essentielles provenant de la conversation

- La suppression du rendu Three.js etait une decision volontaire apres des problemes majeurs : toiture non alignee au batiment, formes anormales, panneaux incoherents et volumes ouverts.
- Avant sa suppression, la cause principale identifiee etait l'ecart entre `effectiveRoofRing()` et l'empreinte brute du batiment, ainsi que l'absence de prise en compte de `minHeight` dans le mesh Three.js. Cette analyse est historique : le code concerne n'existe plus.
- Les utilisateurs attendent un fonctionnement visuel fiable en priorite, particulierement pour l'emprise du batiment et les dimensions cardinales.
