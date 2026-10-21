# En Cavale — serveur multijoueur

Le serveur multijoueur du jeu **En Cavale**, à héberger soi-même, comme un serveur Minecraft : sur ton PC, un PC du salon ou un VPS. Il n'y a ni classement global ni compte obligatoire. Chaque serveur a son salon, ses manches et son meilleur score.

- Jusqu'à **20 joueurs** : des fuyards, des flics joueurs et, si tu veux, la police IA du jeu solo en renfort.
- Des **préréglages** pour répartir les rôles automatiquement, et un mode **personnalisé**.
- Un **chat** avec anti-flood, et la possibilité de masquer les messages de quelqu'un.
- Pour l'hôte : **mot de passe**, **accord de l'hôte** pour chaque arrivée, **expulsion**, **bannissement**.
- Le **serveur fait foi** : la vie, les morts, les arrestations, les scores et les positions impossibles sont vérifiés côté serveur.

## Sommaire
1. [Lancer un serveur](#1-lancer-un-serveur)
2. [Ouvrir le serveur aux joueurs](#2-ouvrir-le-serveur-aux-joueurs)
3. [Rejoindre](#3-rejoindre)
4. [Configuration (config.json)](#4-configuration-configjson)
5. [Administrer](#5-administrer)
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
- **Mac** : ouvre un Terminal dans le dossier et tape `./encavale-server-…`. Si macOS refuse (« développeur non identifié »), tape d'abord `xattr -d com.apple.quarantine encavale-server-*`.
- **Linux** : `./encavale-server-…`.

Au premier lancement, le serveur crée **`config.json`** à côté de l'exécutable, puis affiche les adresses où le rejoindre et le **code admin** :

```
  EN CAVALE — serveur multijoueur v1.0.0
  Sur ce PC    : http://localhost:7777
  Réseau local : http://192.168.1.20:7777
  Internet     : http://TON-IP-PUBLIQUE:7777  (ouvre/redirige le port 7777 TCP sur ta box ou ton VPS)
  Code admin   : 3f9c2a1b  (dans le jeu : /admin 3f9c2a1b)
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
| `adminCode` | aléatoire | Code pour devenir admin en jeu (`/admin CODE`), ou à saisir dans « Je suis l'hôte » en rejoignant. |
| `joinApproval` | `false` | `true` : chaque arrivée doit être acceptée par un admin. Une notification apparaît en jeu et dans le terminal. |
| `motd` | message de bienvenue | Message affiché à l'arrivée. |
| `publicHost` | `[]` | Seulement derrière un reverse proxy : adresses publiques du serveur, pour accepter les tickets Discord. |
| `settings` | — | Derniers réglages de partie (mis à jour par le serveur). |

Relance le serveur après avoir modifié le fichier. Les bannissements sont dans **`bans.json`**, au même endroit.

## 5. Administrer

**En jeu** : tape `/admin CODE` dans le chat. Tu peux alors :
- choisir le préréglage et les réglages, puis lancer la manche ;
- forcer le rôle d'un joueur (flic ou fuyard) ;
- l'expulser, le bannir, ou lui interdire le chat. Passe la souris sur sa ligne dans la liste des joueurs ;
- accepter ou refuser les arrivées (notification en haut à droite) ;
- arrêter la manche (Échap, puis « Arrêter la manche »).

Commandes de chat : `/aide`, `/joueurs`, `/admin CODE` ; pour les admins : `/kick nom`, `/ban nom`, `/muet nom`, `/lancer`, `/stop`.

**Dans le terminal du serveur** (tape `aide`) :

```
joueurs                  liste (rôle, ping, IP)
lancer / stop            lancer / arrêter une manche
preset <nom>             classique, renfort, equipes, chasse, perso
set bots normal          bots (off|normal|renforce), herses (off|rare|normal|beaucoup),
                         flics (nombre), temps (minutes, 0 = illimité),
                         meteo (dynamic|clear|rain|fog|storm), heure (day|sunset|night)
kick <joueur> [raison]   ban <joueur> [raison]   bans   unban <n°|nom>
muet <joueur>            admin <joueur>          dire <message>
accepter <n°> / refuser <n°>     approbation on|off     motdepasse <mdp|off>
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

- **Fuyards** : la vraie partie solo (braquages, livraisons, défis), en survivant. S'ils sont détruits ou arrêtés, ils passent **spectateurs** jusqu'à la manche suivante. Avec la police IA, chaque fuyard a ses propres poursuivants : la police se divise. Plus il y a de fuyards, plus elle est nombreuse et agressive.
- **Flics joueurs** : il faut détruire les fuyards (les chocs comptent) ou les **arrêter** (fuyard immobilisé, flic collé à lui pendant 3 s). Un flic détruit repart **40 s** plus tard, assez loin des fuyards. La radio donne la position de tous les fuyards toutes les 8 s.
- **Voitures de flic** : moins il y a de flics par rapport aux fuyards, plus elles sont fortes. Peu de flics : Intercepteur, SUV ou Berline. Autant de flics que de fuyards : SUV ou Berline. Beaucoup de flics : Berline seulement.
- **Herses** (touche **F**) : en nombre limité, elles se rechargent avec le temps, et plus lentement quand il y a beaucoup de flics. Deux au maximum posées en même temps par flic, pendant 30 s.
- **Fin de manche** : quand tous les fuyards sont tombés (victoire des flics) ou à la fin du temps (les survivants gagnent, avec un bonus). Le classement de la manche s'affiche, puis tout le monde revient au salon. Le **meilleur score du serveur** est gardé tant qu'il tourne.

Touches du multijoueur : **T** ou **Entrée** pour écrire, **K** pour masquer le chat, **L** pour la liste des joueurs, **F** pour poser une herse (flic), **H** pour la sirène (flic), **← →** pour changer de joueur suivi (spectateur), **Échap** pour le menu (la partie continue).

## 7. Sécurité et anti-triche

Chaque joueur simule sa propre voiture, et le serveur vérifie tout ce qui compte :
- **La vie appartient au serveur.** Un joueur qui se remet de la vie en trichant ne gagne rien : les autres voient la vraie valeur, et sa voiture est détruite quand le serveur le décide. Les réparations (bonus, livraisons, défis) sont plafonnées et espacées.
- **Les chocs entre joueurs** sont signalés par les deux voitures, et le serveur garde le plus fort. Mentir sur ses propres dégâts ne protège donc pas d'un flic.
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

Node.js 20 ou plus récent :

```bash
npm install
npm start                 # serveur sur le port de config.json (7777)
npm test                  # tests (protocole, chat, mot de passe, approbation, bannissement)
```

**Le jeu servi aux joueurs** est la copie compilée dans `public/`. Pour la mettre à jour, dans le projet du jeu (dossier parent) : `npm run build:mp`, puis commite `public/`. Le protocole (`src/protocol.js`) est partagé avec le jeu : un changement incompatible doit monter `PROTOCOL`. Les joueurs d'une ancienne version sont alors priés de recharger la page.

**Exécutables** : `npm run build`, qui demande [Bun](https://bun.sh). Il intègre `public/` dans le binaire, puis compile pour Windows, macOS et Linux dans `dist/`.

**Branches** :
- `develop` : le travail en cours, testé automatiquement à chaque envoi ;
- `main` : les versions publiées. À chaque envoi sur `main`, si la version de `package.json` n'a pas encore de release, GitHub compile les exécutables et publie la release `vX.Y.Z`.

Pour publier une version :
1. Monte `version` dans `package.json`.
2. Fusionne `develop` dans `main`, puis envoie (`git push origin main`).
