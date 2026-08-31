import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 10000);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://ride-hub-scooters.onrender.com';
let urentToken = null;
let urentTokenExpiresAt = 0;

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': ALLOWED_ORIGIN,
    'access-control-allow-methods': 'GET,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function cleanBase(value) {
  return String(value || '').replace(/\/+$/, '');
}

async function getUrentToken() {
  const gateway = cleanBase(process.env.URENT_GATEWAY);
  const login = process.env.URENT_LOGIN;
  const password = process.env.URENT_PASSWORD;
  if (!gateway || !login || !password) {
    const err = new Error('URENT_ACCESS_REQUIRED');
    err.code = 'ACCESS_REQUIRED';
    throw err;
  }
  if (urentToken && Date.now() < urentTokenExpiresAt - 60_000) return urentToken;
  const response = await fetch(`${gateway}/api/v1/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
  if (!response.ok) throw new Error(`URENT_TOKEN_${response.status}`);
  const data = await response.json();
  if (!data?.access_token) throw new Error('URENT_TOKEN_MISSING');
  urentToken = data.access_token;
  urentTokenExpiresAt = Date.now() + Math.max(300, Number(data.expires_in || 3600)) * 1000;
  return urentToken;
}

function pointFromObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const coordCandidates = [
    [obj.lat, obj.long], [obj.lat, obj.lng], [obj.latitude, obj.longitude],
    [obj.location?.lat, obj.location?.long], [obj.location?.lat, obj.location?.lng],
    [obj.coordinates?.lat, obj.coordinates?.long], [obj.coordinates?.latitude, obj.coordinates?.longitude],
  ];
  let lat, lng;
  for (const pair of coordCandidates) {
    const a = Number(pair[0]), b = Number(pair[1]);
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180) {
      lat = a; lng = b; break;
    }
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const id = obj.identifier || obj.transportIdentifier || obj.number || obj.code || obj.id;
  if (!id) return null;
  const charge = obj.charge || {};
  const battery = Number(charge.customerPercent ?? charge.batteryPercent ?? obj.batteryPercent ?? obj.battery ?? obj.chargePercent);
  const state = String(obj.state ?? obj.status ?? '').toLowerCase();
  return {
    id: String(id),
    lat,
    lng,
    battery: Number.isFinite(battery) ? Math.max(0, Math.min(100, Math.round(battery))) : null,
    available: !state || !/(busy|inactive|disabled|unavailable|service|repair)/i.test(state),
    provider: 'urent',
    model: obj.modelName || obj.model?.name || null,
  };
}

function collectPoints(value, out = [], depth = 0) {
  if (depth > 7 || out.length > 2000 || value == null) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectPoints(item, out, depth + 1);
    return out;
  }
  if (typeof value === 'object') {
    const p = pointFromObject(value);
    if (p) out.push(p);
    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') collectPoints(child, out, depth + 1);
    }
  }
  return out;
}

function dedupe(points) {
  const map = new Map();
  for (const p of points) if (!map.has(p.id)) map.set(p.id, p);
  return [...map.values()];
}

async function getUrentScooters(lat, lng, radius) {
  const gateway = cleanBase(process.env.URENT_GATEWAY);
  const pathTemplate = process.env.URENT_NEARBY_PATH;
  if (!pathTemplate) {
    const err = new Error('URENT_NEARBY_PATH_REQUIRED');
    err.code = 'ENDPOINT_REQUIRED';
    throw err;
  }
  const token = await getUrentToken();
  const path = pathTemplate
    .replaceAll('{lat}', encodeURIComponent(String(lat)))
    .replaceAll('{lng}', encodeURIComponent(String(lng)))
    .replaceAll('{long}', encodeURIComponent(String(lng)))
    .replaceAll('{radius}', encodeURIComponent(String(radius)));
  const url = /^https?:\/\//i.test(path) ? path : `${gateway}${path.startsWith('/') ? '' : '/'}${path}`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`URENT_LIVE_${response.status}`);
  const data = await response.json();
  return dedupe(collectPoints(data)).filter(p => p.available);
}

function providerStatus() {
  return {
    urent: {
      live: Boolean(process.env.URENT_GATEWAY && process.env.URENT_LOGIN && process.env.URENT_PASSWORD && process.env.URENT_NEARBY_PATH),
      reason: process.env.URENT_GATEWAY && process.env.URENT_LOGIN && process.env.URENT_PASSWORD
        ? (process.env.URENT_NEARBY_PATH ? null : 'nearby_endpoint_required')
        : 'partner_access_required',
    },
    yandex: { live: false, reason: 'official_scooter_partner_api_required' },
    whoosh: { live: false, reason: 'official_scooter_partner_api_required' },
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/health') return json(res, 200, { ok: true, service: 'ride-hub-live-api' });
  if (url.pathname === '/api/providers') return json(res, 200, { providers: providerStatus() });
  if (url.pathname === '/api/scooters' && req.method === 'GET') {
    const provider = url.searchParams.get('provider') || 'urent';
    const lat = Number(url.searchParams.get('lat'));
    const lng = Number(url.searchParams.get('lng'));
    const radius = Math.max(100, Math.min(2000, Number(url.searchParams.get('radius') || 700)));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return json(res, 400, { error: 'lat_lng_required' });
    if (provider !== 'urent') return json(res, 503, { error: 'official_partner_api_required', provider });
    try {
      const scooters = await getUrentScooters(lat, lng, radius);
      return json(res, 200, { provider, live: true, count: scooters.length, scooters, updatedAt: new Date().toISOString() });
    } catch (error) {
      if (error.code === 'ACCESS_REQUIRED') return json(res, 503, { error: 'partner_access_required', provider });
      if (error.code === 'ENDPOINT_REQUIRED') return json(res, 503, { error: 'nearby_endpoint_required', provider });
      console.error(error);
      return json(res, 502, { error: 'provider_unavailable', provider });
    }
  }
  return json(res, 404, { error: 'not_found' });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Ride Hub live API on ${PORT}`));
