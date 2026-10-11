# Frontend Service

Một React UI nhưng có **hai runtime mode** tùy deployment.

## Case 1 — private backend

Build bằng `Dockerfile.bff`.

```text
Browser -> HTTPS ngrok -> frontend-bff:3000 -> private Order/Catalog services
```

Runtime là Node.js/Express; nó serve React bundle và cung cấp BFF contract:

```text
GET  /shop/products
GET  /shop/orders
POST /shop/checkout
GET  /shop/system
```

Không có generic `/api/*` proxy; `/api/*` trả 404 có chủ đích.

## Case 2 — independent public service endpoints

Build bằng `Dockerfile`.

```text
Browser -> ngrok-frontend -> frontend-service
Browser -> ngrok-order    -> order-service
Browser -> ngrok-catalog  -> catalog-service
```

Case 2 không dùng shared Gateway. Frontend Nginx chỉ serve static React và hai endpoint metadata nội bộ:

```text
/runtime/order-tunnel
/runtime/catalog-tunnel
```

React dùng metadata này để discover public URL của Order và Catalog tại runtime, sau đó gọi trực tiếp các backend ngrok URL.

Các business request **không proxy qua frontend**.

## Build-time mode

React đọc:

```text
VITE_DEPLOYMENT_MODE=private|public
```

- `private`: UI gọi BFF `/shop/*`.
- `public`: UI discover hai backend tunnel rồi gọi trực tiếp `Order /orders` và `Catalog /products` qua public ngrok URLs.

Case 2 backend bật CORS để browser từ frontend ngrok origin có thể gọi hai public backend origins. Đây là cấu hình demo; production nên giới hạn allowed origins.
