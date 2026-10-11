# Frontend Service

Một React UI nhưng có **hai deployment mode**.

## Case 1 — private backend qua Nginx reverse proxy

Build bằng `Dockerfile.private`.

```text
Browser -> HTTPS ngrok -> frontend-service:80 (Nginx) -> private Order/Catalog services
```

Nginx vừa serve React static files, vừa reverse proxy **chỉ các route được chọn**:

```text
GET  /shop/products  -> catalog-service:8002/products
GET  /shop/orders    -> order-service:8003/orders
POST /shop/checkout  -> order-service:8003/orders
```

Các route metadata dưới `/shop/system/...` cũng được proxy có chủ đích để UI hiển thị trạng thái service.

Không có generic `/api/*` proxy; `/api/*` trả `404`. Vì vậy native Order/Catalog API không có public URL riêng trong Case 1.

## Case 2 — independent public service endpoints

Build bằng `Dockerfile`.

```text
Browser -> FE public URL      -> frontend-service
Browser -> Order public URL   -> order-service
Browser -> Catalog public URL -> catalog-service
```

Case 2 không dùng shared Gateway. Frontend Nginx chỉ serve static React và endpoint metadata runtime:

```text
/runtime/tunnels
```

React dùng metadata này để discover public URL của Order và Catalog, sau đó gọi trực tiếp các backend ngrok URL.

Các business request **không reverse proxy qua frontend Nginx** trong Case 2.

## Build-time mode

React đọc:

```text
VITE_DEPLOYMENT_MODE=private|public
```

- `private`: UI gọi các route `/shop/*` trên cùng origin; Nginx reverse proxy các route được phép tới backend private.
- `public`: UI discover hai backend tunnel rồi gọi trực tiếp `Order /orders` và `Catalog /products` qua public ngrok URLs.

Case 2 backend bật CORS để browser từ frontend ngrok origin có thể gọi hai public backend origins. Đây là browser interoperability, không phải security boundary.
