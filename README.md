# Mini Shop — Docker Compose Microservices Demo

Project tập trung vào **2 business microservices** và **2 mô hình public exposure khác nhau**.

- `order-service` — FastAPI, sở hữu order data trong PostgreSQL.
- `catalog-service` — Express, sở hữu product/stock trong Redis.
- `frontend-service` — React UI; Case 1 chạy kèm BFF, Case 2 chạy static Nginx.
- `ngrok` — public HTTPS edge.

`customer-service` đã được bỏ. Customer được lưu như snapshot trong order (`customer_name`, `customer_email`).

## Business flow chung

```text
Order Service --------------------> Catalog Service
   |                                  |
order-data-net                 catalog-data-net
   |                                  |
PostgreSQL                           Redis
```

Order **không truy cập Redis trực tiếp**. Catalog **không truy cập PostgreSQL trực tiếp**. Hai service giao tiếp với nhau qua `service-net`.

## Chuẩn bị ngrok

Đặt authtoken vào `.env`:

```env
NGROK_AUTHTOKEN=your_real_token
```

Không commit token thật lên repository.

---

# CASE 1 — một public BFF, backend private

File: `compose.yaml`.

```text
Internet
   |
 HTTPS
   |
 ngrok
   |
Frontend/BFF
   |
service-net
   +-----------> Order Service -----------> Catalog Service
                      |                           |
               order-data-net              catalog-data-net
                      |                           |
                  PostgreSQL                    Redis
```

Không container nào publish host port. Ngrok chỉ tunnel vào `frontend-bff`.

Public BFF contract:

```text
GET  /shop/products
GET  /shop/orders
POST /shop/checkout
GET  /shop/system
```

Raw backend paths như `/api/order/orders` và `/api/catalog/products` trả `404` có chủ đích.

Điểm quan trọng: external client vẫn có thể gọi public BFF contract bằng browser/curl/Postman. Điều được giữ private là **native Order/Catalog API**, không phải mọi business action.

### Chạy Case 1

```powershell
docker compose down -v
docker compose up -d --build
docker compose ps
```

Lấy URL ngrok:

```powershell
docker run --rm --network mini-shop-private_edge-net curlimages/curl:latest http://ngrok:4040/api/tunnels
```

Kỳ vọng:

```text
/shop/products                         ✅
/api/order/orders                      ❌ 404
/api/catalog/products                  ❌ 404
http://localhost:8002/products         ❌
http://localhost:8003/orders           ❌
```

BFF vẫn gọi backend private được:

```powershell
docker compose exec frontend-bff node -e "fetch('http://catalog-service:8002/products').then(r=>r.text()).then(console.log)"
```

---

# CASE 2 — Frontend, Order, Catalog có 3 public ngrok endpoint độc lập

File: `compose.public.yaml`.

Case 2 **không dùng shared API Gateway** nữa.

```text
Internet
   |
   +----> ngrok-frontend ----> frontend-service:80
   |
   +----> ngrok-order -------> order-service:8003
   |
   +----> ngrok-catalog -----> catalog-service:8002

Order Service ----private service-net----> Catalog Service
      |                                      |
 PostgreSQL                                Redis
```

Backend vẫn **không publish host port**. Vì vậy:

```text
localhost:8002  ❌
localhost:8003  ❌
```

Nhưng Order và Catalog có public URL riêng trên Internet qua ngrok:

```text
https://<frontend-url>.ngrok-free.app/
https://<order-url>.ngrok-free.app/orders
https://<catalog-url>.ngrok-free.app/products
```

Frontend React chạy trong browser sẽ gọi trực tiếp hai backend ngrok URL. `frontend-service` chỉ expose metadata để browser tự discover URL runtime; nó không proxy business API.

Order vẫn gọi Catalog nội bộ bằng:

```text
http://catalog-service:8002
```

không đi vòng qua ngrok.

### Chạy Case 2

```powershell
docker compose -f compose.public.yaml down -v
docker compose -f compose.public.yaml up -d --build
docker compose -f compose.public.yaml ps
```

Lấy 3 URL:

```powershell
docker run --rm --network mini-shop-public_edge-net curlimages/curl:latest http://ngrok-frontend:4040/api/tunnels
docker run --rm --network mini-shop-public_edge-net curlimages/curl:latest http://ngrok-order:4040/api/tunnels
docker run --rm --network mini-shop-public_edge-net curlimages/curl:latest http://ngrok-catalog:4040/api/tunnels
```

Test:

```text
Frontend URL                           ✅ mở React app
Order URL /orders                     ✅ public API
Catalog URL /products                 ✅ public API
localhost:8002                        ❌
localhost:8003                        ❌
```

POST trực tiếp Order bằng Postman:

```text
POST https://<order-url>.ngrok-free.app/orders
Content-Type: application/json
ngrok-skip-browser-warning: 1
```

Body:

```json
{
  "customer_name": "Nguyen Van An",
  "customer_email": "an@example.com",
  "product_id": 1,
  "quantity": 2
}
```

---

# Khác nhau cốt lõi

```text
CASE 1
Internet -> ngrok -> BFF -> private native Order/Catalog APIs

CASE 2
Internet -> ngrok-FE      -> Frontend
Internet -> ngrok-Order   -> Order API
Internet -> ngrok-Catalog -> Catalog API
```

- Case 1: backend microservices **không có public endpoint riêng**.
- Case 2: mỗi backend microservice **có public endpoint riêng**.
- Cả hai case đều không cần publish `8002/8003` ra host.
- Database luôn private.

---

# Network boundary demo

Order thấy Catalog:

```powershell
docker compose -f compose.public.yaml exec order-service python -c "import socket; print(socket.gethostbyname('catalog-service'))"
```

Order không thấy Redis:

```powershell
docker compose -f compose.public.yaml exec order-service python -c "import socket; print(socket.gethostbyname('redis'))"
```

Catalog không thấy PostgreSQL:

```powershell
docker compose -f compose.public.yaml exec catalog-service node -e "require('dns').lookup('postgres',(e,a)=>console.log(e||a))"
```

---

# Persistence

PostgreSQL dùng named volume `order-data`. Redis bật AOF và dùng named volume `catalog-data`.

```powershell
docker compose down
```

giữ dữ liệu.

```powershell
docker compose down -v
```

xóa cả volumes.

---

# Files quan trọng

```text
compose.yaml                     Case 1 — ngrok -> Frontend/BFF
compose.public.yaml              Case 2 — 3 independent ngrok endpoints
frontend-service/Dockerfile.bff  Case 1 Node/Express BFF runtime
frontend-service/Dockerfile      Case 2 React/Nginx runtime
frontend-service/server.js       Case 1 BFF business contract
frontend-service/nginx.conf      Case 2 UI + runtime tunnel discovery
frontend-service/src/api.js      Browser discovers and calls public BE tunnels
ARCHITECTURE.md                  giải thích topology
README-DEMO.md                   command demo
PRESENTATION-DEMO.md             flow trình bày
```
