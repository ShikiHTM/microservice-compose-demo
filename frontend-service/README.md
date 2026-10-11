# Frontend Service

Một React UI với hai deployment mode.

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

Các route metadata dưới `/shop/system/...` cũng được proxy để UI hiển thị trạng thái service.

Không có generic `/api/*` proxy; `/api/*` trả `404`. Vì vậy native Order/Catalog API không có public URL riêng trong Case 1.

Frontend container nằm trên `edge-net` + `service-net` để Nginx có thể resolve và gọi `order-service` / `catalog-service` bằng Docker DNS.

Ngrok chỉ tạo HTTPS tunnel tới `frontend-service:80` trong Case 1.

## Case 2 — independent public service endpoints

Build bằng `Dockerfile`.

```text
Browser -> FE public URL      -> frontend-service
Browser -> Order public URL   -> order-service
Browser -> Catalog public URL -> catalog-service
```

Frontend Nginx Case 2 chỉ serve static React và `/runtime/tunnels` để browser discover public URL của Order/Catalog. Business request không reverse proxy qua frontend.

## Build-time mode

React đọc:

```text
VITE_DEPLOYMENT_MODE=private|public
```

- `private`: UI gọi `/shop/*` trên cùng origin; Nginx reverse proxy các route được phép tới backend private.
- `public`: UI discover backend tunnels rồi gọi trực tiếp `Order /orders` và `Catalog /products` qua public ngrok URLs.

Case 2 backend bật CORS vì frontend và backend nằm trên các public origins khác nhau.
