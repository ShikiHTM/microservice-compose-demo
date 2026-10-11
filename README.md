# Mini Shop — Docker Compose Microservices Demo

Project có **2 business microservices**:

- `order-service` — FastAPI, sở hữu order data trong PostgreSQL.
- `catalog-service` — Express, sở hữu product/stock trong Redis.
- `frontend-service` — React UI được Nginx serve.
- `ngrok` — public HTTPS edge.

## Business flow chung

```text
Order Service --------------------> Catalog Service
   |                                  |
PostgreSQL                           Redis
```

Order gọi Catalog qua `service-net`. Order không truy cập Redis trực tiếp; Catalog không truy cập PostgreSQL trực tiếp.

Đặt token trong `.env`:

```env
NGROK_AUTHTOKEN=your_real_token
```

---

# CASE 1 — ngrok tunnel + Nginx reverse proxy, backend private

File: `compose.yaml`.

```text
Internet
   |
 HTTPS
   |
 ngrok
   |
Frontend + Nginx reverse proxy
   |
service-net
   +-----------> Order Service -----------> Catalog Service
                      |                           |
                  PostgreSQL                    Redis
```

Ngrok chỉ tạo HTTPS tunnel vào `frontend-service:80`. **Nginx mới là reverse proxy** cho các route được chọn:

```text
GET  /shop/products  -> catalog-service:8002/products
GET  /shop/orders    -> order-service:8003/orders
POST /shop/checkout  -> order-service:8003/orders
```

Các route `/shop/system/...` cũng được proxy để UI hiển thị metadata. `/api/*` trả `404`, nên native Order/Catalog API không được expose qua public frontend URL.

`frontend-service` nằm trên `edge-net` + `service-net`; `ngrok` chỉ cần `edge-net`. Order/Catalog không publish host port.

> Ghi chú: ngrok có Traffic Policy/Gateway có thể làm routing nâng cao, nhưng policy cần cho demo này bị giới hạn bởi plan hiện tại. Vì vậy project dùng ngrok làm HTTPS tunnel và Nginx làm reverse proxy để demo chạy ổn định trên plan hiện có.

### Chạy Case 1

```powershell
docker compose down -v --remove-orphans
docker compose up -d --build
docker compose ps
```

Lấy URL:

```powershell
docker run --rm --network mini-shop-private_edge-net curlimages/curl:latest http://ngrok:4040/api/tunnels
```

Test:

```text
BASE/                     ✅ React UI
BASE/shop/products        ✅ qua Nginx -> Catalog
BASE/shop/orders          ✅ qua Nginx -> Order
BASE/api/order/orders     ❌ 404
localhost:8002            ❌
localhost:8003            ❌
```

---

# CASE 2 — ba public URL độc lập từ một ngrok agent

File: `compose.public.yaml`.

```text
Internet -> FE public URL      -> frontend-service:80
Internet -> Order public URL   -> order-service:8003
Internet -> Catalog public URL -> catalog-service:8002
```

Một container `ngrok` chạy 3 tunnel trong cùng một agent session, khai báo tại `ngrok/ngrok.yml`:

```text
frontend -> frontend-service:80
order    -> order-service:8003
catalog  -> catalog-service:8002
```

Frontend Nginx Case 2 chỉ serve React và `/runtime/tunnels` để browser discover backend URLs. Business API **không reverse proxy qua frontend Nginx**.

Order vẫn gọi Catalog nội bộ bằng:

```text
http://catalog-service:8002
```

### Chạy Case 2

```powershell
docker compose -f compose.public.yaml down -v --remove-orphans
docker compose -f compose.public.yaml up -d --build
docker compose -f compose.public.yaml ps
```

Lấy cả 3 URL:

```powershell
docker run --rm --network mini-shop-public_edge-net curlimages/curl:latest http://ngrok:4040/api/tunnels
```

```text
FE_URL/              ✅
ORDER_URL/orders     ✅ native Order API public
CATALOG_URL/products ✅ native Catalog API public
localhost:8002       ❌
localhost:8003       ❌
```

---

# Khác nhau cốt lõi

```text
CASE 1
Internet -> ngrok -> Nginx reverse proxy -> selected routes -> private backend

CASE 2
Internet -> FE_URL      -> Frontend
Internet -> ORDER_URL   -> Order API
Internet -> CATALOG_URL -> Catalog API
```

- Case 1: Order/Catalog **không có public URL riêng**.
- Case 2: Order/Catalog **có public URL riêng**.
- Cả hai case đều không publish host port `8002/8003`.
- Database luôn private.

## Files quan trọng

```text
compose.yaml                        Case 1
frontend-service/Dockerfile.private Case 1 React/Nginx
frontend-service/nginx.private.conf Case 1 Nginx reverse proxy
compose.public.yaml                 Case 2
ngrok/ngrok.yml                     Case 2 3 public tunnels
frontend-service/nginx.conf         Case 2 static UI + runtime tunnel discovery
frontend-service/src/api.js         API behavior cho cả hai case
```
