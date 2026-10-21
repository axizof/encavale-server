# En Cavale — serveur multijoueur

Le serveur multijoueur du jeu **En Cavale**, à héberger soi-même, comme un serveur Minecraft : sur ton PC, un PC du salon ou un VPS. Il n'y a ni classement global ni compte obligatoire. Chaque serveur a son salon, ses manches et son meilleur score.

- Jusqu'à **20 joueurs** : des fuyards, des flics joueurs et, si tu veux, la police IA du jeu solo en renfort.
- Des **préréglages** pour répartir les rôles automatiquement, et un mode **personnalisé**.
- Un **chat** avec anti-flood, et la possibilité de masquer les messages de quelqu'un.
- Pour l'hôte, depuis son **terminal** ou son **panneau web** : **mot de passe**, **accord de l'hôte** pour chaque arrivée, **expulsion**, **bannissement**, réglages et lancement des manches. Il peut aussi nommer des **admins en jeu**, uniquement des comptes Discord vérifiés : pas de code à deviner.
- Le **serveur fait foi** : la vie, les morts, les arrestations, les scores et les positions impossibles sont vérifiés côté serveur.
- **Circulation civile partagée**, simulée par le serveur : tout le monde voit les mêmes voitures, et seulement autour des joueurs.
- **Police IA** au choix de l'hôte : calculée par le joueur poursuivi (réactive) ou par le serveur (anti-triche).
- **Panneau admin web** protégé par mot de passe, accessible seulement depuis le PC du serveur par défaut : réglages de la partie, manches, demandes d'entrée, joueurs, statistiques avec historique, journal.
- **Objectifs gérés par le serveur** : chaque fuyard a son braquage et son receleur, les flics les voient sur la carte, et de temps en temps un **gros coup** commun (butin ×3) est raflé par le premier qui le braque. Les **réparations** sont communes, et leur nombre suit le nombre de fuyards encore en jeu.
- **Mouvement fluide** des autres voitures (positions datées, interpolation en courbe) et **chocs réalistes** entre joueurs : chacun garde sa masse.
- **Spectateur** : ◀ ▶ ou clic sur un pseudo pour suivre qui on veut. **Option** : un fuyard éliminé peut rejoindre la police.

## Sommaire
1. [Lancer un serveur](#1-lancer-un-serveur)
2. [Ouvrir le serveur aux joueurs](#2-ouvrir-le-serveur-aux-joueurs)
3. [Rejoindre](#3-rejoindre)
4. [Configuration (config.json)](#4-configuration-configjson)
5. [Administrer (terminal et panneau web)](#5-administrer)
6. [Les parties](#6-les-parties)
7. [Sécurité et anti-triche](#7-sécurité-et-anti-triche)
8. [Héberger sur un VPS Linux](#8-héberger-sur-un-vps-linux)
9. [Développement](#9-développement)

---

## 1. Lancer un serveur

Télécharge l'archive de ton système dans les [**Releases**](../../releases) :

| Système | Archive |
|---|---|
| Windows | `encavale-server-X.Y.Z-windows-x64.zip` |
| Mac Apple Silicon (M1, M2…) | `encavale-server-X.Y.Z-macos-arm64.tar.gz` |
| Mac Intel | `encavale-server-X.Y.Z-macos-x64.tar.gz` |
| Linux / VPS | `encavale-server-X.Y.Z-linux-x64.tar.gz` (ou `linux-arm64`) |

Décompresse-la dans un dossier à toi, puis lance l'exécutable :

- **Windows** : double-clic sur `encavale-server-….exe`. Si SmartScreen s'affiche, clique sur « Informations complémentaires », puis « Exécuter quand même ». Le pare-feu Windows te demande l'accès réseau : accepte.
- **Mac** : ouvre un Terminal dans le dossier et tape `./encavale-server-…`. Si macOS dit que le fichier est « endommagé » ou vient d'un « développeur non identifié », c'est normal (exécutable non signé par Apple) : tape d'abord `xattr -dr com.apple.quarantine .` dans le dossier.
- **Linux** : `./encavale-server-…`.

Au premier lancement, le serveur crée **`config.json`** à côté de l'exécutable, puis affiche les adresses où le rejoindre et le **mot de passe du panneau admin** :

```
  EN CAVALE — serveur multijoueur v1.3.0 (protocole 3)
  Sur ce PC    : http://localhost:7777
  Réseau local : http://192.168.1.20:7777
  Internet     : http://TON-IP-PUBLIQUE:7777  (ouvre/redirige le port 7777 TCP sur ta box ou ton VPS)
  Panneau web  : http://localhost:7777/admin  mot de passe : Xy7…  (seulement depuis ce PC)
```

Pour choisir le port sans toucher au fichier : `./encavale-server --port 8080`.

## 2. Ouvrir le serveur aux joueurs

- **Même réseau** (même box, même Wi-Fi) : les joueurs utilisent l'adresse « Réseau local ». Il n'y a rien à configurer.
- **Par Internet** : il faut ouvrir le port sur ta box. Le nom de l'option varie selon la box : « redirection de port », « NAT/PAT » ou « translation de ports ».
  - Protocole **TCP**, port externe **7777**, port interne **7777**, vers l'adresse locale du PC qui fait tourner le serveur (par exemple `192.168.1.20`).
  - Ton adresse publique s'affiche sur https://ifconfig.me. C'est elle que tu donnes aux joueurs : `http://TON-IP:7777`.
  - Sur un VPS, ouvre le port dans le pare-feu, par exemple `sudo ufw allow 7777/tcp`.

Le serveur **sert le jeu lui-même**. Les joueurs n'ont rien à installer : la page `http://IP:port` est le jeu, déjà connecté au serveur. Il y a une raison à ça : les navigateurs interdisent à une page en `https` de se connecter à un serveur de jeu en `ws://` (contenu mixte). En passant par la page du serveur, la page et le serveur ont la même adresse, et ce blocage disparaît.

## 3. Rejoindre

- Depuis **le site du jeu** : bouton **MULTIJOUEUR**, puis entre l'adresse (`82.64.12.34:7777`). Les serveurs sont gardés en favoris. Un joueur connecté avec Discord sur le site garde son nom et son avatar : le site lui donne un ticket signé, valable 10 minutes et pour ce serveur uniquement.
- Directement : ouvre `http://IP:port` dans le navigateur. Le joueur arrive en invité et choisit un pseudo de 3 à 16 caractères.

## 4. Configuration (config.json)

| Clé | Par défaut | Rôle |
|---|---|---|
| `name` | `Serveur En Cavale` | Nom affiché aux joueurs. |
| `port` | `7777` | Port TCP (la page du jeu et le WebSocket passent par le même). |
| `password` | `""` | Mot de passe pour entrer (vide = serveur ouvert). |
| `maxPlayers` | `12` | De 2 à 20. |
| `joinApproval` | `false` | `true` : chaque arrivée doit être acceptée par l'hôte (dans le terminal : `accepter n°`, ou dans le panneau web). |
| `motd` | message de bienvenue | Message affiché à l'arrivée. |
| `panelPassword` | aléatoire | Mot de passe du **panneau admin web** (`http://localhost:port/admin`). Il s'affiche au démarrage. |
| `panelRemote` | `false` | `false` : le panneau ne répond qu'au PC du serveur. `true` : aussi depuis le réseau (le mot de passe passe alors en clair, voir plus bas). |
| `admins` | `[]` | Identifiants Discord des **admins en jeu** (rempli par la commande `admin <joueur>` ou le panneau). |
| `publicHost` | `[]` | Seulement derrière un reverse proxy : adresses publiques du serveur, pour accepter les tickets Discord. |
| `settings` | — | Derniers réglages de partie (mis à jour par le serveur). |

Relance le serveur après avoir modifié le fichier. Les bannissements sont dans **`bans.json`**, au même endroit.

## 5. Administrer

L'hôte administre son serveur depuis **le terminal du serveur** et **le panneau web**. Il n'y a **pas de code admin** à taper dans le chat, qu'un joueur pourrait récupérer.

**Admins en jeu** : l'hôte peut donner les commandes à des joueurs de confiance, **seulement s'ils sont connectés avec Discord** (passés par le site). Leur identité est garantie par le ticket signé du site : personne ne peut se faire passer pour eux. Pour en nommer un : `admin <joueur>` dans le terminal, ou le bouton **☆ Admin** du panneau. On peut aussi ajouter un identifiant Discord directement (`admin+ 123…`, ou le champ du panneau). Un admin en jeu peut :
- régler la partie depuis le salon, **lancer** et **arrêter** une manche (aussi depuis le menu Échap en pleine partie) ;
- accepter ou refuser les **demandes d'entrée** (il les reçoit en notification, sans les adresses IP) ;
- forcer le rôle d'un joueur, lui couper le chat, l'**expulser** ou le **bannir**, sauf un autre admin.

Mots de passe, liste des admins et bannis restent réservés à l'hôte. Les autres joueurs voient les réglages en lecture seule et choisissent leur rôle préféré et leur voiture de flic.

**Panneau admin web** : `http://localhost:port/admin`, sur le PC du serveur, protégé par le mot de passe `panelPassword` (affiché au démarrage, modifiable avec `panneau NOUVEAU-MDP`). On y trouve :
- la **partie** : mode de jeu, puis les réglages rangés par thème (police, règles, ambiance), avec un résumé de la répartition des rôles et un gros bouton **Lancer** / **Arrêter la manche** ;
- les **demandes d'entrée** (si l'accord de l'hôte est activé), avec Accepter et Refuser ;
- les **joueurs** : rôle, état, rôle souhaité (modifiable), score, ping, IP, et les boutons admin, couper le chat, expulser, bannir ; une annonce dans le chat ;
- les **accès** : accord de l'hôte, mot de passe du serveur, admins en jeu, bannis (avec débannir) ;
- les **statistiques** : processeur, mémoire, temps de calcul, latence, réseau, voitures, en direct et sur 5 min, 1 h ou 24 h ;
- le **journal** du serveur.

La session dure 12 h (cookie HttpOnly). Après 5 mauvais mots de passe, l'IP est bloquée 5 minutes. Par défaut le panneau ne répond **qu'au PC du serveur** : depuis une autre machine, il refuse l'accès.

Pour administrer un serveur hébergé sur un VPS :
- **le plus sûr** : un tunnel SSH, `ssh -L 7777:localhost:7777 ton-vps`, puis `http://localhost:7777/admin` sur ton PC ;
- **sinon** : `"panelRemote": true` dans `config.json`. ⚠️ Le serveur est en `http`, le mot de passe passe alors **en clair** sur le réseau.

Une manche se termine quand tous les fuyards sont tombés, à la fin du temps, ou quand l'hôte l'arrête. Le classement de la manche s'affiche, puis tout le monde **revient au salon et y reste** jusqu'à ce que l'hôte relance.

**Dans le terminal du serveur** (tape `aide`) :

```
joueurs                  liste (rôle, ping, IP)
lancer / stop            lancer / arrêter une manche
preset <nom>             classique, renfort, equipes, chasse, perso
set bots normal          bots (off|normal|renforce), herses (off|rare|normal|beaucoup),
                         flics (nombre), temps (minutes, 0 = illimité),
                         meteo (dynamic|clear|rain|fog|storm), heure (day|sunset|night),
                         circulation (off|light|normal|dense), police (client|server),
                         renfort (on|off : un fuyard éliminé peut rejoindre la police),
                         groscoups (on|off : braquages communs à tous les fuyards)
kick <joueur> [raison]   ban <joueur> [raison]   bans   unban <n°|nom>
admin <joueur>           donner / retirer les commandes en jeu (compte Discord)
admins                   liste ; admin+ <id Discord> / admin- <id Discord>
muet <joueur>            role <joueur> <any|fugitive|cop|spectate>   dire <message>
accepter <n°> / refuser <n°>     approbation on|off     motdepasse <mdp|off>
stats                    processeur, mémoire, réseau, voitures (moyennes 1 min / 1 h)
panneau [mdp]            afficher / changer le mot de passe du panneau web
infos                    quitter
```

## 6. Les parties

**Préréglages :**

| Préréglage | Répartition | Police IA | Herses | Durée |
|---|---|---|---|---|
| Classique | tout le monde fuit | normale | — | illimitée |
| Flics + IA | 1 joueur sur 3 en flic | normale | rares | 10 min |
| Gendarmes et voleurs | moitié flics, moitié fuyards | aucune | rares | 8 min |
| Chasse à l'homme | 1 fuyard contre tous | aucune | normales | 5 min |
| Personnalisé | nombre de flics au choix | au choix | au choix | au choix |

Chaque joueur indique sa préférence au salon (peu importe, fuyard, flic ou spectateur). Le serveur en tient compte pour répartir les rôles.

- **Circulation** (Aucune, Légère, Normale ou Dense) : elle est simulée par le serveur avec la même physique et la même IA que le jeu solo. Tout le monde voit les mêmes voitures civiles, au même endroit, et un accident est le même pour tous. Les voitures n'existent qu'autour des joueurs : elles apparaissent hors de leur vue et disparaissent quand plus personne n'est à proximité. Là où il n'y a personne, rien n'est calculé.
- **Police IA, deux modes** :
  - *Réactive* (par défaut) : le PC du fuyard poursuivi fait rouler sa police et l'envoie aux autres. C'est parfaitement fluide pour lui. Si sa connexion est mauvaise, les autres le voient saccader, lui et sa police, mais ensemble et de façon cohérente.
  - *Serveur* : le serveur fait rouler la police, gère les étoiles, les barrages et les herses. Impossible à tricher, mais avec une mauvaise connexion le fuyard voit ses poursuivants avec un léger décalage.
- **Fuyards** : la partie solo (braquages, livraisons, défis), en survivant. Les **objectifs** sont tirés et validés par le serveur (s'il a son moteur de simulation) : chaque fuyard a **son** braquage puis **son** receleur, avec un chrono. Les flics les voient sur la carte (carré : braquage, losange : receleur) et dans leur panneau de mission. Toutes les 2 à 4 minutes, s'il y a de la concurrence (2 fuyards, ou des flics joueurs), un **gros coup** commun apparaît pour tout le monde (balise violette) : le premier fuyard qui le braque rafle un butin **×3**, et tous le savent. Les **réparations** (bulles vertes) sont communes : une pour deux fuyards encore en jeu (de 1 à 6), le premier qui passe dessus la prend. S'ils sont détruits ou arrêtés, ils passent **spectateurs** jusqu'à la manche suivante : barre ◀ pseudo ▶ (ou ← →) et liste des joueurs cliquable pour suivre qui on veut. Si l'hôte active l'option « **un fuyard éliminé peut rejoindre la police** », un bouton **REJOINDRE LA POLICE** le remet en jeu en voiture de flic 8 s plus tard. Avec la police IA, chaque fuyard a ses propres poursuivants : la police se divise. Plus il y a de fuyards, plus elle est nombreuse et agressive.
- **Flics joueurs** : il faut détruire les fuyards (les chocs comptent) ou les **arrêter** (fuyard immobilisé, flic collé à lui pendant 3 s). Un flic détruit repart **40 s** plus tard, assez loin des fuyards. La radio donne la position de tous les fuyards toutes les 8 s.
- **Voitures de flic** : moins il y a de flics par rapport aux fuyards, plus elles sont fortes. Peu de flics : Intercepteur, SUV ou Berline. Autant de flics que de fuyards : SUV ou Berline. Beaucoup de flics : Berline seulement.
- **Apparitions** : les voitures civiles, les renforts et les barrages de police n'apparaissent jamais sous les yeux d'un joueur, quel qu'il soit (pas seulement le fuyard poursuivi).
- **Herses** (touche **F**) : en nombre limité, elles se rechargent avec le temps, et plus lentement quand il y a beaucoup de flics. Deux au maximum posées en même temps par flic, pendant 30 s.
- **Fin de manche** : quand tous les fuyards sont tombés (victoire des flics) ou à la fin du temps (les survivants gagnent, avec un bonus). Le classement de la manche s'affiche, puis tout le monde revient au salon. Le **meilleur score du serveur** est gardé tant qu'il tourne.

Touches du multijoueur : **T** ou **Entrée** pour écrire, **K** pour masquer le chat, **L** pour la liste des joueurs, **F** pour poser une herse (flic), **H** pour la sirène (flic), **← →** pour changer de joueur suivi (spectateur), **Échap** pour le menu (la partie continue).

Commandes de chat pour tous : `/joueurs`.

### Ce que ça consomme

Mesuré sur un Mac M4 (le panneau admin affiche les vraies valeurs de ton serveur) :

| Situation | Voitures simulées | Processeur | Mémoire |
|---|---|---|---|
| Serveur au salon | 0 | ≈ 1 % | ≈ 300 Mo |
| 4 fuyards, police serveur, circulation normale | ≈ 100 | ≈ 2 % d'un cœur | ≈ 300 Mo |
| 20 fuyards, police serveur, circulation normale | ≈ 345 | ≈ 7 % d'un cœur | ≈ 340 Mo |

Les 300 Mo de départ correspondent surtout à la carte, gardée en mémoire pour les collisions et les routes. Le réseau tourne autour de 15 à 30 Ko/s envoyés par joueur.

## 7. Sécurité et anti-triche

Chaque joueur simule sa propre voiture, et le serveur vérifie tout ce qui compte :
- **La vie appartient au serveur.** Un joueur qui se remet de la vie en trichant ne gagne rien : les autres voient la vraie valeur, et sa voiture est détruite quand le serveur le décide. Les réparations (bonus, livraisons, défis) sont plafonnées et espacées.
- **Les chocs entre joueurs** sont signalés par les deux voitures, et le serveur garde le plus fort. Mentir sur ses propres dégâts ne protège donc pas d'un flic. Côté physique, chacun calcule le choc avec la vraie masse de l'autre voiture et n'en applique que sa part : un choc pousse et ralentit comme en vrai, au lieu de faire glisser l'autre voiture comme un objet sur une table.
- **Les objectifs et réparations** : le serveur vérifie avec les positions reçues que le fuyard est bien resté dans la zone, plafonne le butin, et soigne lui-même.
- **Les positions** : une voiture qui va plus vite que possible (téléportation) est remise à sa dernière position valable. Si ça se répète, elle est expulsée automatiquement.
- **Les arrestations** par un flic joueur sont calculées par le serveur à partir des positions.
- **Les points** sont plafonnés par type d'événement, et les multiplicateurs vérifiés.
- **Chat** : 160 caractères au plus, caractères invisibles et texte inversé supprimés, accents empilés limités, anti-flood (silence de 30 s si ça insiste). L'affichage se fait toujours en texte brut, jamais en HTML.
- **Accès** : mot de passe comparé en temps constant, 5 essais par minute et par IP. Au plus 10 connexions par IP et des messages limités en taille et en débit.
- **Bannissement** : par compte Discord, par navigateur (identifiant gardé par la page et empreinte FingerprintJS) et par adresse IP. Un invité qui vide son navigateur et change d'adresse peut revenir : sur Internet, aucun système ne l'empêche à 100 %. Active l'accord de l'hôte (`joinApproval`) si quelqu'un insiste.
- **Identité Discord** : le ticket est signé par le site (Ed25519). Personne ne peut usurper un compte Discord, et un hôte ne peut pas réutiliser le ticket d'un joueur sur un autre serveur.

Comme pour tout jeu en réseau, l'hôte reste la personne de confiance : c'est lui qui fait tourner le serveur.

## 8. Héberger sur un VPS Linux

```bash
mkdir -p ~/encavale && cd ~/encavale
curl -LO https://github.com/axizof/encavale-server/releases/latest/download/encavale-server-X.Y.Z-linux-x64.tar.gz
tar xzf encavale-server-*-linux-x64.tar.gz && cd linux-x64
./encavale-server-*-linux-x64          # premier lancement : crée config.json, Ctrl+C pour arrêter
sudo ufw allow 7777/tcp
```

Service systemd (`/etc/systemd/system/encavale.service`), pour un serveur qui redémarre tout seul :

```ini
[Unit]
Description=Serveur En Cavale
After=network.target

[Service]
WorkingDirectory=/home/TONUSER/encavale/linux-x64
ExecStart=/home/TONUSER/encavale/linux-x64/encavale-server-X.Y.Z-linux-x64
Restart=always
User=TONUSER

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now encavale
journalctl -u encavale -f     # journal (le terminal interactif n'est pas disponible en service)
```

## 9. Développement

Le serveur est écrit en **TypeScript**. Node.js 22.18 ou plus récent l'exécute directement (les types sont effacés au lancement, rien à compiler), et Bun aussi pour les exécutables.

```bash
npm install
npm start                 # serveur sur le port de config.json (7777)
npm run typecheck         # vérification des types (tsc)
npm test                  # tests (protocole, chat, accès, admins Discord, objectifs, simulation)
```

**Le jeu servi aux joueurs** est la copie compilée dans `public/`, et le **moteur de simulation** (carte, physique, IA de circulation et de police) est dans `sim/sim.js`. Les deux sont générés depuis le projet du jeu (dossier parent) par `npm run build:mp`. Il n'y a qu'une seule version du code de la physique et de l'IA, celle du jeu. Commite ensuite `public/` et `sim/`. Le protocole (`src/protocol.ts`) est partagé avec le jeu : un changement incompatible doit monter `PROTOCOL`. Les joueurs d'une ancienne version sont alors priés de recharger la page.

**Exécutables** : `npm run build`, qui demande [Bun](https://bun.sh). Il intègre `public/` dans le binaire, puis compile pour Windows, macOS et Linux dans `dist/`.

**Branches** :
- `develop` : le travail en cours, testé automatiquement à chaque envoi ;
- `main` : les versions publiées. À chaque envoi sur `main`, si la version de `package.json` n'a pas encore de release, GitHub compile les exécutables et publie la release `vX.Y.Z`.

Pour publier une version :
1. Monte `version` dans `package.json`.
2. Fusionne `develop` dans `main`, puis envoie (`git push origin main`).
