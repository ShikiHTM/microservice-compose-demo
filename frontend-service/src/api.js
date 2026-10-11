export const deploymentMode = import.meta.env.VITE_DEPLOYMENT_MODE || 'private';

function normalizeError(detail, status) {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => item?.msg || JSON.stringify(item)).join(', ');
  }
  if (detail && typeof detail === 'object') {
    if (detail.message) {
      return detail.available !== undefined
        ? `${detail.message} (available: ${detail.available})`
        : detail.message;
    }
    return JSON.stringify(detail);
  }
  return `HTTP ${status}`;
}

function isNgrokUrl(url) {
  return /^https?:\/\/[^/]*ngrok/i.test(url);
}

export async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(isNgrokUrl(url) ? { 'ngrok-skip-browser-warning': '1' } : {}),
      ...(options.headers || {})
    }
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(normalizeError(payload?.detail ?? payload?.message, response.status));
  }
  return payload;
}

const privateEndpoints = {
  products: '/shop/products',
  orders: '/shop/orders',
  createOrder: '/shop/checkout',
  system: '/shop/system'
};

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function discoverTunnel(name, label) {
  let lastError = null;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const response = await fetch('/runtime/tunnels', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const tunnels = payload.tunnels || [];
      const tunnel = tunnels.find((item) => item.name === name && item.proto === 'https')
        || tunnels.find((item) => item.name === name)
        || tunnels.find((item) => item.name?.startsWith(name) && item.proto === 'https');
      if (tunnel?.public_url) return tunnel.public_url.replace(/\/$/, '');
      throw new Error(`${name} public_url not ready`);
    } catch (error) {
      lastError = error;
      await sleep(500);
    }
  }

  throw new Error(`Cannot discover ${label} ngrok URL: ${lastError?.message || 'unknown error'}`);
}

let publicEndpointsPromise = null;

async function getPublicEndpoints() {
  if (!publicEndpointsPromise) {
    publicEndpointsPromise = Promise.all([
      discoverTunnel('order', 'Order'),
      discoverTunnel('catalog', 'Catalog')
    ])
      .then(([orderBase, catalogBase]) => ({
        orderBase,
        catalogBase,
        products: `${catalogBase}/products`,
        orders: `${orderBase}/orders`,
        createOrder: `${orderBase}/orders`
      }))
      .catch((error) => {
        publicEndpointsPromise = null;
        throw error;
      });
  }
  return publicEndpointsPromise;
}

async function publicSystem() {
  const endpoints = await getPublicEndpoints();
  const urls = {
    orderInfo: `${endpoints.orderBase}/info`,
    orderDependencies: `${endpoints.orderBase}/dependencies`,
    orderStats: `${endpoints.orderBase}/stats`,
    catalogInfo: `${endpoints.catalogBase}/info`,
    catalogDependencies: `${endpoints.catalogBase}/dependencies`,
    catalogStats: `${endpoints.catalogBase}/stats`
  };

  const entries = await Promise.all(
    Object.entries(urls).map(async ([key, url]) => {
      try {
        return [key, { ok: true, data: await requestJson(url) }];
      } catch (error) {
        return [key, { ok: false, error: error.message }];
      }
    })
  );
  return { mode: 'public', results: Object.fromEntries(entries) };
}

export const api = {
  products: async () => {
    if (deploymentMode === 'private') return requestJson(privateEndpoints.products);
    const endpoints = await getPublicEndpoints();
    return requestJson(endpoints.products);
  },
  orders: async () => {
    if (deploymentMode === 'private') return requestJson(privateEndpoints.orders);
    const endpoints = await getPublicEndpoints();
    return requestJson(endpoints.orders);
  },
  createOrder: async (payload) => {
    const url = deploymentMode === 'private'
      ? privateEndpoints.createOrder
      : (await getPublicEndpoints()).createOrder;
    return requestJson(url, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  system: () =>
    deploymentMode === 'private' ? requestJson(privateEndpoints.system) : publicSystem()
};
