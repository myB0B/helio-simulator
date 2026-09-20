# Deploiement public Helio Simulator

## Cible

- URL publique : `https://fcinc.fr/heliosim/`
- Build : `npm run build`
- Fichiers a publier : contenu du dossier `dist/`

Le parametre Vite `base: "/heliosim/"` est obligatoire : il genere les URL des scripts et feuilles de style sous `/heliosim/assets/`.

## Configuration recommandee : Nginx sert Helio Simulator directement

Nginx est deja en frontal. Il doit servir les fichiers statiques de Helio Simulator sans les transmettre a Apache. Copier le contenu de `dist/` vers, par exemple, `/var/www/fcinc/heliosim/dist/`, puis ajouter cette configuration dans le bloc `server` de `fcinc.fr` :

```nginx
location = /heliosim {
    return 301 /heliosim/;
}

location = /heliosim/geopf-wms {
    proxy_pass https://data.geopf.fr/wms-r/wms$is_args$args;
    proxy_set_header Host data.geopf.fr;
}

location /heliosim/ {
    alias /var/www/fcinc/heliosim/dist/;
    try_files $uri $uri/ /heliosim/index.html;
}

location ^~ /heliosim/assets/ {
    alias /var/www/fcinc/heliosim/dist/assets/;
    add_header Cache-Control "public, max-age=31536000, immutable";
}
```

Le premier bloc force le slash final. Le `try_files` permet de charger `index.html` pour une URL interne de l'application. Les fichiers places dans `assets/` sont versionnes par hash et peuvent etre caches un an.

Valider puis recharger Nginx :

```sh
nginx -t
systemctl reload nginx
```

Apache continue de recevoir les autres routes deja proxifiees par Nginx, mais Helio Simulator ne depend pas de lui.

## Alternative : Nginx relaie Helio Simulator vers Apache

Cette option est moins efficace pour du statique, mais permet de conserver un seul point de publication Apache.

Configuration Nginx dans le bloc `server` :

```nginx
location = /heliosim {
    return 301 /heliosim/;
}

location = /heliosim/geopf-wms {
    proxy_pass https://data.geopf.fr/wms-r/wms$is_args$args;
    proxy_set_header Host data.geopf.fr;
}

location /heliosim/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Configuration Apache, avec `mod_alias` et `mod_dir` actifs :

```apache
Alias /heliosim/ /var/www/fcinc/heliosim/dist/

<Directory /var/www/fcinc/heliosim/dist>
    Options -Indexes
    Require all granted
    FallbackResource /heliosim/index.html
</Directory>
```

Activer `mod_remoteip` et configurer `RemoteIPHeader X-Forwarded-For` au niveau Apache si les journaux ou limitations Apache doivent utiliser l'adresse reelle du visiteur.

## Build et publication

Sur une machine de build de confiance, avec la variable `VITE_CARTO_API_KEY` configuree :

```sh
npm ci
npm test
npm run build
```

Ne pas publier `.env`, le code source ou `node_modules`. La variable `VITE_CARTO_API_KEY` est integree au JavaScript genere : elle doit etre une cle CARTO publique limitee a `https://fcinc.fr` et aux droits de tuiles strictement necessaires.

## Charge et services tiers

Helio Simulator est actuellement une application statique sans session, base de donnees ou calcul serveur. Plusieurs visiteurs peuvent donc l'utiliser en parallele ; la capacite depend surtout de Nginx, du reseau et des quotas de CARTO, OpenFreeMap et Nominatim.

- CARTO : restreindre la cle au domaine et surveiller quota et erreurs.
- OpenFreeMap : les tuiles vectorielles sont chargees directement par les navigateurs.
- Nominatim public : eviter une forte charge commerciale. Pour un trafic consequent, utiliser un fournisseur de geocodage contractuel ou un proxy applicatif avec cache.
- Les calculs de pre-etude restent locaux au navigateur et ne sont ni historises ni partages entre visiteurs.

Ne pas utiliser `vite preview` comme serveur public.
