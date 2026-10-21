// Identité Discord des joueurs : le site En Cavale (cavaleapi.axizz.fr/mp_ticket.php) signe un petit
// ticket { did, name, av, aud, exp } avec sa clé Ed25519 secrète. Le serveur vérifie la signature
// avec la clé publique ci-dessous : personne ne peut fabriquer une fausse identité Discord.
// « aud » = l'adresse du serveur visé : un ticket donné à un serveur ne marche pas sur un autre.
import crypto from 'node:crypto';

export const TICKET_PUBLIC_KEY = 'iy/sR+Wid42C39Ch+VAapWmfoAHbEygTHjTNIi75h08=';

let keyObj = null;
function publicKey(b64) {
  if (keyObj && keyObj.b64 === b64) return keyObj.key;
  const raw = Buffer.from(b64, 'base64');
  if (raw.length !== 32) throw new Error('clé publique invalide');
  const key = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' });
  keyObj = { b64, key };
  return key;
}

/**
 * @param {string} ticket   payloadBase64url.signatureBase64url
 * @param {string[]} hosts  adresses acceptées pour « aud » (en-tête Host de la connexion, config)
 * @returns {{id:string,name:string,avatar:string|null}|null}
 */
export function verifyTicket(ticket, hosts, pubB64 = TICKET_PUBLIC_KEY) {
  if (typeof ticket !== 'string' || ticket.length > 1200) return null;
  const parts = ticket.split('.');
  if (parts.length !== 2) return null;
  try {
    const payload = Buffer.from(parts[0], 'base64url');
    const sig = Buffer.from(parts[1], 'base64url');
    if (sig.length !== 64) return null;
    if (!crypto.verify(null, payload, publicKey(pubB64), sig)) return null;
    const d = JSON.parse(payload.toString('utf8'));
    if (!d || typeof d.did !== 'string' || !/^\d{5,25}$/.test(d.did)) return null;
    if (typeof d.exp !== 'number' || d.exp < Date.now() / 1000 - 60) return null;
    const aud = String(d.aud || '').toLowerCase();
    if (!hosts.map((h) => String(h).toLowerCase()).includes(aud)) return null;
    return {
      id: d.did,
      name: String(d.name || 'Joueur').slice(0, 64),
      avatar: typeof d.av === 'string' && /^[a-z0-9_]{1,40}$/i.test(d.av) ? d.av : null,
    };
  } catch {
    return null;
  }
}
