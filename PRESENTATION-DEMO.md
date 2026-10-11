# Presentation Demo — 2 Microservices / 2 Exposure Models

## 0. Business architecture

```text
Order Service -> Catalog Service
     |               |
 PostgreSQL         Redis
```

Nói:

> Em dùng hai business service có ownership rõ: Order sở hữu order data trong PostgreSQL, Catalog sở hữu product/stock trong Redis. Order muốn reserve stock phải gọi Catalog API, không truy cập Redis trực tiếp.

---

# CASE 1 — ngrok Traffic Policy làm reverse proxy

Start:

```powershell
docker compose down -v --remove-orphans
docker compose up -d --build
docker compose ps
```

Lấy public URL:

```powershell
docker run --rm --network mini-shop-private_edge-net curlimages/curl:latest http://ngrok:4040/api/tunnels
```

Trong JSON tìm endpoint/tunnel `public`.

Nói:

> Case 1 không dùng BFF và Nginx cũng không reverse proxy backend. Ngrok dùng Traffic Policy để route theo path, rewrite URL và forward tới các internal endpoint của Order/Catalog. Hai backend không có public URL riêng.

Flow:

```text
Internet -> one ngrok public URL
              |
              +-- / ----------------> Frontend static Nginx
              +-- /shop/products ---> catalog.internal -> Catalog
              +-- /shop/orders -----> order.internal   -> Order
              +-- /shop/checkout ---> order.internal   -> Order
              X-- /api/* -----------> 404
```

Test:

```text
BASE/                     ✅ FE
BASE/shop/products        ✅
BASE/shop/orders          ✅
BASE/api/order/orders     ❌ 404
localhost:8002            ❌
localhost:8003            ❌
```

Chứng minh frontend không còn trực tiếp thấy backend:

```powershell
docker compose exec frontend-service wget -T 3 -O - http://catalog-service:8002/products
```

Kỳ vọng fail vì frontend chỉ ở `edge-net`. Ngrok nằm trên `edge-net` + `service-net` và chính ngrok làm reverse proxy.

Câu chốt:

> Case 1 chỉ có một public URL. Ngrok là reverse proxy/API gateway có chọn lọc; native Order/Catalog không có public endpoint riêng.

Xong Case 1:

```powershell
docker compose down
```

---

# CASE 2 — ba public URL độc lập, một ngrok agent

Start:

```powershell
docker compose -f compose.public.yaml down -v --remove-orphans
docker compose -f compose.public.yaml up -d --build
docker compose -f compose.public.yaml ps
```

Lấy cả 3 URL:

```powershell
docker run --rm --network mini-shop-public_edge-net curlimages/curl:latest http://ngrok:4040/api/tunnels
```

Tìm `frontend`, `order`, `catalog`.

Nói:

> Case 2 không dùng shared reverse proxy cho business API. Frontend, Order và Catalog mỗi service có public URL riêng, dù ba tunnel cùng chạy trong một ngrok agent session.

Flow:

```text
Browser -> FE_URL       -> Frontend Nginx
Postman -> ORDER_URL    -> Order API
Postman -> CATALOG_URL  -> Catalog API
```

Test:

```text
FE_URL/              ✅
ORDER_URL/orders     ✅
CATALOG_URL/products ✅
localhost:8002       ❌
localhost:8003       ❌
```

Postman tạo order trực tiếp:

```text
POST ORDER_URL/orders
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

Internal Order -> Catalog vẫn dùng private Docker network:

```powershell
docker compose -f compose.public.yaml exec order-service python -c "import socket; print(socket.gethostbyname('catalog-service'))"
```

## Câu kết

> Case 1 có một public URL và ngrok Traffic Policy reverse proxy các route được chọn tới backend private. Case 2 thì Order và Catalog có public ngrok URL riêng, nên client gọi native backend API trực tiếp. Database ở cả hai case vẫn private.
