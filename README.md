# Mini Shop — Docker Compose Microservices Demo

Project tập trung vào **2 business microservices** và **2 mô hình public exposure khác nhau**.

- `order-service` — FastAPI, sở hữu order data trong PostgreSQL.
- `catalog-service` — Express, sở hữu product/stock trong Redis.
- `frontend-service` — React UI, được Nginx serve như static files.
- `ngrok` — HTTPS edge; Case 1 dùng Traffic Policy làm reverse proxy, Case 2 mở 3 public tunnel độc lập.

## Business flow chung

```text
Order Service --------------------> Catalog Service
   |                                  |
order-data-net                 catalog-data-net
   |                                  |
PostgreSQL                           Redis
```

Order **không truy cập Redis trực tiếp**. Catalog **không truy cập PostgreSQL trực tiếp**. Order gọi Catalog qua `service-net`.

Đặt ngrok authtoken trong `.env`:

```env
NGROK_AUTHTOKEN=your_real_token
```

Không commit token thật.

---

# CASE 1 — ngrok Traffic Policy reverse proxy, backend không có public URL riêng

File: `compose.yaml`.

```text
Internet
   |
 HTTPS
   |
 ngrok public endpoint
   |
 Traffic Policy
   +---- / --------------------> frontend-service:80
   +---- /shop/products -------> catalog.internal -> catalog-service:8002/products
   +---- /shop/orders ---------> order.internal   -> order-service:8003/orders
   +---- /shop/checkout -------> order.internal   -> order-service:8003/orders
   +---- /shop/system/... -----> selected internal service route
   X---- /api/* --------------> 404
```

Case 1 **không dùng BFF và không dùng Nginx làm reverse proxy**. Nginx trong `frontend-service` chỉ serve React static files. Routing/rewrite/forward backend do **ngrok Traffic Policy** thực hiện.

Ngrok dùng config v3 trong `ngrok/ngrok.private.yml`:

```text
public HTTPS endpoint   -> frontend-service:80 khi request không match rule backend
order.internal          -> order-service:8003
catalog.internal        -> catalog-service:8002
```

`order.internal` và `catalog.internal` là ngrok **internal endpoints**, không phải public Internet URL. Public endpoint có URL ngẫu nhiên vì config dùng `url: https://`.

Frontend container chỉ nằm trên `edge-net`; ngrok nằm trên `edge-net` + `service-net`. Vì vậy frontend Nginx không cần truy cập trực tiếp Order/Catalog nữa.

### Chạy Case 1

```powershell
docker compose down -v --remove-orphans
docker compose up -d --build
docker compose ps
```

Lấy URL public:

```powershell
docker run --rm --network mini-shop-private_edge-net curlimages/curl:latest http://ngrok:4040/api/tunnels
```

Trong JSON tìm endpoint/tunnel tên `public` và lấy URL HTTPS.

Test:

```text
/                                      ✅ React UI
/shop/products                         ✅ Catalog qua ngrok Traffic Policy
/shop/orders                           ✅ Order qua ngrok Traffic Policy
/shop/checkout                         ✅ POST Order qua ngrok Traffic Policy
/api/order/orders                      ❌ 404 tại ngrok edge
/api/catalog/products                  ❌ 404 tại ngrok edge
http://localhost:8002/products         ❌
http://localhost:8003/orders           ❌
```

Điểm quan trọng: `/shop/*` là public contract nên curl/Postman vẫn có thể gọi. Điều giữ private là **native backend endpoint/public URL riêng**, không phải việc phân biệt browser với Postman.

---

# CASE 2 — ba public URL độc lập từ một ngrok agent

File: `compose.public.yaml`.

Một container `ngrok` chạy ba tunnel trong cùng một agent session:

```text
Internet -> FE public URL      -> frontend-service:80
Internet -> Order public URL   -> order-service:8003
Internet -> Catalog public URL -> catalog-service:8002
```

Tunnel definitions nằm trong `ngrok/ngrok.yml`:

```text
frontend -> frontend-service:80
order    -> order-service:8003
catalog  -> catalog-service:8002
```

Backend vẫn không publish host port, nhưng Order và Catalog có URL Internet riêng.

Frontend Nginx Case 2 chỉ serve React + `/runtime/tunnels` để browser discover Order/Catalog URL. Business API **không đi qua frontend Nginx**.

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

Tìm `frontend`, `order`, `catalog` và lấy từng `public_url`.

```text
FE_URL/              ✅
ORDER_URL/orders     ✅ native Order API public
CATALOG_URL/products ✅ native Catalog API public
localhost:8002       ❌
localhost:8003       ❌
```

POST Order trực tiếp:

```text
POST https://<order-url>/orders
Content-Type: application/json
ngrok-skip-browser-warning: 1
```

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
one public ngrok URL
  /                -> FE
  selected /shop/* -> private internal endpoints
  /api/*           -> blocked

CASE 2
FE_URL       -> FE
ORDER_URL    -> native Order API
CATALOG_URL  -> native Catalog API
```

Case 1 dùng **ngrok như reverse proxy/API gateway có chọn lọc**. Case 2 public từng backend bằng URL riêng. Database luôn private và cả hai case đều không publish host port `8002/8003`.

## Network boundary

```powershell
# Order thấy Catalog
docker compose exec order-service python -c "import socket; print(socket.gethostbyname('catalog-service'))"

# Order không thấy Redis
docker compose exec order-service python -c "import socket; print(socket.gethostbyname('redis'))"

# Catalog không thấy PostgreSQL
docker compose exec catalog-service node -e "require('dns').lookup('postgres',(e,a)=>console.log(e||a))"
```

Case 2 thêm `-f compose.public.yaml` vào các lệnh trên.

## Files quan trọng

```text
compose.yaml                        Case 1
ngrok/ngrok.private.yml             Case 1 ngrok v3 endpoints + Traffic Policy
frontend-service/Dockerfile.private Case 1 static React/Nginx
frontend-service/nginx.private.conf Case 1 static-only Nginx
compose.public.yaml                 Case 2
ngrok/ngrok.yml                     Case 2 3 tunnel definitions
frontend-service/nginx.conf         Case 2 static UI + runtime tunnel discovery
frontend-service/src/api.js         API calls cho cả hai case
```
