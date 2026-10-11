# Mini Shop — Docker Compose Microservices Demo

Project tập trung vào **2 business microservices** và **2 mô hình public exposure khác nhau**.

- `order-service` — FastAPI, sở hữu order data trong PostgreSQL.
- `catalog-service` — Express, sở hữu product/stock trong Redis.
- `frontend-service` — React UI + Nginx.
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

# CASE 1 — Nginx public, native backend private

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
               order-data-net              catalog-data-net
                      |                           |
                  PostgreSQL                    Redis
```

Không container nào publish host port. Ngrok chỉ tunnel vào `frontend-service:80`.

Nginx serve React và chỉ reverse proxy một số route frontend cần dùng:

```text
GET  /shop/products  -> catalog-service:8002/products
GET  /shop/orders    -> order-service:8003/orders
POST /shop/checkout  -> order-service:8003/orders
```

Các route metadata `/shop/system/...` cũng được proxy riêng để UI hiển thị trạng thái. Không có generic `/api/*` reverse proxy.

Raw backend paths như `/api/order/orders` và `/api/catalog/products` trả `404` có chủ đích.

Điểm quan trọng: external client vẫn có thể gọi các route `/shop/*` public bằng browser/curl/Postman. Điều được giữ private là **native Order/Catalog API và backend service endpoint riêng**.

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

Chứng minh Nginx container gọi Catalog qua private Docker network được:

```powershell
docker compose exec frontend-service wget -qO- http://catalog-service:8002/products
```

---

# CASE 2 — ba public URL độc lập, dùng một ngrok agent session

File: `compose.public.yaml`.

Case 2 **không dùng shared API Gateway**. Một container `ngrok` chạy `start --all` và tạo ba tunnel trong cùng một agent session:

```text
Internet
   |
   +----> FE public URL -------> frontend-service:80
   |
   +----> Order public URL ----> order-service:8003
   |
   +----> Catalog public URL --> catalog-service:8002

Order Service ----private service-net----> Catalog Service
      |                                      |
 PostgreSQL                                Redis
```

Các tunnel được khai báo trong `ngrok/ngrok.yml`:

```text
frontend -> frontend-service:80
order    -> order-service:8003
catalog  -> catalog-service:8002
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

Frontend React chạy trong browser gọi trực tiếp hai backend public URL. `frontend-service` chỉ expose metadata từ ngrok inspector để browser discover URL runtime; nó **không reverse proxy business API** trong Case 2.

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

Lấy cả 3 URL từ **một** ngrok agent:

```powershell
docker run --rm --network mini-shop-public_edge-net curlimages/curl:latest http://ngrok:4040/api/tunnels
```

Trong JSON tìm các tunnel có name:

```text
frontend
order
catalog
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
Internet -> ngrok -> Frontend/Nginx -> selected /shop routes -> private backend

CASE 2
Internet -> FE tunnel      -> Frontend
Internet -> Order tunnel   -> Order API
Internet -> Catalog tunnel -> Catalog API
```

- Case 1: backend microservices **không có public endpoint riêng**; Nginx chỉ reverse proxy các route được chọn.
- Case 2: mỗi backend microservice **có public endpoint riêng**.
- Case 2 dùng **một ngrok agent session nhưng ba tunnel/public URL**.
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
compose.yaml                       Case 1 — ngrok -> Frontend/Nginx reverse proxy
compose.public.yaml                Case 2 — one ngrok agent, 3 public tunnels
ngrok/ngrok.yml                    Case 2 tunnel definitions
frontend-service/Dockerfile.private Case 1 React/Nginx runtime
frontend-service/nginx.private.conf Case 1 selected reverse-proxy routes
frontend-service/Dockerfile         Case 2 React/Nginx runtime
frontend-service/nginx.conf         Case 2 UI + runtime tunnel discovery
frontend-service/src/api.js         Frontend API behavior for both cases
ARCHITECTURE.md                     giải thích topology
README-DEMO.md                      command demo
PRESENTATION-DEMO.md                flow trình bày
```
