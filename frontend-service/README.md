# Frontend Service

Một React UI với hai deployment mode.

## Case 1 — ngrok reverse proxy, Nginx static-only

Build bằng `Dockerfile.private`.

```text
Browser -> ngrok public endpoint
             |
             +-- / ----------------> frontend-service:80
             +-- selected /shop/* -> private Order/Catalog internal endpoints
```

Nginx trong `frontend-service` **chỉ serve React static files**. Nó không nằm trên `service-net` và không reverse proxy business API.

Case 1 routing do `ngrok/ngrok.private.yml` đảm nhiệm bằng Traffic Policy:

```text
/shop/products             -> Catalog /products
/shop/orders               -> Order /orders
/shop/checkout             -> Order /orders
/shop/system/order/*       -> Order metadata routes
/shop/system/catalog/*     -> Catalog metadata routes
/api/*                     -> 404
```

Ngrok dùng `url-rewrite` + `forward-internal` tới `order.internal` và `catalog.internal`.

## Case 2 — independent public service endpoints

Build bằng `Dockerfile`.

```text
Browser -> FE public URL      -> frontend-service
Browser -> Order public URL   -> order-service
Browser -> Catalog public URL -> catalog-service
```

Frontend Nginx chỉ serve static React và `/runtime/tunnels` để browser discover public URL của Order/Catalog. Business request không reverse proxy qua frontend.

## Build-time mode

React đọc:

```text
VITE_DEPLOYMENT_MODE=private|public
```

- `private`: UI gọi selected `/shop/*` routes trên cùng public ngrok origin; ngrok Traffic Policy route chúng tới backend private.
- `public`: UI discover hai backend tunnel rồi gọi trực tiếp `Order /orders` và `Catalog /products` qua public ngrok URLs.

Case 2 backend bật CORS vì frontend và backend nằm trên các public origins khác nhau.
